import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { standardVerdict } from '../../analysis/analyzer';
import { allRules, getRule, RULE_CATEGORIES } from '../../analysis/rules';
import { LEGACY_KEY, normalizeEntry, RuleSettings, updateRuleSettings } from '../../analysis/ruleSettings';
import { ids, stds, violations } from './helpers';

describe('rule settings', () => {
  test('normalizes entries', () => {
    assert.deepEqual(normalizeEntry('forbid'), { state: 'forbid' });
    assert.deepEqual(normalizeEntry({ severity: 'error' }), { severity: 'error' });
    assert.deepEqual(normalizeEntry({ state: 'allow', severity: 'bogus' }), { state: 'allow' });
    assert.equal(normalizeEntry('nope'), undefined);
    assert.equal(normalizeEntry({}), undefined);
    assert.equal(normalizeEntry(['allow']), undefined);
  });

  test('exact ids beat prefixes and longer prefixes beat shorter ones', () => {
    const settings = RuleSettings.parse({
      'cpp20.*': 'forbid',
      'cpp20.lib.*': 'allow',
      'cpp20.lib.span': 'default',
      'cpp20.concept': { severity: 'error' },
    });
    assert.deepEqual(settings.resolve('cpp20.coroutines'), { state: 'forbid', stateKey: 'cpp20.*', severity: undefined, severityKey: undefined });
    assert.equal(settings.resolve('cpp20.lib.format').state, 'allow');
    assert.equal(settings.resolve('cpp20.lib.span').state, 'default');
    assert.equal(settings.resolve('cpp20.lib.span').stateKey, 'cpp20.lib.span');
    // State and severity resolve independently.
    assert.deepEqual(settings.resolve('cpp20.concept'), { state: 'forbid', stateKey: 'cpp20.*', severity: 'error', severityKey: 'cpp20.concept' });
    assert.deepEqual(settings.resolve('cpp17.lib.optional'), { state: 'default', stateKey: undefined, severity: undefined, severityKey: undefined });
    assert.equal(RuleSettings.parse({}).isEmpty, true);
    assert.equal(settings.isEmpty, false);
  });

  test('the deprecated ignoredRules list acts as a low-priority "allow"', () => {
    const settings = RuleSettings.parse({ 'cpp17.lib.any': 'forbid' }, ['cpp17.lib.*', 'cpp17.lib.any']);
    assert.deepEqual(
      [settings.resolve('cpp17.lib.optional').state, settings.resolve('cpp17.lib.optional').stateKey],
      ['allow', LEGACY_KEY],
    );
    assert.equal(settings.resolve('cpp17.lib.any').state, 'forbid');
  });

  test('updates store only what differs from the inherited value', () => {
    let raw = updateRuleSettings({}, ['cpp20.coroutines'], { state: 'forbid' });
    assert.deepEqual(raw, { 'cpp20.coroutines': 'forbid' });
    raw = updateRuleSettings(raw, ['cpp20.coroutines'], { severity: 'error' });
    assert.deepEqual(raw, { 'cpp20.coroutines': { state: 'forbid', severity: 'error' } });
    raw = updateRuleSettings(raw, ['cpp20.coroutines'], { state: 'default' });
    assert.deepEqual(raw, { 'cpp20.coroutines': { severity: 'error' } });
    raw = updateRuleSettings(raw, ['cpp20.coroutines'], { severity: 'default' });
    assert.deepEqual(raw, {});
  });

  test('resetting a rule under a prefix stores an explicit default', () => {
    const raw = updateRuleSettings({ 'cpp20.*': 'forbid' }, ['cpp20.concept', 'cpp20.requires'], { state: 'default' });
    assert.deepEqual(raw, { 'cpp20.*': 'forbid', 'cpp20.concept': 'default', 'cpp20.requires': 'default' });
    // Setting it back to the inherited value removes the entry again.
    assert.deepEqual(updateRuleSettings(raw, ['cpp20.concept'], { state: 'forbid' }), { 'cpp20.*': 'forbid', 'cpp20.requires': 'default' });
    // Entries inherited from another settings level are honoured too.
    assert.deepEqual(updateRuleSettings({}, ['cpp20.concept'], { state: 'default' }, { inherited: { 'cpp20.concept': 'allow' } }), {
      'cpp20.concept': 'default',
    });
    assert.deepEqual(updateRuleSettings({}, ['cpp17.lib.any'], { state: 'default' }, { legacyAllowed: ['cpp17.lib.any'] }), {
      'cpp17.lib.any': 'default',
    });
  });
});

