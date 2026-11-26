/**
 * Propagates the selected standards and rules to the C/C++ toolchain by writing configuration,
 * never by running the tools:
 *  - the Microsoft C/C++ extension (`C_Cpp.default.cppStandard` / `cStandard`, and the
 *    clang-tidy checks and arguments used by its code analysis),
 *  - clangd, through a managed block in `.clangd` (opt-in),
 *  - CMake Tools, through `CMAKE_CXX_STANDARD` / `CMAKE_C_STANDARD` in `cmake.configureSettings` (opt-in).
 *
 * Settings shared with other extensions are merged: the extension remembers which entries it
 * added and only ever changes those.
 */

import * as vscode from 'vscode';
import { checkedStandards, getConfig, getLangState, getRuleSettings, isExplicitlySet, isGnu, settingsTarget } from './config';
import type { DiagnosticsMode } from './config';
import { cpptoolsValue, findStandard, LANGS } from './standards';
import type { Lang } from './standards';
import {
  CLANGD_BLOCK_RE,
  clangdBlock,
  clangTidyChecks,
  cmakeSettings,
  conformanceFlags,
  mergeManagedList,
  mergeManagedObject,
  removeClangdBlock,
  upsertClangdBlock,
} from './toolchain';
import type { ClangdLanguage } from './toolchain';

const DISMISS_PROPERTIES_KEY = 'cppStandards.dismissPropertiesOverride';
const MANAGED_KEY = 'cppStandards.managed.';

/** What the enabled sync options write, per language. Also shown in the Options tooltips. */
export interface ToolchainPlan {
  /** Conformance warnings, or empty when `sync.conformanceWarnings` is off. */
  readonly flags: Readonly<Record<Lang, readonly string[]>>;
  /** clang-tidy checks for forbidden rules, or empty when `sync.clangTidyChecks` is off. */
  readonly checks: Readonly<Record<Lang, readonly string[]>>;
  /** CMake cache variables for the target standards (whether or not `sync.cmake` is on). */
  readonly cmake: Readonly<Record<string, string>>;
}

export function toolchainPlan(): ToolchainPlan {
  const conf = getConfig();
  const gnu = isGnu();
  const mode: DiagnosticsMode = conf.get<string>('diagnostics.mode', 'target') === 'allEnabled' ? 'allEnabled' : 'target';
  const withFlags = conf.get<boolean>('sync.conformanceWarnings', false);
  const withChecks = conf.get<boolean>('sync.clangTidyChecks', false);
  const rules = withChecks ? getRuleSettings() : undefined;
  const flags = { c: [] as string[], cpp: [] as string[] };
  const checks = { c: [] as string[], cpp: [] as string[] };
  for (const lang of LANGS) {
    const state = getLangState(lang);
    if (withFlags && state.target) {
      const oldest = checkedStandards(state, mode)[0] ?? state.target;
      flags[lang] = conformanceFlags(lang, state.target, oldest, gnu, (id) => findStandard(id)?.rank ?? Number.MAX_SAFE_INTEGER);
    }
    if (rules) {
      checks[lang] = clangTidyChecks(lang, (id) => rules.resolve(id).state === 'forbid');
    }
  }
  return { flags, checks, cmake: cmakeSettings(getLangState('cpp').target, getLangState('c').target, gnu) };
}

/** True when the Microsoft C/C++ extension's settings are registered. */
export function hasCpptools(): boolean {
  return vscode.workspace.getConfiguration('C_Cpp.default').inspect('cppStandard')?.defaultValue !== undefined;
}

/** True when CMake Tools' settings are registered. */
export function hasCmakeTools(): boolean {
  return vscode.workspace.getConfiguration('cmake').inspect('configureSettings')?.defaultValue !== undefined;
}

