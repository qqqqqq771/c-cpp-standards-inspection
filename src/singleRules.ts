/**
 * "Single Rule" view: every rule of each language, grouped by the standard that introduced or
 * removed the feature, with a checkbox per rule. Checked features are allowed, unchecked ones are
 * reported. The checkbox writes the smallest override to `cppStandards.rules`: unchecking a
 * feature the selected standard supports stores `forbid`, checking one it does not support
 * stores `allow`, and going back to the standard's behaviour removes the entry.
 */

import * as vscode from 'vscode';
import { applyRuleChanges } from './actions';
import type { RuleChangeSet } from './actions';
import { isAvailable, ruleGroups, statesForAllowed } from './analysis/ruleGroups';
import type { GroupRelation, RuleGroup, RuleStatus } from './analysis/ruleGroups';
import { RULE_CATEGORIES } from './analysis/rules';
import type { RuleCategory } from './analysis/rules';
import { SEVERITIES } from './analysis/ruleSettings';
import type { RuleState, SeveritySetting } from './analysis/ruleSettings';
import { checkedStandards, getDiagnosticsSettings, getLangState, isGnu } from './config';
import { ruleDisplayName } from './diagnostics';
import { LANGS, langLabel, languageIdToLang, rangeLabel } from './standards';
import type { Lang, StandardInfo } from './standards';
import { escapeMarkdown } from './tree';

export const SINGLE_RULES_VIEW = 'cppStandards.singleRules';
/** Context key (and global state key) of the "only features of the selected standard" filter. */
const AVAILABLE_ONLY = 'cppStandards.singleRules.availableOnly';
/** Bulk changes above this size ask for confirmation. */
const CONFIRM_THRESHOLD = 20;

export type RuleTreeNode =
  | { readonly type: 'ruleLang'; readonly lang: Lang }
  | { readonly type: 'ruleGroup'; readonly lang: Lang; readonly key: string }
  | { readonly type: 'ruleCategory'; readonly lang: Lang; readonly key: string; readonly category: RuleCategory }
  | { readonly type: 'rule'; readonly lang: Lang; readonly key: string; readonly category?: RuleCategory; readonly id: string };

interface GroupLayout {
  readonly group: RuleGroup;
  /** Categories shown as sub-groups; empty when the group has a single category. */
  readonly categories: readonly RuleCategory[];
  /** Rules sorted by display name. */
  readonly rules: readonly RuleStatus[];
}

interface LangModel {
  readonly lang: Lang;
  readonly checked: readonly StandardInfo[];
  readonly compared: string;
  readonly groups: readonly GroupLayout[];
  readonly byKey: ReadonlyMap<string, GroupLayout>;
  readonly byId: ReadonlyMap<string, { readonly layout: GroupLayout; readonly status: RuleStatus }>;
}

const CATEGORY_ICONS: Readonly<Record<RuleCategory, string>> = {
  language: 'symbol-keyword',
  literal: 'symbol-number',
  library: 'library',
  header: 'file-code',
  attribute: 'tag',
  preprocessor: 'symbol-constant',
};

export function categoryLabel(category: RuleCategory): string {
  switch (category) {
    case 'language':
      return vscode.l10n.t('Language features');
    case 'literal':
      return vscode.l10n.t('Literals');
    case 'library':
      return vscode.l10n.t('Standard library');
    case 'header':
      return vscode.l10n.t('Headers');
    case 'attribute':
      return vscode.l10n.t('Attributes');
    case 'preprocessor':
      return vscode.l10n.t('Preprocessor');
  }
}

function stateLabel(state: RuleState): string {
  switch (state) {
    case 'default':
      return vscode.l10n.t('Default');
    case 'allow':
      return vscode.l10n.t('Allow');
    case 'forbid':
      return vscode.l10n.t('Forbid');
  }
}

function severityLabel(severity: string): string {
  switch (severity) {
    case 'error':
      return vscode.l10n.t('Error');
    case 'warning':
      return vscode.l10n.t('Warning');
    case 'information':
      return vscode.l10n.t('Information');
    default:
      return vscode.l10n.t('Hint');
  }
}

function groupTitle(group: RuleGroup): string {
  return group.kind === 'since' ? group.std.label : vscode.l10n.t('Removed in {0}', group.std.label);
}