describe('allow and forbid in the analyzer', () => {
  const settings = (raw: unknown) => {
    const parsed = RuleSettings.parse(raw);
    return (id: string) => {
      const state = parsed.resolve(id).state;
      return state === 'default' ? undefined : state;
    };
  };

  test('forbid reports features the standard supports', () => {
    const src = 'task f() { co_await g(); }\nauto x = 1;';
    assert.deepEqual(ids(src, 'cpp', 'c++20'), []);
    const vs = violations(src, 'cpp', 'c++20', { ruleState: settings({ 'cpp20.coroutines': 'forbid' }) });
    assert.deepEqual(vs.map((v) => [v.rule.id, v.reason, v.offending]), [['cpp20.coroutines', 'forbidden', undefined]]);
  });

  test('a forbidden rule that the standard also rejects keeps the standard reason', () => {
    const vs = violations('task f() { co_await g(); }', 'cpp', 'c++17', { ruleState: settings({ 'cpp20.*': 'forbid' }) });
    assert.deepEqual(vs.map((v) => [v.reason, v.offending?.id]), [['standard', 'c++17']]);
  });

  test('allow hides unsupported features, including through prefixes', () => {
    assert.deepEqual(ids('std::optional<int> o; std::any a;', 'cpp', 'c++14', { ruleState: settings({ 'cpp17.lib.*': 'allow' }) }), []);
    assert.deepEqual(ids('std::optional<int> o; std::any a;', 'cpp', 'c++14', { ruleState: settings({ 'cpp17.lib.*': 'allow', 'cpp17.lib.any': 'default' }) }), [
      'cpp17.lib.any',
    ]);
  });

  test('forbid wins over GNU extensions and the removed-feature switch', () => {
    assert.deepEqual(ids('long long x;', 'cpp', 'c++03', { gnu: true, ruleState: settings({ 'cpp11.long-long': 'forbid' }) }), ['cpp11.long-long']);
    assert.deepEqual(ids('register int r;', 'cpp', 'c++14', { checkRemoved: false, ruleState: settings({ 'cpp17.removed.register': 'forbid' }) }), [
      'cpp17.removed.register',
    ]);
  });

  test('forbidden code in an inactive #if branch is not reported', () => {
    const src = '#if __cplusplus >= 202302L\nimport std;\n#endif';
    assert.deepEqual(ids(src, 'cpp', 'c++20', { ruleState: settings({ 'cpp23.import-std': 'forbid' }) }), []);
  });
});

describe('standard verdicts', () => {
  test('compare a rule with the checked standards', () => {
    const optional = getRule('cpp17.lib.optional')!;
    assert.deepEqual(standardVerdict(optional, stds('c++17')), { kind: 'supported', reported: false });
    const unsupported = standardVerdict(optional, stds('c++14'));
    assert.equal(unsupported.kind, 'unsupported');
    assert.equal(unsupported.offending?.id, 'c++14');
    assert.equal(standardVerdict(optional, stds(['c++11', 'c++20'])).offending?.id, 'c++11');
    const register = getRule('cpp17.removed.register')!;
    assert.equal(standardVerdict(register, stds('c++20')).kind, 'removed');
    assert.equal(standardVerdict(register, stds('c++20'), { checkRemoved: false }).kind, 'removedUnchecked');
    assert.equal(standardVerdict(getRule('cpp11.long-long')!, stds('c++03'), { gnu: true }).kind, 'gnu');
    assert.equal(standardVerdict(optional, []).kind, 'none');
  });

  test('every rule has a known category', () => {
    for (const rule of allRules()) {
      assert.ok(RULE_CATEGORIES.includes(rule.category), rule.id);
    }
    assert.equal(getRule('cpp26.embed')!.category, 'preprocessor');
    assert.equal(getRule('cpp17.header.optional')!.category, 'header');
    assert.equal(getRule('cpp17.attr.nodiscard')!.category, 'attribute');
    assert.equal(getRule('cpp14.digit-separator')!.category, 'literal');
    assert.equal(getRule('c99.line-comment')!.category, 'language');
  });
});
