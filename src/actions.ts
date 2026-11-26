/**
 * State-changing operations shared by commands, the tree view and quick fixes.
 */

import * as vscode from 'vscode';
import { getRule } from './analysis/rules';
import { updateRuleSettings } from './analysis/ruleSettings';
import type { RuleChange } from './analysis/ruleSettings';
import { getConfig, getLangState, getLegacyAllowed, getRawRules, settingsTarget, updateSetting } from './config';
import { findStandard, langLabel, nearestEnabled } from './standards';
import type { Lang, StandardInfo } from './standards';

/**
 * Applies enable/disable changes for `lang`. Refuses to disable every standard. When the target
 * gets disabled it moves to the nearest enabled standard. Returns false when nothing was applied.
 */
export async function applyEnabledChanges(lang: Lang, changes: ReadonlyMap<string, boolean>): Promise<boolean> {
  const state = getLangState(lang);
  const disabled = new Set(state.disabledIds);
  for (const [id, enabled] of changes) {
    if (enabled) {
      disabled.delete(id);
    } else {
      disabled.add(id);
    }
  }
  const remaining = state.all.filter((s) => !disabled.has(s.id));
  if (remaining.length === 0) {
    void vscode.window.showWarningMessage(vscode.l10n.t('At least one {0} standard must stay enabled.', langLabel(lang)));
    return false;
  }
  const ordered = state.all.filter((s) => disabled.has(s.id)).map((s) => s.id);
  let newTarget: StandardInfo | undefined;
  const current = state.configuredTarget;
  if (!current || disabled.has(current.id)) {
    newTarget = nearestEnabled(remaining, current?.rank ?? remaining[remaining.length - 1].rank);
  }
  if (newTarget) {
    await updateSetting(`${lang}.target`, newTarget.id);
  }
  await updateSetting(`${lang}.disabled`, ordered);
  if (newTarget && current && current.id !== newTarget.id) {
    void vscode.window.showInformationMessage(
      vscode.l10n.t('{0} was the target standard and is now disabled; the target is now {1}.', current.label, newTarget.label),
    );
  }
  return true;
}

/** Sets the target standard, enabling it first when `enable` is true. */
export async function setTarget(lang: Lang, id: string, enable = false): Promise<boolean> {
  const std = findStandard(id);
  if (!std || std.lang !== lang) {
    return false;
  }
  const state = getLangState(lang);
  if (state.disabledIds.has(std.id)) {
    if (!enable) {
      return false;
    }
    await updateSetting(`${lang}.disabled`, state.all.filter((s) => state.disabledIds.has(s.id) && s.id !== std.id).map((s) => s.id));
  }
  await updateSetting(`${lang}.target`, std.id);
  return true;
}

/**
 * Disables the standards outside [min, maxExclusive). Used by quick fixes in "all enabled" mode
 * to raise the minimum standard or to drop standards that removed a feature.
 */
export async function disableOutside(lang: Lang, range: { min?: string; maxExclusive?: string }): Promise<boolean> {
  const state = getLangState(lang);
  const min = findStandard(range.min)?.rank ?? -Infinity;
  const max = findStandard(range.maxExclusive)?.rank ?? Infinity;
  const changes = new Map<string, boolean>();
  for (const std of state.enabled) {
    if (std.rank < min || std.rank >= max) {
      changes.set(std.id, false);
    }
  }
  return changes.size > 0 && applyEnabledChanges(lang, changes);
}

/** Sets the state and/or severity of the given rules in `cppStandards.rules`. */
export async function setRules(ids: readonly string[], change: RuleChange): Promise<void> {
  await applyRuleChanges([{ ids, change }]);
}

export interface RuleChangeSet {
  readonly ids: readonly string[];
  readonly change: RuleChange;
}

/**
 * Applies several rule changes with a single settings write (e.g. allowing a group of rules,
 * some of which need `allow` and others `default`). Returns false when nothing changed.
 */
export async function applyRuleChanges(changes: readonly RuleChangeSet[]): Promise<boolean> {
  // Only the level being written is modified; the merged value supplies what rules inherit
  // (prefix keys at any level and exact keys from the other level).
  const info = getConfig().inspect<Record<string, unknown>>('rules');
  const own = (settingsTarget() === vscode.ConfigurationTarget.Workspace ? info?.workspaceValue : info?.globalValue) ?? {};
  const merged = getRawRules();
  const inherited = Object.fromEntries(Object.entries(merged).filter(([key]) => key.endsWith('*') || !(key in own)));
  const options = { legacyAllowed: getLegacyAllowed(), inherited };
  let updated: Record<string, unknown> = own;
  for (const { ids, change } of changes) {
    const valid = ids.filter((id) => getRule(id) !== undefined);
    if (valid.length > 0 && (change.state !== undefined || change.severity !== undefined)) {
      updated = updateRuleSettings(updated, valid, change, options);
    }
  }
  if (JSON.stringify(updated) === JSON.stringify(own)) {
    return false;
  }
  await updateSetting('rules', Object.keys(updated).length > 0 ? updated : undefined);
  return true;
}