export class SyncManager implements vscode.Disposable {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private propertiesChecked = false;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.LogOutputChannel) {}

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  /** Debounced sync after a settings change. */
  scheduleSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.syncAll(false).catch((err) => this.log.error(`Sync failed: ${String(err)}`));
    }, 250);
  }

  /**
   * On startup only sync when the user has explicitly configured standards (or opted into a
   * sync), so that merely opening a project does not write settings files.
   */
  async syncOnStartup(): Promise<void> {
    const conf = getConfig();
    const configured = ['cpp.target', 'c.target', 'cpp.disabled', 'c.disabled'].some(isExplicitlySet);
    try {
      const cpptools = conf.get<boolean>('sync.cpptools', true);
      if (configured && cpptools) {
        await this.syncCpptools(false);
      }
      await this.syncCpptoolsAnalysis(cpptools);
      if (conf.get<boolean>('sync.clangd', false)) {
        await this.syncClangd(true);
      }
      if (conf.get<boolean>('sync.cmake', false)) {
        await this.syncCmake(true);
      }
    } catch (err) {
      this.log.error(`Startup sync failed: ${String(err)}`);
    }
  }

  /** Runs every enabled sync (and undoes disabled ones). When `manual`, reports the outcome. */
  async syncAll(manual: boolean): Promise<void> {
    const conf = getConfig();
    const done: string[] = [];
    const cpptools = conf.get<boolean>('sync.cpptools', true);
    if (cpptools && (await this.syncCpptools(manual))) {
      done.push(vscode.l10n.t('Microsoft C/C++ extension'));
    }
    await this.syncCpptoolsAnalysis(cpptools);
    const clangdEnabled = conf.get<boolean>('sync.clangd', false);
    const clangdChanged = await this.syncClangd(clangdEnabled);
    if (clangdEnabled && (clangdChanged || manual)) {
      done.push('.clangd');
    }
    const cmakeEnabled = conf.get<boolean>('sync.cmake', false);
    if ((await this.syncCmake(cmakeEnabled)) && cmakeEnabled) {
      done.push('CMake Tools');
    }
    if (manual) {
      if (done.length > 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Target standards synced to: {0}', done.join(', ')));
      } else {
        const open = vscode.l10n.t('Open Settings');
        const choice = await vscode.window.showInformationMessage(
          vscode.l10n.t('Nothing to sync. Enable "Sync: Cpptools", "Sync: Clangd" or "Sync: Cmake" in the settings.'),
          open,
        );
        if (choice === open) {
          void vscode.commands.executeCommand('workbench.action.openSettings', 'cppStandards.sync');
        }
      }
    }
  }

  /** Returns true when the Microsoft C/C++ extension is present and its settings are up to date. */
  private async syncCpptools(manual: boolean): Promise<boolean> {
    if (!hasCpptools()) {
      if (manual) {
        this.log.info('The Microsoft C/C++ extension is not installed; skipping C_Cpp.default.* sync.');
      }
      return false;
    }
    const gnu = isGnu();
    const cpp = getLangState('cpp').target;
    const c = getLangState('c').target;
    const desired: Array<[string, string | undefined]> = [
      ['cppStandard', cpp && cpptoolsValue(cpp, gnu)],
      ['cStandard', c && cpptoolsValue(c, gnu)],
    ];
    const folders = vscode.workspace.workspaceFolders ?? [];
    const targets: Array<{ scope?: vscode.Uri; target: vscode.ConfigurationTarget }> =
      folders.length > 1
        ? folders.map((f) => ({ scope: f.uri, target: vscode.ConfigurationTarget.WorkspaceFolder }))
        : folders.length === 1
          ? [{ scope: folders[0].uri, target: vscode.ConfigurationTarget.Workspace }]
          : [{ target: vscode.ConfigurationTarget.Global }];
    for (const { scope, target } of targets) {
      const conf = vscode.workspace.getConfiguration('C_Cpp.default', scope);
      for (const [key, value] of desired) {
        if (value !== undefined && conf.get<string>(key) !== value) {
          await conf.update(key, value, target);
          this.log.info(`Set C_Cpp.default.${key} = ${value}${scope ? ` (${scope.fsPath})` : ''}`);
        }
      }
    }
    await this.checkPropertiesOverride(manual);
    return true;
  }

  /**
   * Keeps the clang-tidy checks and arguments of the C/C++ extension's code analysis in step with
   * the forbidden rules and conformance warnings. Removes what it added when disabled.
   */
  private async syncCpptoolsAnalysis(enabled: boolean): Promise<void> {
    if (!hasCpptools()) {
      return;
    }
    const plan = toolchainPlan();
    const unique = (lists: ReadonlyArray<readonly string[]>): string[] => [...new Set(lists.flat())];
    const checks = enabled ? unique([plan.checks.cpp, plan.checks.c]) : [];
    const args = enabled ? unique([plan.flags.cpp, plan.flags.c]).map((flag) => `--extra-arg=${flag}`) : [];
    await this.updateManagedList('C_Cpp', 'codeAnalysis.clangTidy.checks.enabled', checks);
    await this.updateManagedList('C_Cpp', 'codeAnalysis.clangTidy.args', args);
  }

  /** Writes CMake cache variables for the target standards (or removes them). Returns true when CMake Tools is present. */
  private async syncCmake(enabled: boolean): Promise<boolean> {
    if (!hasCmakeTools()) {
      if (enabled) {
        this.log.info('CMake Tools is not installed; skipping cmake.configureSettings sync.');
      }
      return false;
    }
    const conf = vscode.workspace.getConfiguration('cmake');
    const target = settingsTarget();
    const info = conf.inspect<unknown>('configureSettings');
    const raw = target === vscode.ConfigurationTarget.Workspace ? info?.workspaceValue : info?.globalValue;
    const current = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const stateKey = `${MANAGED_KEY}cmake.configureSettings`;
    const managed = this.context.workspaceState.get<Record<string, string>>(stateKey, {});
    const result = mergeManagedObject(current, managed, enabled ? toolchainPlan().cmake : {});
    if (JSON.stringify(result.value) !== JSON.stringify(current)) {
      await conf.update('configureSettings', Object.keys(result.value).length > 0 ? result.value : undefined, target);
      this.log.info(`Updated cmake.configureSettings: ${JSON.stringify(result.value)}`);
    }
    await this.context.workspaceState.update(stateKey, result.managed);
    return true;
  }

  /** Merges `desired` into a list setting of another extension, see `mergeManagedList`. */
  private async updateManagedList(section: string, key: string, desired: readonly string[]): Promise<void> {
    const conf = vscode.workspace.getConfiguration(section);
    const target = settingsTarget();
    const info = conf.inspect<unknown>(key);
    const raw = target === vscode.ConfigurationTarget.Workspace ? info?.workspaceValue : info?.globalValue;
    const current = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
    const stateKey = `${MANAGED_KEY}${section}.${key}`;
    const managed = this.context.workspaceState.get<string[]>(stateKey, []);
    if (managed.length === 0 && desired.length === 0) {
      return;
    }
    const result = mergeManagedList(current, managed, desired);
    if (result.value.join('\n') !== current.join('\n')) {
      await conf.update(key, result.value.length > 0 ? result.value : undefined, target);
      this.log.info(`Updated ${section}.${key}: ${JSON.stringify(result.value)}`);
    }
    await this.context.workspaceState.update(stateKey, result.managed);
  }

  /** Warns when c_cpp_properties.json pins a standard, which overrides C_Cpp.default.*. */
  private async checkPropertiesOverride(manual: boolean): Promise<void> {
    if ((this.propertiesChecked && !manual) || this.context.workspaceState.get<boolean>(DISMISS_PROPERTIES_KEY)) {
      return;
    }
    this.propertiesChecked = true;
    const offenders: Array<{ uri: vscode.Uri; text: string }> = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, '.vscode', 'c_cpp_properties.json');
      const text = await readText(uri);
      if (text !== undefined && /"c(?:pp)?Standard"\s*:\s*"(?!\$\{default\}")[^"]*"/.test(text)) {
        offenders.push({ uri, text });
      }
    }
    if (offenders.length === 0) {
      return;
    }
    const fix = vscode.l10n.t('Use {0}', '${default}');
    const open = vscode.l10n.t('Open File');
    const dismiss = vscode.l10n.t("Don't Show Again");
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('c_cpp_properties.json sets "cppStandard"/"cStandard" explicitly, which overrides the standard selected by this extension.'),
      fix,
      open,
      dismiss,
    );
    if (choice === fix) {
      for (const { uri, text } of offenders) {
        const updated = text.replace(/("c(?:pp)?Standard"\s*:\s*)"[^"]*"/g, '$1"${default}"');
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
        this.log.info(`Updated ${uri.fsPath} to use \${default}`);
      }
    } else if (choice === open) {
      await vscode.window.showTextDocument(offenders[0].uri);
    } else if (choice === dismiss) {
      await this.context.workspaceState.update(DISMISS_PROPERTIES_KEY, true);
    }
  }

  /**
   * Writes (enabled) or removes (disabled) the managed block in each workspace folder's `.clangd`.
   * Returns true when a file changed.
   */
  private async syncClangd(enabled: boolean): Promise<boolean> {
    let changed = false;
    const block = enabled ? currentClangdBlock() : '';
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, '.clangd');
      const existing = (await readText(uri)) ?? '';
      if (!enabled && !CLANGD_BLOCK_RE.test(existing)) {
        continue;
      }
      const updated = enabled ? upsertClangdBlock(existing, block) : removeClangdBlock(existing);
      if (updated !== existing) {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
        this.log.info(`${enabled ? 'Updated' : 'Removed managed block from'} ${uri.fsPath}`);
        changed = true;
      }
    }
    return changed;
  }
}

function currentClangdBlock(): string {
  const plan = toolchainPlan();
  const languages: ClangdLanguage[] = [];
  for (const lang of LANGS) {
    const target = getLangState(lang).target;
    if (target) {
      languages.push({ lang, target, flags: plan.flags[lang], checks: plan.checks[lang] });
    }
  }
  return clangdBlock(languages, isGnu());
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}