function relationText(group: RuleGroup, compared: string): string {
  switch (group.relation) {
    case 'included':
      return group.std.rank === 0 ? vscode.l10n.t('Available in every standard') : vscode.l10n.t('Available in {0}', compared);
    case 'newer':
      return vscode.l10n.t('Not available in {0}', compared);
    case 'removed':
      return vscode.l10n.t('Removed; not available in {0}', compared);
    case 'notYetRemoved':
      return vscode.l10n.t('Still available in {0}', compared);
  }
}

function relationHelp(group: RuleGroup, compared: string, lang: Lang): string {
  switch (group.relation) {
    case 'included':
      return group.std.rank === 0
        ? vscode.l10n.t('Features that are part of every {0} standard. Uncheck a feature to report its uses anyway.', langLabel(lang))
        : vscode.l10n.t('Features introduced in {0} and available in {1}. Uncheck a feature to report its uses anyway.', group.std.label, compared);
    case 'newer':
      return vscode.l10n.t('Features introduced in {0}, which {1} does not support. Their uses are reported; check a feature to allow it anyway.', group.std.label, compared);
    case 'removed':
      return vscode.l10n.t('Features removed in {0}. Their uses are reported for {1}; check a feature to allow it anyway.', group.std.label, compared);
    case 'notYetRemoved':
      return vscode.l10n.t('Features removed in {0} but still available in {1}. Uncheck a feature to report its uses.', group.std.label, compared);
  }
}

const RELATION_ICONS: Readonly<Record<GroupRelation, vscode.ThemeIcon>> = {
  included: new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green')),
  newer: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.red')),
  removed: new vscode.ThemeIcon('trash', new vscode.ThemeColor('charts.orange')),
  notYetRemoved: new vscode.ThemeIcon('history', new vscode.ThemeColor('charts.yellow')),
};

function verdictText(status: RuleStatus): string {
  const offending = status.verdict.offending?.label ?? '';
  switch (status.verdict.kind) {
    case 'supported':
      return vscode.l10n.t('Supported');
    case 'unsupported':
      return vscode.l10n.t('Not available in {0}', offending);
    case 'removed':
      return vscode.l10n.t('Removed; not available in {0}', offending);
    case 'gnu':
      return vscode.l10n.t('Allowed as a GNU extension');
    case 'removedUnchecked':
      return vscode.l10n.t('Removed (check is off)');
    case 'none':
      return vscode.l10n.t('No standard selected');
  }
}

function allowedCount(rules: readonly RuleStatus[]): string {
  return vscode.l10n.t('{0}/{1} allowed', rules.filter((r) => r.allowed).length, rules.length);
}

