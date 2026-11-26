import * as vscode from 'vscode';
import { applyEnabledChanges, disableOutside, setRules, setTarget } from './actions';
import { RULE_STATES, SEVERITIES } from './analysis/ruleSettings';
import type { RuleState, SeveritySetting } from './analysis/ruleSettings';
import { flagStyle, getLangState, isGnu } from './config';
import type { DiagnosticsManager } from './diagnostics';
import { RulesPanel } from './rulesPanel';
import { compilerFlag, LANGS, langLabel, languageIdToLang } from './standards';
import type { FlagStyle, Lang, StandardInfo } from './standards';
import type { SyncManager } from './sync';
import type { TreeNode } from './tree';

export interface Services {
  readonly diagnostics: DiagnosticsManager;
  readonly sync: SyncManager;
}

function isTreeNode(value: unknown): value is TreeNode {
  return typeof value === 'object' && value !== null && 'type' in value;
}

/** Language from `'c'`/`'cpp'` or from a node of the Standards or Single Rule views. */
function asLang(value: unknown): Lang | undefined {
  if (value === 'c' || value === 'cpp') {
    return value;
  }
  if (isTreeNode(value) && 'lang' in value && (value.lang === 'c' || value.lang === 'cpp')) {
    return value.lang;
  }
  return undefined;
}

/** Language from a command argument, the active editor, or by asking the user. */
async function resolveLang(arg: unknown): Promise<Lang | undefined> {
  const direct = asLang(arg);
  if (direct) {
    return direct;
  }
  const doc = vscode.window.activeTextEditor?.document;
  const fromEditor = doc && languageIdToLang(doc.languageId);
  if (fromEditor) {
    return fromEditor;
  }
  const pick = await vscode.window.showQuickPick(
    LANGS.map((lang) => ({ label: langLabel(lang), lang })),
    { placeHolder: vscode.l10n.t('Select a language') },
  );
  return pick?.lang;
}

function highlightsOf(std: StandardInfo): string {
  return std.highlights.map((h) => vscode.l10n.t(h)).join(' · ');
}

interface TargetItem extends vscode.QuickPickItem {
  readonly std?: StandardInfo;
  readonly disabled?: boolean;
}

export async function selectTarget(lang: Lang): Promise<void> {
  const state = getLangState(lang);
  const label = langLabel(lang);
  const toItem = (std: StandardInfo, disabled: boolean): TargetItem => ({
    label: std.label,
    description:
      std.id === state.target?.id
        ? `$(check) ${vscode.l10n.t('current target')}`
        : disabled
          ? `$(circle-slash) ${vscode.l10n.t('disabled')}`
          : String(std.year),
    detail: highlightsOf(std),
    std,
    disabled,
  });
  const items: TargetItem[] = [...state.enabled].reverse().map((s) => toItem(s, false));
  const disabled = state.all.filter((s) => state.disabledIds.has(s.id)).reverse();
  if (disabled.length > 0) {
    items.push({ label: vscode.l10n.t('Disabled'), kind: vscode.QuickPickItemKind.Separator });
    items.push(...disabled.map((s) => toItem(s, true)));
  }

  const picked = await new Promise<TargetItem | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<TargetItem>();
    qp.title = vscode.l10n.t('{0} Target Standard', label);
    qp.placeholder = vscode.l10n.t('Select the {0} standard to target', label);
    qp.items = items;
    qp.matchOnDetail = true;
    const current = items.find((i) => i.std?.id === state.target?.id);
    if (current) {
      qp.activeItems = [current];
    }
    const rulesButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('settings-edit'), tooltip: vscode.l10n.t('Configure Rules') };
    qp.buttons = [rulesButton];
    qp.onDidTriggerButton((button) => {
      if (button === rulesButton) {
        qp.hide();
        void vscode.commands.executeCommand('cppStandards.configureRules', lang);
      }
    });
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]);
      qp.hide();
    });
    qp.onDidHide(() => {
      resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
  if (!picked?.std) {
    return;
  }
  if (picked.disabled) {
    const enable = vscode.l10n.t('Enable and Set as Target');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('{0} is disabled. Enable it and make it the target standard?', picked.std.label),
      enable,
    );
    if (choice !== enable) {
      return;
    }
  }
  await setTarget(lang, picked.std.id, true);
}

export async function manageStandards(lang: Lang): Promise<void> {
  const state = getLangState(lang);
  const label = langLabel(lang);
  const items = state.all.map((std) => ({
    label: std.label,
    description: std.id === state.target?.id ? vscode.l10n.t('target') : String(std.year),
    detail: highlightsOf(std),
    picked: !state.disabledIds.has(std.id),
    std,
  }));
  const result = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDetail: true,
    title: vscode.l10n.t('Enabled {0} Standards', label),
    placeHolder: vscode.l10n.t('Checked standards are enabled, unchecked standards are disabled'),
  });
  if (!result) {
    return;
  }
  const enabled = new Set(result.map((r) => r.std.id));
  await applyEnabledChanges(lang, new Map(state.all.map((s) => [s.id, enabled.has(s.id)])));
}

