import * as vscode from 'vscode';
import { RuleSettings, SEVERITIES } from './analysis/ruleSettings';
import type { SeverityName } from './analysis/ruleSettings';
import { DEFAULT_TARGET, nearestEnabled, standardsFor } from './standards';
import type { FlagStyle, Lang, StandardInfo } from './standards';

export const SECTION = 'cppStandards';

export type DiagnosticsMode = 'target' | 'allEnabled';
export type { SeverityName };

export interface LangState {
  readonly lang: Lang;
  readonly all: readonly StandardInfo[];
  /** Enabled standards, oldest first. */
  readonly enabled: readonly StandardInfo[];
  readonly disabledIds: ReadonlySet<string>;
  /** Target as written in the settings (may be disabled or missing). */
  readonly configuredTarget: StandardInfo | undefined;
  /** Target actually used: the configured one if enabled, otherwise the nearest enabled standard. */
  readonly target: StandardInfo | undefined;
  /** True when `target` differs from the configured target. */
  readonly targetAdjusted: boolean;
}

export interface DiagnosticsSettings {
  readonly enabled: boolean;
  readonly mode: DiagnosticsMode;
  readonly severity: SeverityName;
  readonly checkRemoved: boolean;
  readonly evaluatePreprocessor: boolean;
  readonly rules: RuleSettings;
  readonly exclude: readonly string[];
}

export function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

export function getLangState(lang: Lang): LangState {
  const conf = getConfig();
  const all = standardsFor(lang);
  const rawDisabled = conf.get<unknown>(`${lang}.disabled`, []);
  const disabledIds = new Set(Array.isArray(rawDisabled) ? rawDisabled.map((s) => String(s).toLowerCase()) : []);
  const enabled = all.filter((s) => !disabledIds.has(s.id));
  const configuredId = String(conf.get<string>(`${lang}.target`, DEFAULT_TARGET[lang]) ?? '').toLowerCase();
  const configuredTarget = all.find((s) => s.id === configuredId);
  let target = configuredTarget && !disabledIds.has(configuredTarget.id) ? configuredTarget : undefined;
  if (!target) {
    const fallbackRank = configuredTarget?.rank ?? all.find((s) => s.id === DEFAULT_TARGET[lang])!.rank;
    target = nearestEnabled(enabled, fallbackRank);
  }
  return { lang, all, enabled, disabledIds, configuredTarget, target, targetAdjusted: target !== configuredTarget };
}

/** Standards a file must compile with under the current diagnostics mode, oldest first. */
export function checkedStandards(state: LangState, mode: DiagnosticsMode): readonly StandardInfo[] {
  if (mode === 'allEnabled') {
    return state.enabled;
  }
  return state.target ? [state.target] : [];
}

export function getDiagnosticsSettings(): DiagnosticsSettings {
  const conf = getConfig();
  const mode = conf.get<string>('diagnostics.mode', 'target') === 'allEnabled' ? 'allEnabled' : 'target';
  const severity = conf.get<string>('diagnostics.severity', 'warning');
  return {
    enabled: conf.get<boolean>('diagnostics.enabled', true),
    mode,
    severity: SEVERITIES.find((s) => s === severity) ?? 'warning',
    checkRemoved: conf.get<boolean>('diagnostics.checkRemovedFeatures', true),
    evaluatePreprocessor: conf.get<boolean>('diagnostics.evaluatePreprocessor', true),
    rules: getRuleSettings(),
    exclude: stringArray(conf.get<unknown>('diagnostics.exclude', [])),
  };
}

/** Raw value of `cppStandards.rules`. */
export function getRawRules(): Record<string, unknown> {
  const raw = getConfig().get<unknown>('rules', {});
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** Entries of the deprecated `diagnostics.ignoredRules` setting (treated as `allow`). */
export function getLegacyAllowed(): string[] {
  return stringArray(getConfig().get<unknown>('diagnostics.ignoredRules', []));
}

export function getRuleSettings(): RuleSettings {
  return RuleSettings.parse(getRawRules(), getLegacyAllowed());
}

export function isGnu(): boolean {
  return getConfig().get<boolean>('gnuExtensions', false);
}

export function flagStyle(): FlagStyle {
  return getConfig().get<string>('compilerFlagStyle', 'gcc') === 'msvc' ? 'msvc' : 'gcc';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()) : [];
}

/** Settings are written to the workspace when one is open, otherwise to the user settings. */
export function settingsTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

export async function updateSetting(key: string, value: unknown): Promise<void> {
  await getConfig().update(key, value, settingsTarget());
}

/** True when the user has explicitly configured `key` at any level. */
export function isExplicitlySet(key: string): boolean {
  const info = getConfig().inspect(key);
  return info !== undefined && (info.globalValue !== undefined || info.workspaceValue !== undefined || info.workspaceFolderValue !== undefined);
}
