import * as vscode from 'vscode';
import { applyEnabledChanges } from './actions';
import { allRules } from './analysis/rules';
import { getConfig, getLangState, getRuleSettings, isGnu, updateSetting } from './config';
import { compilerFlag, LANGS, langLabel } from './standards';
import type { Lang, StandardInfo } from './standards';

/** A boolean (or two-valued) setting shown as a checkbox in the Options group. */
interface OptionDef {
  readonly key: string;
  readonly label: string;
  readonly checked: () => boolean;
  readonly value: (checked: boolean) => unknown;
}

const OPTIONS: readonly OptionDef[] = [
  { key: 'diagnostics.enabled', label: 'Report unsupported features', checked: () => getConfig().get('diagnostics.enabled', true), value: (c) => c },
  {
    key: 'diagnostics.mode',
    label: 'Code must compile with every enabled standard',
    checked: () => getConfig().get<string>('diagnostics.mode', 'target') === 'allEnabled',
    value: (c) => (c ? 'allEnabled' : 'target'),
  },
  { key: 'diagnostics.checkRemovedFeatures', label: 'Report removed features', checked: () => getConfig().get('diagnostics.checkRemovedFeatures', true), value: (c) => c },
  { key: 'diagnostics.evaluatePreprocessor', label: 'Evaluate #if conditions', checked: () => getConfig().get('diagnostics.evaluatePreprocessor', true), value: (c) => c },
  { key: 'gnuExtensions', label: 'GNU extensions (gnu++17, gnu11, ...)', checked: () => isGnu(), value: (c) => c },
  { key: 'sync.cpptools', label: 'Sync to the Microsoft C/C++ extension', checked: () => getConfig().get('sync.cpptools', true), value: (c) => c },
  { key: 'sync.clangd', label: 'Sync to .clangd', checked: () => getConfig().get('sync.clangd', false), value: (c) => c },
  { key: 'statusBar.enabled', label: 'Show in the status bar', checked: () => getConfig().get('statusBar.enabled', true), value: (c) => c },
];

export type TreeNode =
  | { readonly type: 'group'; readonly lang: Lang }
  | { readonly type: 'standard'; readonly lang: Lang; readonly std: StandardInfo }
  | { readonly type: 'options' }
  | { readonly type: 'option'; readonly key: string };