export class SingleRulesProvider implements vscode.TreeDataProvider<RuleTreeNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly models = new Map<Lang, LangModel>();
  /** Nodes by tree item id, so that the same element is returned for the same item. */
  private readonly nodes = new Map<string, RuleTreeNode>();
  private view: vscode.TreeView<RuleTreeNode> | undefined;
  private availableOnlyValue: boolean;

  constructor(private readonly memento: vscode.Memento) {
    this.availableOnlyValue = memento.get<boolean>(AVAILABLE_ONLY, false);
    void vscode.commands.executeCommand('setContext', AVAILABLE_ONLY, this.availableOnlyValue);
  }

  attach(view: vscode.TreeView<RuleTreeNode>): void {
    this.view = view;
    this.updateMessage();
  }

  get availableOnly(): boolean {
    return this.availableOnlyValue;
  }

  async setAvailableOnly(value: boolean): Promise<void> {
    this.availableOnlyValue = value;
    await this.memento.update(AVAILABLE_ONLY, value);
    await vscode.commands.executeCommand('setContext', AVAILABLE_ONLY, value);
    this.refresh();
  }

  refresh(): void {
    this.models.clear();
    this.nodes.clear();
    this.updateMessage();
    this.changed.fire();
  }

  /** Drops cached rule states so that the next read reflects the current settings. */
  invalidate(): void {
    this.models.clear();
  }

  private updateMessage(): void {
    if (!this.view) {
      return;
    }
    if (!getDiagnosticsSettings().enabled) {
      this.view.message = vscode.l10n.t('Feature diagnostics are disabled.');
    } else if (this.availableOnlyValue) {
      this.view.message = vscode.l10n.t('Showing only the features available in the selected standard.');
    } else {
      this.view.message = undefined;
    }
  }

  model(lang: Lang): LangModel {
    let model = this.models.get(lang);
    if (model) {
      return model;
    }
    const settings = getDiagnosticsSettings();
    const checked = checkedStandards(getLangState(lang), settings.mode);
    const groups = ruleGroups(lang, checked, settings.rules, { gnu: isGnu(), checkRemoved: settings.checkRemoved }).map((group): GroupLayout => {
      const names = new Map(group.rules.map((s) => [s, ruleDisplayName(s.rule)]));
      const rules = [...group.rules].sort((a, b) => names.get(a)!.localeCompare(names.get(b)!));
      const present = new Set(rules.map((s) => s.rule.category));
      return { group, categories: present.size > 1 ? RULE_CATEGORIES.filter((c) => present.has(c)) : [], rules };
    });
    const byId = new Map<string, { layout: GroupLayout; status: RuleStatus }>();
    for (const layout of groups) {
      for (const status of layout.rules) {
        byId.set(status.rule.id, { layout, status });
      }
    }
    model = {
      lang,
      checked,
      compared: checked.length > 0 ? rangeLabel(checked) : vscode.l10n.t('none'),
      groups,
      byKey: new Map(groups.map((g) => [g.group.key, g])),
      byId,
    };
    this.models.set(lang, model);
    return model;
  }

  private visible(layout: GroupLayout): boolean {
    return !this.availableOnlyValue || isAvailable(layout.group.relation);
  }

  private intern<T extends RuleTreeNode>(id: string, create: () => T): T {
    let node = this.nodes.get(id);
    if (!node) {
      this.nodes.set(id, (node = create()));
    }
    return node as T;
  }

  langNode(lang: Lang): RuleTreeNode {
    return this.intern(`rules:${lang}`, () => ({ type: 'ruleLang', lang }));
  }

  private groupNode(lang: Lang, key: string): RuleTreeNode {
    return this.intern(`rules:${lang}:${key}`, () => ({ type: 'ruleGroup', lang, key }));
  }

  private categoryNode(lang: Lang, key: string, category: RuleCategory): RuleTreeNode {
    return this.intern(`rules:${lang}:${key}:${category}`, () => ({ type: 'ruleCategory', lang, key, category }));
  }

  private ruleNodeFor(lang: Lang, layout: GroupLayout, status: RuleStatus): RuleTreeNode {
    const category = layout.categories.length > 0 ? status.rule.category : undefined;
    return this.intern(`rule:${status.rule.id}`, () => ({ type: 'rule', lang, key: layout.group.key, category, id: status.rule.id }));
  }

  /** Tree node of a rule, or undefined when the rule is unknown or hidden by the filter. */
  ruleNode(id: string): RuleTreeNode | undefined {
    for (const lang of LANGS) {
      const entry = this.model(lang).byId.get(id);
      if (entry) {
        return this.visible(entry.layout) ? this.ruleNodeFor(lang, entry.layout, entry.status) : undefined;
      }
    }
    return undefined;
  }

  status(id: string): RuleStatus | undefined {
    for (const lang of LANGS) {
      const entry = this.model(lang).byId.get(id);
      if (entry) {
        return entry.status;
      }
    }
    return undefined;
  }

  /** Rules a node stands for: one rule, a category of a group, a group, or a whole language. */
  statusesOf(node: RuleTreeNode): RuleStatus[] {
    const model = this.model(node.lang);
    switch (node.type) {
      case 'ruleLang':
        return model.groups.filter((g) => this.visible(g)).flatMap((g) => g.rules);
      case 'ruleGroup':
        return [...(model.byKey.get(node.key)?.rules ?? [])];
      case 'ruleCategory':
        return (model.byKey.get(node.key)?.rules ?? []).filter((s) => s.rule.category === node.category);
      case 'rule': {
        const status = model.byId.get(node.id)?.status;
        return status ? [status] : [];
      }
    }
  }

  getChildren(node?: RuleTreeNode): RuleTreeNode[] {
    if (!node) {
      return LANGS.map((lang) => this.langNode(lang));
    }
    const model = this.model(node.lang);
    switch (node.type) {
      case 'ruleLang':
        return model.groups.filter((g) => this.visible(g)).map((g) => this.groupNode(node.lang, g.group.key));
      case 'ruleGroup': {
        const layout = model.byKey.get(node.key);
        if (!layout) {
          return [];
        }
        return layout.categories.length > 0
          ? layout.categories.map((c) => this.categoryNode(node.lang, node.key, c))
          : layout.rules.map((s) => this.ruleNodeFor(node.lang, layout, s));
      }
      case 'ruleCategory': {
        const layout = model.byKey.get(node.key);
        return (layout?.rules ?? []).filter((s) => s.rule.category === node.category).map((s) => this.ruleNodeFor(node.lang, layout!, s));
      }
      case 'rule':
        return [];
    }
  }

  getParent(node: RuleTreeNode): RuleTreeNode | undefined {
    switch (node.type) {
      case 'ruleLang':
        return undefined;
      case 'ruleGroup':
        return this.langNode(node.lang);
      case 'ruleCategory':
        return this.groupNode(node.lang, node.key);
      case 'rule':
        return node.category ? this.categoryNode(node.lang, node.key, node.category) : this.groupNode(node.lang, node.key);
    }
  }

  getTreeItem(node: RuleTreeNode): vscode.TreeItem {
    const model = this.model(node.lang);
    switch (node.type) {
      case 'ruleLang':
        return this.langItem(model);
      case 'ruleGroup':
        return this.groupItem(model, node.key);
      case 'ruleCategory':
        return this.categoryItem(model, node.key, node.category);
      case 'rule':
        return this.ruleItem(model, node.id);
    }
  }

  private langItem(model: LangModel): vscode.TreeItem {
    const item = new vscode.TreeItem(langLabel(model.lang), vscode.TreeItemCollapsibleState.Expanded);
    item.id = `rules:${model.lang}`;
    item.contextValue = 'ruleLang';
    item.iconPath = new vscode.ThemeIcon('file-code');
    const customized = model.groups.reduce((n, g) => n + g.rules.filter((s) => s.customized).length, 0);
    item.description = model.compared + (customized > 0 ? ' · ' + vscode.l10n.t('{0} customized', customized) : '');
    item.tooltip = new vscode.MarkdownString(
      vscode.l10n.t('{0} rules compared with {1}. Checked features are allowed, unchecked features are reported.', langLabel(model.lang), model.compared),
    );
    return item;
  }

  private groupItem(model: LangModel, key: string): vscode.TreeItem {
    const layout = model.byKey.get(key)!;
    const group = layout.group;
    // Features of the first standard are what users most often restrict, so that group starts expanded.
    const core = group.kind === 'since' && group.std.rank === 0;
    const item = new vscode.TreeItem(groupTitle(group), core ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `rules:${model.lang}:${key}`;
    item.contextValue = 'ruleGroup';
    item.iconPath = RELATION_ICONS[group.relation];
    item.description = `${relationText(group, model.compared)} · ${allowedCount(layout.rules)}`;
    item.tooltip = new vscode.MarkdownString(`**${escapeMarkdown(groupTitle(group))}**\n\n${escapeMarkdown(relationHelp(group, model.compared, model.lang))}`);
    return item;
  }

  private categoryItem(model: LangModel, key: string, category: RuleCategory): vscode.TreeItem {
    const layout = model.byKey.get(key)!;
    const core = layout.group.kind === 'since' && layout.group.std.rank === 0;
    const item = new vscode.TreeItem(categoryLabel(category), core ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `rules:${model.lang}:${key}:${category}`;
    item.contextValue = 'ruleCategory';
    item.iconPath = new vscode.ThemeIcon(CATEGORY_ICONS[category]);
    item.description = allowedCount(layout.rules.filter((s) => s.rule.category === category));
    return item;
  }

  private ruleItem(model: LangModel, id: string): vscode.TreeItem {
    const { layout, status } = model.byId.get(id)!;
    const rule = status.rule;
    const name = ruleDisplayName(rule);
    const item = new vscode.TreeItem(name);
    item.id = `rule:${id}`;
    item.checkboxState = {
      state: status.allowed ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked,
      tooltip: status.allowed ? vscode.l10n.t('Allowed: uncheck to report uses of this feature') : vscode.l10n.t('Reported: check to allow this feature'),
    };
    item.contextValue = `rule.${status.allowed ? 'allowed' : 'reported'}${status.customized ? '.custom' : ''}`;
    const parts = [id];
    if (status.customized) {
      parts.push(vscode.l10n.t('customized'));
    }
    if (status.severity) {
      parts.push(severityLabel(status.severity));
    }
    item.description = parts.join(' · ');

    const from = (key: string | undefined): string => (key && key !== id ? ` (${vscode.l10n.t('from {0}', key)})` : '');
    const settings = getDiagnosticsSettings();
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`**${escapeMarkdown(name)}**\n\n`);
    tooltip.appendMarkdown(`\`${id}\` · ${escapeMarkdown(categoryLabel(rule.category))}\n\n`);
    const origin = layout.group.kind === 'since' ? vscode.l10n.t('Introduced in {0}', layout.group.std.label) : groupTitle(layout.group);
    tooltip.appendMarkdown(`${escapeMarkdown(origin)}  \n`);
    tooltip.appendMarkdown(`${escapeMarkdown(vscode.l10n.t('Compared with {0}', model.compared))}: ${escapeMarkdown(verdictText(status))}  \n`);
    tooltip.appendMarkdown(`${escapeMarkdown(vscode.l10n.t('Setting'))}: ${escapeMarkdown(stateLabel(status.state) + from(status.stateKey))}  \n`);
    const severity = status.severity
      ? severityLabel(status.severity) + from(status.severityKey)
      : vscode.l10n.t('Default ({0})', severityLabel(settings.severity));
    tooltip.appendMarkdown(`${escapeMarkdown(vscode.l10n.t('Severity'))}: ${escapeMarkdown(severity)}\n\n`);
    tooltip.appendMarkdown(escapeMarkdown(status.allowed ? vscode.l10n.t('Not reported') : vscode.l10n.t('Reported')));
    item.tooltip = tooltip;
    return item;
  }
}

