import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { allRules } from '../../analysis/rules';
import { findStandard, nearestEnabled, compilerFlag, CPP_STANDARDS, C_STANDARDS } from '../../standards';

describe('rule table integrity', () => {
  test('rule ids are unique', () => {
    const seen = new Set<string>();
    for (const rule of allRules()) {
      assert.ok(!seen.has(rule.id), `duplicate rule id ${rule.id}`);
      seen.add(rule.id);
    }
  });

  test('every rule references a standard of its own language', () => {
    for (const rule of allRules()) {
      const std = findStandard(rule.std);
      assert.ok(std, `${rule.id}: unknown standard ${rule.std}`);
      assert.equal(std.lang, rule.lang, `${rule.id}: language mismatch`);
      // Features of the oldest standard exist in every standard ("core" rules that can only be
      // forbidden); nothing can have been removed by it.
      assert.ok(std.rank > 0 || rule.kind === 'since', `${rule.id}: the oldest standard cannot remove a feature`);
    }
  });

  test('every rule has exactly one detector and patterns compile with the analyzer flags', () => {
    for (const rule of allRules()) {
      const detectors = [rule.pattern, rule.token, rule.lookup].filter((d) => d !== undefined).length;
      assert.equal(detectors, 1, rule.id);
      if (rule.pattern) {
        assert.doesNotThrow(() => new RegExp(rule.pattern!.source, rule.pattern!.flags + 'gd'), rule.id);
      }
    }
  });
});

describe('standards metadata', () => {
  test('ranks follow chronological order', () => {
    for (const list of [CPP_STANDARDS, C_STANDARDS]) {
      list.forEach((std, i) => assert.equal(std.rank, i));
      for (let i = 1; i < list.length; i++) {
        assert.ok(list[i].year > list[i - 1].year);
      }
    }
  });

  test('nearestEnabled prefers the newest older standard', () => {
    const enabled = CPP_STANDARDS.filter((s) => ['c++11', 'c++14', 'c++20'].includes(s.id));
    assert.equal(nearestEnabled(enabled, findStandard('c++17')!.rank)?.id, 'c++14');
    assert.equal(nearestEnabled(enabled, findStandard('c++98')!.rank)?.id, 'c++11');
    assert.equal(nearestEnabled([], 3), undefined);
  });

  test('compiler flags', () => {
    const cpp17 = findStandard('c++17')!;
    assert.equal(compilerFlag(cpp17, 'gcc', false), '-std=c++17');
    assert.equal(compilerFlag(cpp17, 'gcc', true), '-std=gnu++17');
    assert.equal(compilerFlag(cpp17, 'msvc', false), '/std:c++17');
    assert.equal(compilerFlag(findStandard('c++11')!, 'msvc', false), undefined);
    assert.equal(compilerFlag(findStandard('c23')!, 'gcc', true), '-std=gnu23');
  });
});
