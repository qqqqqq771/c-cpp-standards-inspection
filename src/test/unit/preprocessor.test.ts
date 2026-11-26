import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { analyzePreprocessor, evaluateCondition } from '../../analysis/preprocessor';
import { computeLineStarts, lex } from '../../analysis/lexer';
import { stds } from './helpers';

function value(expr: string, std: string): number | null {
  return evaluateCondition(expr, stds(std)[0]).value;
}

describe('preprocessor conditions', () => {
  test('__cplusplus comparisons', () => {
    assert.equal(value('__cplusplus >= 201703L', 'c++17'), 1);
    assert.equal(value('__cplusplus >= 201703L', 'c++14'), 0);
    assert.equal(value('__cplusplus > 202002L', 'c++23'), 1);
    assert.equal(value('(__cplusplus >= 201103L) && !(__cplusplus >= 202002L)', 'c++17'), 1);
    assert.equal(value('defined(__cplusplus)', 'c11'), 0);
    assert.equal(value('defined __cplusplus', 'c++98'), 1);
    assert.equal(value('__STDC_VERSION__ >= 201112L', 'c11'), 1);
    assert.equal(value('__STDC_VERSION__ >= 201112L', 'c99'), 0);
    assert.equal(value('defined(__STDC_VERSION__)', 'c89'), 0);
  });

  test('feature-test macros and __has_include', () => {
    assert.equal(value('__has_include(<optional>)', 'c++14'), 0);
    assert.equal(value('__has_include(<optional>)', 'c++17'), 1);
    assert.equal(value('__has_include(<strstream>)', 'c++26'), 0);
    assert.notEqual(value('__cpp_concepts', 'c++20'), 0);
    assert.equal(value('__cpp_concepts', 'c++17'), 0);
    assert.equal(value('defined(__cpp_lib_optional) && __cpp_lib_optional >= 201606L', 'c++17'), 1);
    assert.equal(value('__cpp_constexpr >= 201603L', 'c++14'), 0);
    assert.equal(value('__cpp_constexpr >= 201603L', 'c++17'), 1);
    assert.notEqual(value('__has_cpp_attribute(nodiscard)', 'c++17'), 0);
    assert.equal(value('__has_cpp_attribute(nodiscard)', 'c++14'), 0);
    assert.equal(value('_HAS_CXX20', 'c++20'), 1);
    assert.equal(value('_LIBCPP_STD_VER >= 17', 'c++14'), 0);
  });

  test('unknown macros are undecided; compiler probes are guards', () => {
    assert.deepEqual(evaluateCondition('defined(MY_FLAG)', stds('c++17')[0]), { value: null, guard: false });
    assert.deepEqual(evaluateCondition('__has_feature(cxx_rtti)', stds('c++17')[0]), { value: null, guard: true });
    assert.equal(value('MY_FLAG && __cplusplus >= 202002L', 'c++17'), 0);
    assert.equal(value('MY_FLAG || __cplusplus >= 201103L', 'c++17'), 1);
    assert.equal(value('0', 'c++17'), 0);
    assert.equal(value('1 ? 2 : 3', 'c++17'), 2);
    assert.equal(value('this is not valid', 'c++17'), null);
  });

  test('computes per-line masks for nested conditionals', () => {
    const src = [
      '#if __cplusplus >= 201703L', // 0
      'a',                            // 1
      '#elif __cplusplus >= 201103L', // 2
      'b',                            // 3
      '#else',                        // 4
      'c',                            // 5
      '#endif',                       // 6
      '#if 0',                        // 7
      'd',                            // 8
      '#endif',                       // 9
      'e',                            // 10
    ].join('\n');
    const checked = stds(['c++03', 'c++11', 'c++17']);
    const { masked } = lex(src);
    const pp = analyzePreprocessor(masked, computeLineStarts(src), checked, true);
    const masks = Array.from(pp.lineMasks!);
    assert.equal(masks[1], 0b100); // C++17 only
    assert.equal(masks[3], 0b010); // C++11 only
    assert.equal(masks[5], 0b001); // C++03 only
    assert.equal(masks[8], 0);
    assert.equal(masks[10], 0b111);
    assert.equal(masks[0], 0b111);
    assert.equal(masks[2], 0b111);
  });

  test('exempts macro names and conditions', () => {
    const src = '#define nullptr NULL\n#if defined(__cpp_concepts)\n#endif\n';
    const { masked } = lex(src);
    const pp = analyzePreprocessor(masked, computeLineStarts(src), stds('c++03'), false);
    assert.equal(pp.lineMasks, undefined);
    const covered = (word: string) => {
      const at = src.indexOf(word);
      return pp.exempt.some(([s, e]) => at >= s && at < e);
    };
    assert.ok(covered('nullptr'));
    assert.ok(covered('__cpp_concepts'));
    assert.ok(!covered('NULL'));
  });
});
