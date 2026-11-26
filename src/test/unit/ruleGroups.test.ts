/**
 * Model of the "Single Rule" view: rules grouped by standard, their on/off state, and the
 * overrides needed to switch them.
 */

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { groupRelation, isAvailable, ruleGroups, stateFor, statesForAllowed } from '../../analysis/ruleGroups';
import type { RuleGroup, RuleStatus } from '../../analysis/ruleGroups';
import { RuleSettings } from '../../analysis/ruleSettings';
import { findStandard } from '../../standards';
import { stds } from './helpers';

const groups = (checked: string | string[], raw: Record<string, unknown> = {}, options = {}): RuleGroup[] =>
  ruleGroups('cpp', stds(checked), RuleSettings.parse(raw), options);

function status(list: readonly RuleGroup[], id: string): RuleStatus {
  const found = list.flatMap((g) => g.rules).find((s) => s.rule.id === id);
  assert.ok(found, `rule ${id} not found`);
  return found;
}

describe('single rule view model', () => {
  test('groups since rules oldest first, then removed rules, with their relation to the target', () => {
    const list = groups('c++20');
    assert.deepEqual(
      list.map((g) => [g.key, g.relation]),
      [
        ['since:c++98', 'included'],
        ['since:c++11', 'included'],
        ['since:c++14', 'included'],
        ['since:c++17', 'included'],
        ['since:c++20', 'included'],
        ['since:c++23', 'newer'],
        ['since:c++26', 'newer'],
        ['removed:c++14', 'removed'],
        ['removed:c++17', 'removed'],
        ['removed:c++20', 'removed'],
        ['removed:c++23', 'notYetRemoved'],
        ['removed:c++26', 'notYetRemoved'],
      ],
    );
    assert.ok(list.every((g) => g.rules.every((s) => s.rule.lang === 'cpp' && `${s.rule.kind}:${s.rule.std}` === g.key)));
  });

  test('every rule of the language appears exactly once', () => {
    const ids = groups('c++17').flatMap((g) => g.rules.map((s) => s.rule.id));
    assert.equal(new Set(ids).size, ids.length);
    const cGroups = ruleGroups('c', stds('c17'), RuleSettings.empty);
    assert.ok(cGroups.flatMap((g) => g.rules).every((s) => s.rule.lang === 'c'));
    assert.equal(cGroups[0].key, 'since:c89');
  });

  test('relations in all-enabled mode use the oldest and newest checked standards', () => {
    const range = stds(['c++11', 'c++14', 'c++17']);
    assert.equal(groupRelation('since', findStandard('c++11')!, range), 'included');
    assert.equal(groupRelation('since', findStandard('c++14')!, range), 'newer');
    assert.equal(groupRelation('removed', findStandard('c++17')!, range), 'removed');
    assert.equal(groupRelation('removed', findStandard('c++20')!, range), 'notYetRemoved');
    assert.ok(isAvailable('included') && isAvailable('notYetRemoved') && !isAvailable('newer') && !isAvailable('removed'));
  });

  test('features of the standard are allowed by default, newer and removed ones are not', () => {
    const list = groups('c++20');
    assert.equal(status(list, 'cpp98.macro-constant').allowed, true);
    assert.equal(status(list, 'cpp20.coroutines').allowed, true);
    assert.equal(status(list, 'cpp23.lib.print').allowed, false);
    assert.equal(status(list, 'cpp17.removed.register').allowed, false);
    assert.equal(status(list, 'cpp26.removed.lib.strstream').allowed, true);
    assert.ok(list.flatMap((g) => g.rules).every((s) => !s.customized));
  });

  test('overrides, prefix keys and severities are reflected', () => {
    const list = groups('c++20', { 'cpp98.macro-constant': 'forbid', 'cpp23.lib.*': 'allow', 'cpp20.concept': { severity: 'error' } });
    const macro = status(list, 'cpp98.macro-constant');
    assert.deepEqual([macro.allowed, macro.customized, macro.state, macro.stateKey], [false, true, 'forbid', 'cpp98.macro-constant']);
    const print = status(list, 'cpp23.lib.print');
    assert.deepEqual([print.allowed, print.customized, print.stateKey], [true, true, 'cpp23.lib.*']);
    const concept = status(list, 'cpp20.concept');
    assert.deepEqual([concept.allowed, concept.customized, concept.severity], [true, true, 'error']);
  });

  test('GNU extensions and unchecked removals count as allowed', () => {
    const gnu = groups('c++03', {}, { gnu: true });
    assert.equal(status(gnu, 'cpp11.long-long').allowed, true);
    assert.equal(status(gnu, 'cpp11.long-long').verdict.kind, 'gnu');
    const unchecked = groups('c++20', {}, { checkRemoved: false });
    assert.equal(status(unchecked, 'cpp17.removed.register').allowed, true);
  });

  test('the state that switches a rule prefers the default behaviour', () => {
    assert.equal(stateFor(false, false), 'forbid'); // supported by the standard, disable it
    assert.equal(stateFor(false, true), 'default');
    assert.equal(stateFor(true, true), 'allow'); // not in the standard, allow it anyway
    assert.equal(stateFor(true, false), 'default');
  });

  test('bulk changes only touch rules that need it and pick the right state for each', () => {
    const list = groups('c++14', { 'cpp17.lib.any': 'allow', 'cpp11.auto': 'forbid' });
    const statuses = ['cpp11.auto', 'cpp11.nullptr', 'cpp17.lib.any', 'cpp17.lib.optional'].map((id) => status(list, id));
    assert.deepEqual(Object.fromEntries(statesForAllowed(statuses, true)), { default: ['cpp11.auto'], allow: ['cpp17.lib.optional'] });
    assert.deepEqual(Object.fromEntries(statesForAllowed(statuses, false)), { forbid: ['cpp11.nullptr'], default: ['cpp17.lib.any'] });
  });
});