function isRuleTreeNode(value: unknown): value is RuleTreeNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    ['ruleLang', 'ruleGroup', 'ruleCategory', 'rule'].includes((value as { type?: unknown }).type as string)
  );
}

async function confirmBulk(count: number, message: string): Promise<boolean> {
  if (count <= CONFIRM_THRESHOLD) {
    return true;
  }
  const ok = vscode.l10n.t('Continue');
  return (await vscode.window.showWarningMessage(message, { modal: true }, ok)) === ok;
}

/** Writes the overrides that make every given rule allowed (or reported). */
async function setAllowed(statuses: readonly RuleStatus[], allowed: boolean, confirm: boolean): Promise<boolean> {
  const byState = statesForAllowed(statuses, allowed);
  const count = [...byState.values()].reduce((n, ids) => n + ids.length, 0);
  if (count === 0) {
    return false;
  }
  if (confirm) {
    const message = allowed ? vscode.l10n.t('Allow {0} rules?', count) : vscode.l10n.t('Disable {0} rules?', count);
    if (!(await confirmBulk(count, message))) {
      return false;
    }
  }
  return applyRuleChanges([...byState].map(([state, ids]): RuleChangeSet => ({ ids, change: { state } })));
}

/** Removes the state and severity overrides of the given rules. */
async function resetRules(statuses: readonly RuleStatus[], confirm: boolean): Promise<boolean> {
  const ids = statuses.filter((s) => s.customized).map((s) => s.rule.id);
  if (ids.length === 0) {
    return false;
  }
  if (confirm && !(await confirmBulk(ids.length, vscode.l10n.t('Reset {0} rules to the default?', ids.length)))) {
    return false;
  }
  return applyRuleChanges([{ ids, change: { state: 'default', severity: 'default' } }]);
}

