/**
 * Propagates the target standards to IntelliSense providers:
 *  - the Microsoft C/C++ extension (`C_Cpp.default.cppStandard` / `C_Cpp.default.cStandard`),
 *  - clangd, through a managed block in `.clangd` (opt-in).
 */

import * as vscode from 'vscode';
import { getConfig, getLangState, isExplicitlySet, isGnu } from './config';
import { compilerFlag, cpptoolsValue } from './standards';

const CLANGD_BEGIN = '# >>> cpp-standards: managed by the C/C++ Standards extension, changes inside this block are overwritten >>>';
const CLANGD_END = '# <<< cpp-standards <<<';
const CLANGD_BLOCK_RE = /^# >>> cpp-standards:.*\r?\n[\s\S]*?^# <<< cpp-standards <<<[^\n]*(?:\r?\n|$)/m;
const DISMISS_PROPERTIES_KEY = 'cppStandards.dismissPropertiesOverride';

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
   * On startup only sync when the user has explicitly configured standards, so that merely opening
   * a project does not write settings files.
   */
  async syncOnStartup(): Promise<void> {
    const conf = getConfig();
    const configured = ['cpp.target', 'c.target', 'cpp.disabled', 'c.disabled'].some(isExplicitlySet);
    try {
      if (configured && conf.get<boolean>('sync.cpptools', true)) {
        await this.syncCpptools(false);
      }
      if (conf.get<boolean>('sync.clangd', false)) {
        await this.syncClangd(true);
      }
    } catch (err) {
      this.log.error(`Startup sync failed: ${String(err)}`);
    }
  }

  /** Runs every enabled sync. When `manual`, reports the outcome to the user. */
  async syncAll(manual: boolean): Promise<void> {
    const conf = getConfig();
    const done: string[] = [];
    if (conf.get<boolean>('sync.cpptools', true)) {
      const result = await this.syncCpptools(manual);
      if (result) {
        done.push(vscode.l10n.t('Microsoft C/C++ extension'));
      }
    }
    const clangdEnabled = conf.get<boolean>('sync.clangd', false);
    const clangdChanged = await this.syncClangd(clangdEnabled);
    if (clangdEnabled && (clangdChanged || manual)) {
      done.push('.clangd');
    }
    if (manual) {
      if (done.length > 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Target standards synced to: {0}', done.join(', ')));
      } else {
        const open = vscode.l10n.t('Open Settings');
        const choice = await vscode.window.showInformationMessage(
          vscode.l10n.t('Nothing to sync. Enable "Sync: Cpptools" or "Sync: Clangd" in the settings.'),
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
    const probe = vscode.workspace.getConfiguration('C_Cpp.default').inspect('cppStandard');
    if (probe?.defaultValue === undefined) {
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
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, '.clangd');
      const existing = (await readText(uri)) ?? '';
      if (!enabled && !CLANGD_BLOCK_RE.test(existing)) {
        continue;
      }
      const updated = enabled ? upsertClangdBlock(existing, clangdBlock()) : existing.replace(CLANGD_BLOCK_RE, '').replace(/\n{3,}$/, '\n\n');
      if (updated !== existing) {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(updated));
        this.log.info(`${enabled ? 'Updated' : 'Removed managed block from'} ${uri.fsPath}`);
        changed = true;
      }
    }
    return changed;
  }
}

function clangdBlock(): string {
  const gnu = isGnu();
  const c = getLangState('c').target;
  const cpp = getLangState('cpp').target;
  const lines = [CLANGD_BEGIN];
  if (c) {
    lines.push('---', 'If:', "  PathMatch: '.*\\.(c|i)'", 'CompileFlags:', "  Remove: ['-std=*']", `  Add: ['${compilerFlag(c, 'gcc', gnu)}']`);
  }
  if (cpp) {
    lines.push(
      '---',
      'If:',
      "  PathMatch: '.*\\.(cc|cp|cpp|cxx|c\\+\\+|ii|cppm|ixx|hh|hpp|hxx|h\\+\\+|ipp|tpp|txx|inl)'",
      'CompileFlags:',
      "  Remove: ['-std=*']",
      `  Add: ['${compilerFlag(cpp, 'gcc', gnu)}']`,
    );
  }
  lines.push(CLANGD_END);
  return lines.join('\n') + '\n';
}

/** Replaces the managed block in a `.clangd` file, or appends it. Exported for tests. */
export function upsertClangdBlock(existing: string, block: string): string {
  if (CLANGD_BLOCK_RE.test(existing)) {
    return existing.replace(CLANGD_BLOCK_RE, () => block);
  }
  if (existing.length === 0) {
    return block;
  }
  return existing + (existing.endsWith('\n') ? '' : '\n') + block;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}
