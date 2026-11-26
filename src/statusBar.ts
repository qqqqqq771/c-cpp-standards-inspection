import * as vscode from 'vscode';
import { getConfig, getLangState, isGnu } from './config';
import { langLabel, languageIdToLang } from './standards';
import type { Lang } from './standards';

function commandLink(command: string, args: unknown[]): string {
  return `command:${command}?${encodeURIComponent(JSON.stringify(args))}`;
}

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('cppStandards.status', vscode.StatusBarAlignment.Right, 100);
  private readonly disposables: vscode.Disposable[] = [this.item];

  constructor() {
    this.item.name = vscode.l10n.t('C/C++ Target Standard');
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.update()),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc === vscode.window.activeTextEditor?.document) {
          this.update();
        }
      }),
    );
    this.update();
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  update(): void {
    const doc = vscode.window.activeTextEditor?.document;
    const lang = doc ? languageIdToLang(doc.languageId) : undefined;
    if (!lang || !getConfig().get<boolean>('statusBar.enabled', true)) {
      this.item.hide();
      return;
    }
    this.render(lang);
    this.item.show();
  }

  private render(lang: Lang): void {
    const state = getLangState(lang);
    const label = langLabel(lang);
    const gnu = isGnu();
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.isTrusted = true;

    if (!state.target) {
      this.item.text = `$(error) ${vscode.l10n.t('{0}: no standard', label)}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      tooltip.appendMarkdown(vscode.l10n.t('Every {0} standard is disabled.', label));
    } else {
      const suffix = gnu ? ' (GNU)' : '';
      this.item.text = `${state.targetAdjusted ? '$(warning)' : '$(versions)'} ${state.target.label}${suffix}`;
      this.item.backgroundColor = state.targetAdjusted ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      tooltip.appendMarkdown(`**${vscode.l10n.t('{0} target standard', label)}:** ${state.target.label}${suffix}\n\n`);
      if (state.targetAdjusted) {
        const configured = state.configuredTarget?.label ?? String(getConfig().get(`${lang}.target`));
        tooltip.appendMarkdown(`$(warning) ${vscode.l10n.t('The configured target {0} is disabled or unknown; using {1}.', configured, state.target.label)}\n\n`);
      }
    }
    const enabled = state.enabled.map((s) => s.label).join(' · ') || '—';
    const disabled = state.all.filter((s) => state.disabledIds.has(s.id)).map((s) => s.label).join(' · ') || '—';
    tooltip.appendMarkdown(`${vscode.l10n.t('Enabled')}: ${enabled}\n\n${vscode.l10n.t('Disabled')}: ${disabled}\n\n---\n\n`);
    tooltip.appendMarkdown(
      `[$(target) ${vscode.l10n.t('Change target')}](${commandLink('cppStandards.selectStandard', [lang])}) · ` +
        `[$(checklist) ${vscode.l10n.t('Enable/disable standards')}](${commandLink('cppStandards.manageStandards', [lang])}) · ` +
        `[$(settings-edit) ${vscode.l10n.t('Configure Rules')}](${commandLink('cppStandards.configureRules', [lang])})`,
    );
    this.item.tooltip = tooltip;
    this.item.command = { title: vscode.l10n.t('Change target'), command: 'cppStandards.selectStandard', arguments: [lang] };
    this.item.accessibilityInformation = {
      label: vscode.l10n.t('{0} target standard', label) + `: ${state.target?.label ?? '—'}`,
    };
  }
}