async function pickSeverity(status: RuleStatus): Promise<SeveritySetting | undefined> {
  const global = getDiagnosticsSettings().severity;
  const current: SeveritySetting = status.severity ?? 'default';
  const items = (['default', ...SEVERITIES] as const).map((value) => ({
    label: value === 'default' ? vscode.l10n.t('Default ({0})', severityLabel(global)) : severityLabel(value),
    description: value === current ? `$(check)` : undefined,
    value,
  }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: vscode.l10n.t('Severity of "{0}"', ruleDisplayName(status.rule)) });
  return pick?.value;
}

/** Lets the user search every rule and reveals the chosen one in the view. */
async function findRule(provider: SingleRulesProvider, view: vscode.TreeView<RuleTreeNode>): Promise<void> {
  const active = languageIdToLang(vscode.window.activeTextEditor?.document.languageId ?? '');
  const langs = active ? [active, ...LANGS.filter((l) => l !== active)] : [...LANGS];
  const items: Array<vscode.QuickPickItem & { id?: string }> = [];
  provider.invalidate();
  for (const lang of langs) {
    const model = provider.model(lang);
    items.push({ label: `${langLabel(lang)} · ${model.compared}`, kind: vscode.QuickPickItemKind.Separator });
    for (const layout of model.groups) {
      for (const status of layout.rules) {
        items.push({
          label: `${status.allowed ? '$(pass)' : '$(circle-slash)'} ${ruleDisplayName(status.rule)}`,
          description: status.rule.id,
          detail: [groupTitle(layout.group), categoryLabel(status.rule.category), status.allowed ? vscode.l10n.t('Not reported') : vscode.l10n.t('Reported')].join(' · '),
          id: status.rule.id,
        });
      }
    }
  }
  const pick = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Find Rule'),
    placeHolder: vscode.l10n.t('Search by name or rule id, e.g. #define or goto'),
    matchOnDescription: true,
  });
  if (!pick?.id) {
    return;
  }
  if (!provider.ruleNode(pick.id)) {
    await provider.setAvailableOnly(false);
  }
  const node = provider.ruleNode(pick.id);
  if (node) {
    await vscode.commands.executeCommand(`${SINGLE_RULES_VIEW}.focus`);
    await view.reveal(node, { select: true, focus: true, expand: true });
  }
}