export class StandardsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  refresh(): void {
    this.changed.fire();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return [...LANGS.map((lang): TreeNode => ({ type: 'group', lang })), { type: 'options' }];
    }
    if (node.type === 'group') {
      return getLangState(node.lang).all.map((std): TreeNode => ({ type: 'standard', lang: node.lang, std }));
    }
    if (node.type === 'options') {
      return OPTIONS.map((o): TreeNode => ({ type: 'option', key: o.key }));
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    switch (node.type) {
      case 'group':
        return this.groupItem(node.lang);
      case 'standard':
        return this.standardItem(node.lang, node.std);
      case 'options': {
        const item = new vscode.TreeItem(vscode.l10n.t('Options'), vscode.TreeItemCollapsibleState.Collapsed);
        item.id = 'options';
        item.iconPath = new vscode.ThemeIcon('settings-gear');
        return item;
      }
      case 'option': {
        const def = OPTIONS.find((o) => o.key === node.key)!;
        const item = new vscode.TreeItem(vscode.l10n.t(def.label));
        item.id = `option:${def.key}`;
        item.checkboxState = def.checked() ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
        item.tooltip = `cppStandards.${def.key}`;
        item.contextValue = 'option';
        return item;
      }
    }
  }

  private groupItem(lang: Lang): vscode.TreeItem {
    const state = getLangState(lang);
    const item = new vscode.TreeItem(langLabel(lang), vscode.TreeItemCollapsibleState.Expanded);
    item.id = `group:${lang}`;
    item.contextValue = 'langGroup';
    item.iconPath = new vscode.ThemeIcon('file-code');
    const target = state.target?.label ?? vscode.l10n.t('none');
    item.description = vscode.l10n.t('target {0} · {1}/{2} enabled', target, state.enabled.length, state.all.length);
    const custom = customizedRuleCount(lang);
    if (custom > 0) {
      item.description += ' · ' + vscode.l10n.t('{0} customized rules', custom);
    }
    item.tooltip = new vscode.MarkdownString(
      vscode.l10n.t('Check a standard to enable it, uncheck it to disable it. Click an enabled standard to make it the target.'),
    );
    return item;
  }

  private standardItem(lang: Lang, std: StandardInfo): vscode.TreeItem {
    const state = getLangState(lang);
    const enabled = !state.disabledIds.has(std.id);
    const isTarget = state.target?.id === std.id;
    const item = new vscode.TreeItem(std.label);
    item.id = `std:${std.id}`;
    item.checkboxState = enabled ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
    item.contextValue = isTarget ? 'standard.target' : enabled ? 'standard.enabled' : 'standard.disabled';
    item.iconPath = isTarget
      ? new vscode.ThemeIcon('target', new vscode.ThemeColor('charts.green'))
      : new vscode.ThemeIcon(enabled ? 'circle-large-outline' : 'circle-slash', enabled ? undefined : new vscode.ThemeColor('disabledForeground'));
    item.description = isTarget ? vscode.l10n.t('target') : enabled ? String(std.year) : vscode.l10n.t('disabled');
    if (enabled && !isTarget) {
      item.command = { title: vscode.l10n.t('Set as Target Standard'), command: 'cppStandards.setTarget', arguments: [lang, std.id] };
    }
    const gnu = isGnu();
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${std.label}** (${std.year})${isTarget ? ` — ${vscode.l10n.t('target')}` : ''}\n\n`);
    for (const highlight of std.highlights) {
      tooltip.appendMarkdown(`- ${escapeMarkdown(vscode.l10n.t(highlight))}\n`);
    }
    tooltip.appendMarkdown(`\nGCC/Clang: \`${compilerFlag(std, 'gcc', gnu)}\``);
    const msvc = compilerFlag(std, 'msvc', gnu);
    tooltip.appendMarkdown(`  \nMSVC: ${msvc ? `\`${msvc}\`` : vscode.l10n.t('not available')}`);
    item.tooltip = tooltip;
    return item;
  }
}

/** Number of rules of `lang` whose state or severity is overridden in the settings. */
function customizedRuleCount(lang: Lang): number {
  const rules = getRuleSettings();
  if (rules.isEmpty) {
    return 0;
  }
  return allRules().filter((rule) => {
    if (rule.lang !== lang) {
      return false;
    }
    const resolved = rules.resolve(rule.id);
    return resolved.state !== 'default' || resolved.severity !== undefined;
  }).length;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!<>|]/g, '\\$&');
}

/** Handles checkbox toggles: standards are enabled/disabled, options flip their setting. */
export async function handleCheckboxChange(
  event: vscode.TreeCheckboxChangeEvent<TreeNode>,
  provider: StandardsTreeProvider,
): Promise<void> {
  const perLang = new Map<Lang, Map<string, boolean>>();
  for (const [node, state] of event.items) {
    const checked = state === vscode.TreeItemCheckboxState.Checked;
    if (node.type === 'standard') {
      const changes = perLang.get(node.lang) ?? new Map<string, boolean>();
      changes.set(node.std.id, checked);
      perLang.set(node.lang, changes);
    } else if (node.type === 'option') {
      const def = OPTIONS.find((o) => o.key === node.key);
      if (def) {
        await updateSetting(def.key, def.value(checked));
      }
    }
  }
  for (const [lang, changes] of perLang) {
    if (!(await applyEnabledChanges(lang, changes))) {
      provider.refresh(); // revert the optimistic checkbox state
    }
  }
}