async function copyCompilerFlag(): Promise<void> {
  const gnu = isGnu();
  const items: Array<vscode.QuickPickItem & { flag: string }> = [];
  for (const lang of LANGS) {
    const target = getLangState(lang).target;
    if (!target) {
      continue;
    }
    for (const style of ['gcc', 'msvc'] as const) {
      const flag = compilerFlag(target, style, gnu);
      if (flag) {
        items.push({ label: flag, description: `${langLabel(lang)} · ${style === 'gcc' ? 'GCC / Clang' : 'MSVC'}`, flag });
      }
    }
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('Select the compiler flag to copy') });
  if (pick) {
    await vscode.env.clipboard.writeText(pick.flag);
    void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0}', pick.flag), 3000);
  }
}

async function copyStandardFlag(node: unknown): Promise<void> {
  if (!isTreeNode(node) || node.type !== 'standard') {
    return copyCompilerFlag();
  }
  const style: FlagStyle = flagStyle();
  const flag = compilerFlag(node.std, style, isGnu()) ?? compilerFlag(node.std, 'gcc', isGnu())!;
  await vscode.env.clipboard.writeText(flag);
  void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0}', flag), 3000);
}

/** Flag for `${command:cppStandards.cppFlag}` / `${command:cppStandards.cFlag}` in tasks.json and launch.json. */
function targetFlag(lang: Lang): string {
  const target = getLangState(lang).target;
  return target ? compilerFlag(target, flagStyle(), isGnu()) ?? '' : '';
}

export function registerCommands(context: vscode.ExtensionContext, services: Services): void {
  const register = (id: string, handler: (...args: any[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register('cppStandards.selectCppStandard', () => selectTarget('cpp'));
  register('cppStandards.selectCStandard', () => selectTarget('c'));
  register('cppStandards.manageCppStandards', () => manageStandards('cpp'));
  register('cppStandards.manageCStandards', () => manageStandards('c'));
  register('cppStandards.selectStandard', async (arg?: unknown) => {
    const lang = await resolveLang(arg);
    if (lang) {
      await selectTarget(lang);
    }
  });
  register('cppStandards.manageStandards', async (arg?: unknown) => {
    const lang = await resolveLang(arg);
    if (lang) {
      await manageStandards(lang);
    }
  });

  register('cppStandards.setTarget', async (arg?: unknown, id?: unknown, options?: { enable?: boolean }) => {
    if (isTreeNode(arg) && arg.type === 'standard') {
      return setTarget(arg.lang, arg.std.id);
    }
    const lang = asLang(arg);
    if (lang && typeof id === 'string') {
      return setTarget(lang, id, options?.enable === true);
    }
    const resolved = await resolveLang(arg);
    if (resolved) {
      await selectTarget(resolved);
    }
    return undefined;
  });
  register('cppStandards.enableStandard', (node?: unknown) =>
    isTreeNode(node) && node.type === 'standard' ? applyEnabledChanges(node.lang, new Map([[node.std.id, true]])) : undefined,
  );
  register('cppStandards.disableStandard', (node?: unknown) =>
    isTreeNode(node) && node.type === 'standard' ? applyEnabledChanges(node.lang, new Map([[node.std.id, false]])) : undefined,
  );
  register('cppStandards.enableAll', async (arg?: unknown) => {
    const lang = await resolveLang(arg);
    if (lang) {
      await applyEnabledChanges(lang, new Map(getLangState(lang).all.map((s) => [s.id, true])));
    }
  });
  register('cppStandards.disableOutside', (lang: unknown, range: { min?: string; maxExclusive?: string }) => {
    const l = asLang(lang);
    return l ? disableOutside(l, range ?? {}) : undefined;
  });
  register('cppStandards.setRules', async (ids: unknown, change: unknown) => {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id): id is string => typeof id === 'string');
    const c = (typeof change === 'object' && change !== null ? change : {}) as Record<string, unknown>;
    const state = (RULE_STATES as readonly unknown[]).includes(c.state) ? (c.state as RuleState) : undefined;
    const severity = ([...SEVERITIES, 'default'] as readonly unknown[]).includes(c.severity) ? (c.severity as SeveritySetting) : undefined;
    await setRules(list, { state, severity });
  });
  register('cppStandards.configureRules', (arg?: unknown) => {
    const options = typeof arg === 'object' && arg !== null && !isTreeNode(arg) ? (arg as { lang?: unknown; search?: unknown }) : {};
    const lang = asLang(arg) ?? asLang(options.lang);
    // A rule of the Single Rule view opens the panel filtered to that rule.
    const ruleId = isTreeNode(arg) && (arg as { type: string }).type === 'rule' ? (arg as { id?: unknown }).id : undefined;
    const search = typeof options.search === 'string' ? options.search : typeof ruleId === 'string' ? ruleId : undefined;
    RulesPanel.show(context.extensionUri, { lang, search });
  });

  register('cppStandards.checkWorkspace', () => services.diagnostics.checkWorkspace());
  register('cppStandards.syncNow', () => services.sync.syncAll(true));
  register('cppStandards.copyCompilerFlag', () => copyCompilerFlag());
  register('cppStandards.copyStandardFlag', (node?: unknown) => copyStandardFlag(node));
  register('cppStandards.cppFlag', () => targetFlag('cpp'));
  register('cppStandards.cFlag', () => targetFlag('c'));
  register('cppStandards.openSettings', () =>
    vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`),
  );
}