/** Creates the view and registers its commands. The provider must be refreshed on settings changes. */
export function registerSingleRulesView(context: vscode.ExtensionContext, log: vscode.LogOutputChannel): SingleRulesProvider {
  const provider = new SingleRulesProvider(context.globalState);
  const view = vscode.window.createTreeView(SINGLE_RULES_VIEW, {
    treeDataProvider: provider,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  });
  provider.attach(view);

  const report = (err: unknown): void => log.error(`Could not change rules: ${String(err)}`);
  const register = (id: string, handler: (...args: any[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };
  /** Statuses of a node argument, or of the selected rule when invoked from a keybinding. */
  const statusesOf = (node: unknown): RuleStatus[] => {
    const target = isRuleTreeNode(node) ? node : view.selection[0];
    provider.invalidate(); // commands act on the current settings, not on what the tree last showed
    return target ? provider.statusesOf(target) : [];
  };

  context.subscriptions.push(
    view,
    view.onDidChangeCheckboxState((e) => {
      provider.invalidate();
      const allow: RuleStatus[] = [];
      const disable: RuleStatus[] = [];
      for (const [node, state] of e.items) {
        const status = node.type === 'rule' ? provider.status(node.id) : undefined;
        if (status) {
          (state === vscode.TreeItemCheckboxState.Checked ? allow : disable).push(status);
        }
      }
      const changes = [...statesForAllowed(allow, true), ...statesForAllowed(disable, false)];
      const merged = new Map<RuleState, string[]>();
      for (const [state, ids] of changes) {
        merged.set(state, [...(merged.get(state) ?? []), ...ids]);
      }
      applyRuleChanges([...merged].map(([state, ids]): RuleChangeSet => ({ ids, change: { state } })))
        .then((applied) => {
          if (!applied) {
            provider.refresh(); // revert the optimistic checkbox state
          }
        })
        .catch(report);
    }),
  );

  register('cppStandards.findRule', () => findRule(provider, view));
  register('cppStandards.singleRules.showAvailableOnly', () => provider.setAvailableOnly(true));
  register('cppStandards.singleRules.showAll', () => provider.setAvailableOnly(false));
  register('cppStandards.allowRule', (node?: unknown) => setAllowed(statusesOf(node), true, false));
  register('cppStandards.disableRule', (node?: unknown) => setAllowed(statusesOf(node), false, false));
  register('cppStandards.resetRule', (node?: unknown) => resetRules(statusesOf(node), false));
  register('cppStandards.allowGroup', (node?: unknown) => setAllowed(statusesOf(node), true, true));
  register('cppStandards.disableGroup', (node?: unknown) => setAllowed(statusesOf(node), false, true));
  register('cppStandards.resetGroup', (node?: unknown) => resetRules(statusesOf(node), true));
  register('cppStandards.setRuleSeverity', async (node?: unknown) => {
    const [status] = statusesOf(node);
    const severity = status && (await pickSeverity(status));
    if (status && severity) {
      await applyRuleChanges([{ ids: [status.rule.id], change: { severity } }]);
    }
  });
  register('cppStandards.copyRuleId', async (node?: unknown) => {
    const [status] = statusesOf(node);
    if (status) {
      await vscode.env.clipboard.writeText(status.rule.id);
      void vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0}', status.rule.id), 3000);
    }
  });
  return provider;
}
