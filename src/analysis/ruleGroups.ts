/**
 * Model behind the "Single Rule" view: the rules of a language grouped by the standard that
 * introduced or removed them, each with its effective on/off state against the checked standards.
 * Pure (no VS Code API) so it can be unit tested.
 */

import { findStandard } from '../standards';
import type { Lang, StandardInfo } from '../standards';
import { standardVerdict } from './analyzer';
import type { Verdict } from './analyzer';
import { allRules } from './rules';
import type { FeatureRule, RuleKind } from './rules';
import type { RuleSettings, RuleState, SeverityName } from './ruleSettings';

/**
 * How a group's standard relates to the checked standards:
 * - `included`: the features are part of every checked standard (`since` groups up to the oldest checked one);
 * - `newer`: introduced after the oldest checked standard, so not available in it;
 * - `removed`: removed by a checked standard;
 * - `notYetRemoved`: removed only by a standard newer than every checked one, so still available.
 */
export type GroupRelation = 'included' | 'newer' | 'removed' | 'notYetRemoved';

export interface RuleStatus {
  readonly rule: FeatureRule;
  /** Behaviour without overrides. */
  readonly verdict: Verdict;
  readonly state: RuleState;
  readonly stateKey?: string;
  readonly severity?: SeverityName;
  readonly severityKey?: string;
  /** True when uses of the feature are not reported (the checkbox is on). */
  readonly allowed: boolean;
  /** True when the state or the severity is overridden in the settings. */
  readonly customized: boolean;
}

export interface RuleGroup {
  /** `since:c++11` or `removed:c++17`, the same keys as the rule settings panel. */
  readonly key: string;
  readonly kind: RuleKind;
  readonly std: StandardInfo;
  readonly relation: GroupRelation;
  readonly rules: readonly RuleStatus[];
}

export interface GroupOptions {
  readonly gnu?: boolean;
  readonly checkRemoved?: boolean;
}

export function ruleStatus(
  rule: FeatureRule,
  checked: readonly StandardInfo[],
  settings: RuleSettings,
  options: GroupOptions = {},
): RuleStatus {
  const verdict = standardVerdict(rule, checked, options);
  const resolved = settings.resolve(rule.id);
  const reported = resolved.state === 'allow' ? false : resolved.state === 'forbid' ? true : verdict.reported;
  return {
    rule,
    verdict,
    state: resolved.state,
    stateKey: resolved.stateKey,
    severity: resolved.severity,
    severityKey: resolved.severityKey,
    allowed: !reported,
    customized: resolved.state !== 'default' || resolved.severity !== undefined,
  };
}

export function groupRelation(kind: RuleKind, std: StandardInfo, checked: readonly StandardInfo[]): GroupRelation {
  if (checked.length === 0) {
    return kind === 'since' ? 'included' : 'notYetRemoved';
  }
  if (kind === 'since') {
    return std.rank <= checked[0].rank ? 'included' : 'newer';
  }
  return std.rank <= checked[checked.length - 1].rank ? 'removed' : 'notYetRemoved';
}

/** True when the group's features can be used with the checked standards. */
export function isAvailable(relation: GroupRelation): boolean {
  return relation === 'included' || relation === 'notYetRemoved';
}

/**
 * Rules of `lang` grouped by kind and standard: `since` groups oldest first, then `removed`
 * groups oldest first. Rules keep their definition order.
 */
export function ruleGroups(
  lang: Lang,
  checked: readonly StandardInfo[],
  settings: RuleSettings,
  options: GroupOptions = {},
): RuleGroup[] {
  const map = new Map<string, { kind: RuleKind; std: StandardInfo; rules: RuleStatus[] }>();
  for (const rule of allRules()) {
    const std = rule.lang === lang ? findStandard(rule.std) : undefined;
    if (!std) {
      continue;
    }
    const key = `${rule.kind}:${std.id}`;
    let group = map.get(key);
    if (!group) {
      map.set(key, (group = { kind: rule.kind, std, rules: [] }));
    }
    group.rules.push(ruleStatus(rule, checked, settings, options));
  }
  return [...map.entries()]
    .map(([key, g]): RuleGroup => ({ key, kind: g.kind, std: g.std, relation: groupRelation(g.kind, g.std, checked), rules: g.rules }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'since' ? -1 : 1) || a.std.rank - b.std.rank);
}

/**
 * State that makes a rule allowed (`allowed` true) or reported (`allowed` false), given whether
 * the checked standards report it by default. Prefers `default` so that changing the target
 * standard later keeps working for rules the user did not need to override.
 */
export function stateFor(defaultReported: boolean, allowed: boolean): RuleState {
  if (allowed) {
    return defaultReported ? 'allow' : 'default';
  }
  return defaultReported ? 'default' : 'forbid';
}

/**
 * Rule ids grouped by the state that gives each of them the requested on/off value. Rules that
 * already have that value are left out, so their existing overrides are kept.
 */
export function statesForAllowed(statuses: readonly RuleStatus[], allowed: boolean): Map<RuleState, string[]> {
  const result = new Map<RuleState, string[]>();
  for (const status of statuses) {
    if (status.allowed === allowed) {
      continue;
    }
    const state = stateFor(status.verdict.reported, allowed);
    const list = result.get(state) ?? [];
    list.push(status.rule.id);
    result.set(state, list);
  }
  return result;
}
