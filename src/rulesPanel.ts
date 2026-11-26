/**
 * "Rule Settings" webview: lists every rule of a language next to the selected standard and lets
 * the user allow, forbid or reset each rule (or a filtered group of rules) and set its severity.
 */

import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { setRules, setTarget } from './actions';
import { standardVerdict } from './analysis/analyzer';
import type { VerdictKind } from './analysis/analyzer';
import { allRules } from './analysis/rules';
import type { RuleCategory } from './analysis/rules';
import { RULE_STATES, SEVERITIES } from './analysis/ruleSettings';
import type { RuleState, SeveritySetting } from './analysis/ruleSettings';
import { checkedStandards, getDiagnosticsSettings, getLangState, isGnu, updateSetting } from './config';
import { ruleDisplayName } from './diagnostics';
import { panelHtml } from './rulesPanelHtml';
import { LANGS, langLabel, rangeLabel } from './standards';
import type { Lang } from './standards';

/** Bulk changes above this size ask for confirmation. */
const CONFIRM_THRESHOLD = 20;

interface RuleRow {
  readonly id: string;
  readonly name: string;
  readonly category: RuleCategory;
  readonly kind: 'since' | 'removed';
  readonly std: string;
  readonly verdict: VerdictKind;
  readonly offending?: string;
  readonly state: RuleState;
  readonly stateKey?: string;
  readonly severity?: string;
  readonly severityKey?: string;
  readonly reported: boolean;
}

export interface PanelOptions {
  readonly lang?: Lang;
  /** Initial search text, e.g. a rule id from a quick fix. */
  readonly search?: string;
}

function strings(): Record<string, string> {
  return {
    language: vscode.l10n.t('Language'),
    compareWith: vscode.l10n.t('Compare against'),
    modeTarget: vscode.l10n.t('The target standard'),
    modeAll: vscode.l10n.t('Every enabled standard'),
    standard: vscode.l10n.t('Standard'),
    search: vscode.l10n.t('Search by name or rule id'),
    allCategories: vscode.l10n.t('All categories'),
    'category.language': vscode.l10n.t('Language features'),
    'category.literal': vscode.l10n.t('Literals'),
    'category.library': vscode.l10n.t('Standard library'),
    'category.header': vscode.l10n.t('Headers'),
    'category.attribute': vscode.l10n.t('Attributes'),
    'category.preprocessor': vscode.l10n.t('Preprocessor'),
    'status.all': vscode.l10n.t('All rules'),
    'status.reported': vscode.l10n.t('Reported'),
    'status.notReported': vscode.l10n.t('Not reported'),
    'status.unsupported': vscode.l10n.t('Not supported by the standard'),
    'status.supported': vscode.l10n.t('Supported by the standard'),
    'status.custom': vscode.l10n.t('Customized'),
    'state.default': vscode.l10n.t('Default'),
    'state.allow': vscode.l10n.t('Allow'),
    'state.forbid': vscode.l10n.t('Forbid'),
    'stateTip.default': vscode.l10n.t('Follow the standard'),
    'stateTip.allow': vscode.l10n.t('Never report this feature'),
    'stateTip.forbid': vscode.l10n.t('Always report this feature, even if the standard supports it'),
    'bulk.allow': vscode.l10n.t('Allow all'),
    'bulk.forbid': vscode.l10n.t('Forbid all'),
    'bulk.default': vscode.l10n.t('Reset all'),
    bulkScope: vscode.l10n.t('Applies to the rules currently shown'),
    severityDefault: vscode.l10n.t('Default ({0})'),
    'severity.error': vscode.l10n.t('Error'),
    'severity.warning': vscode.l10n.t('Warning'),
    'severity.information': vscode.l10n.t('Information'),
    'severity.hint': vscode.l10n.t('Hint'),
    'verdict.supported': vscode.l10n.t('Supported'),
    'verdict.unsupported': vscode.l10n.t('Not available in {0}'),
    'verdict.removed': vscode.l10n.t('Removed; not available in {0}'),
    'verdict.gnu': vscode.l10n.t('Allowed as a GNU extension'),
    'verdict.removedUnchecked': vscode.l10n.t('Removed (check is off)'),
    'verdict.none': vscode.l10n.t('No standard selected'),
    groupSince: vscode.l10n.t('Introduced in {0}'),
    groupRemoved: vscode.l10n.t('Removed in {0}'),
    reported: vscode.l10n.t('Reported'),
    notReported: vscode.l10n.t('Not reported'),
    inheritedFrom: vscode.l10n.t('from {0}'),
    summary: vscode.l10n.t('{0} rules · {1} reported · {2} customized'),
    customizedCount: vscode.l10n.t('{0} customized'),
    colFeature: vscode.l10n.t('Feature'),
    colCompare: vscode.l10n.t('Compared with {0}'),
    colSetting: vscode.l10n.t('Setting'),
    colSeverity: vscode.l10n.t('Severity'),
    colResult: vscode.l10n.t('Result'),
    openSettings: vscode.l10n.t('Edit in settings.json'),
    noMatches: vscode.l10n.t('No rules match the filters.'),
    expand: vscode.l10n.t('Expand'),
    collapse: vscode.l10n.t('Collapse'),
  };
}

export class RulesPanel implements vscode.Disposable {
  private static current: RulesPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private lang: Lang;
  private pendingSearch: string | undefined;

  static show(extensionUri: vscode.Uri, options: PanelOptions = {}): void {
    const lang = options.lang ?? RulesPanel.current?.lang ?? RulesPanel.langFromEditor();
    if (RulesPanel.current) {
      const panel = RulesPanel.current;
      panel.lang = lang;
      panel.pendingSearch = options.search;
      panel.panel.reveal();
      panel.post();
      return;
    }
    RulesPanel.current = new RulesPanel(extensionUri, lang, options.search);
  }

  /** Pushes fresh data after a settings change. */
  static refresh(): void {
    RulesPanel.current?.post();
  }

  static close(): void {
    RulesPanel.current?.dispose();
  }

  private static langFromEditor(): Lang {
    return vscode.window.activeTextEditor?.document.languageId === 'c' ? 'c' : 'cpp';
  }

  private constructor(private readonly extensionUri: vscode.Uri, lang: Lang, search: string | undefined) {
    this.lang = lang;
    this.pendingSearch = search;
    const media = vscode.Uri.joinPath(extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel('cppStandards.rules', vscode.l10n.t('C/C++ Rule Settings'), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [media],
    });
    this.panel.iconPath = vscode.Uri.joinPath(media, 'activitybar.svg');
    this.panel.webview.html = this.html();
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((msg) => {
        this.onMessage(msg).catch((err) => void vscode.window.showErrorMessage(String(err)));
      }),
    );
  }

  dispose(): void {
    if (RulesPanel.current === this) {
      RulesPanel.current = undefined;
    }
    vscode.Disposable.from(...this.disposables).dispose();
    this.panel.dispose();
  }

  private async onMessage(msg: unknown): Promise<void> {
    if (typeof msg !== 'object' || msg === null) {
      return;
    }
    const m = msg as Record<string, unknown>;
    switch (m.type) {
      case 'ready':
        this.post();
        break;
      case 'setLang':
        if (m.lang === 'c' || m.lang === 'cpp') {
          this.lang = m.lang;
          this.post();
        }
        break;
      case 'setMode':
        if (m.mode === 'target' || m.mode === 'allEnabled') {
          await updateSetting('diagnostics.mode', m.mode);
        }
        break;
      case 'setTarget':
        if (typeof m.id === 'string') {
          await setTarget(this.lang, m.id);
        }
        break;
      case 'setRules':
        await this.applyRules(m);
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'cppStandards.rules');
        break;
    }
  }

  private async applyRules(m: Record<string, unknown>): Promise<void> {
    const ids = Array.isArray(m.ids) ? m.ids.filter((id): id is string => typeof id === 'string') : [];
    const state = (RULE_STATES as readonly unknown[]).includes(m.state) ? (m.state as RuleState) : undefined;
    const severity = ([...SEVERITIES, 'default'] as readonly unknown[]).includes(m.severity) ? (m.severity as SeveritySetting) : undefined;
    if (ids.length === 0 || (state === undefined && severity === undefined)) {
      return;
    }
    if (ids.length > CONFIRM_THRESHOLD && state !== undefined) {
      const stateLabel = strings()[`state.${state}`];
      const ok = vscode.l10n.t('Continue');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Set {0} rules to "{1}"?', ids.length, stateLabel),
        { modal: true },
        ok,
      );
      if (choice !== ok) {
        return;
      }
    }
    await setRules(ids, { state, severity });
  }

  private post(): void {
    void this.panel.webview.postMessage({ type: 'data', payload: this.data() });
    if (this.pendingSearch !== undefined) {
      void this.panel.webview.postMessage({ type: 'search', search: this.pendingSearch });
      this.pendingSearch = undefined;
    }
  }

  private data(): unknown {
    const state = getLangState(this.lang);
    const settings = getDiagnosticsSettings();
    const checked = checkedStandards(state, settings.mode);
    const gnu = isGnu();
    const rows: RuleRow[] = allRules()
      .filter((rule) => rule.lang === this.lang)
      .map((rule) => {
        const verdict = standardVerdict(rule, checked, { gnu, checkRemoved: settings.checkRemoved });
        const resolved = settings.rules.resolve(rule.id);
        const reported = resolved.state === 'allow' ? false : resolved.state === 'forbid' ? true : verdict.reported;
        return {
          id: rule.id,
          name: ruleDisplayName(rule),
          category: rule.category,
          kind: rule.kind,
          std: rule.std,
          verdict: verdict.kind,
          offending: verdict.offending?.label,
          state: resolved.state,
          stateKey: resolved.stateKey,
          severity: resolved.severity,
          severityKey: resolved.severityKey,
          reported,
        };
      });
    return {
      lang: this.lang,
      langs: LANGS.map((id) => ({ id, label: langLabel(id) })),
      standards: state.all.map((s) => ({ id: s.id, label: s.label, enabled: !state.disabledIds.has(s.id) })),
      target: state.target?.id,
      mode: settings.mode,
      compared: rangeLabel(checked),
      globalSeverity: settings.severity,
      rows,
      strings: strings(),
    };
  }

  private html(): string {
    const webview = this.panel.webview;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'rules.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'rules.css'));
    return panelHtml({
      cspSource: webview.cspSource,
      nonce: randomBytes(16).toString('hex'),
      scriptUri: script.toString(),
      styleUri: style.toString(),
      language: vscode.env.language,
      title: vscode.l10n.t('C/C++ Rule Settings'),
    });
  }
}
