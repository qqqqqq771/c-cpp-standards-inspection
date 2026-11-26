import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyNumber, computeLineStarts, lex, lineOf } from '../../analysis/lexer';

describe('lexer', () => {
  test('masks comments and literal contents but keeps offsets and line breaks', () => {
    const src = 'int a; // std::optional\r\n/* nullptr\n */ const char* s = "auto [x]"; char c = \'x\';';
    const { masked } = lex(src);
    assert.equal(masked.length, src.length);
    assert.equal(masked.split('\n').length, src.split('\n').length);
    assert.ok(!masked.includes('optional'));
    assert.ok(!masked.includes('nullptr'));
    assert.ok(!masked.includes('auto'));
    assert.ok(masked.includes('"        "'));
    assert.ok(masked.includes("' '"));
    assert.ok(masked.includes('\r\n'));
  });

  test('handles raw strings with delimiters', () => {
    const src = 'auto s = R"xy(a "quoted" )" text)xy"; int after;';
    const { masked, tokens } = lex(src);
    assert.ok(!masked.includes('quoted'));
    assert.ok(masked.includes('int after;'));
    const raw = tokens.find((t) => t.kind === 'string');
    assert.equal(raw?.raw, true);
    assert.equal(raw?.prefix, 'R');
  });

  test('treats digit separators as part of a number', () => {
    const { masked, tokens } = lex("int x = 1'000'000; char c = 'a';");
    assert.ok(masked.includes("1'000'000"));
    const num = tokens.find((t) => t.kind === 'number');
    assert.equal(num?.text, "1'000'000");
    assert.equal(num?.number?.digitSeparator, true);
  });

  test('records encoding prefixes and user-defined suffixes', () => {
    const { tokens } = lex('auto a = u8"x"; auto b = U\'y\'; auto c = "s"sv; auto d = "k"_json;');
    const strings = tokens.filter((t) => t.kind === 'string' || t.kind === 'char');
    assert.deepEqual(strings.map((t) => [t.prefix, t.suffix]), [['u8', ''], ['U', ''], ['', 'sv'], ['', '_json']]);
  });

  test('stops unterminated literals at the end of the line', () => {
    const src = "#error don't do this\nint ok;";
    const { masked } = lex(src);
    assert.ok(masked.endsWith('int ok;'));
  });

  test('line comments continue after a backslash-newline', () => {
    const src = '// first \\\nstill comment\nint x;';
    const { masked, tokens } = lex(src);
    assert.ok(!masked.includes('still'));
    assert.ok(masked.includes('int x;'));
    assert.equal(tokens.filter((t) => t.kind === 'lineComment').length, 1);
  });

  test('classifies numeric literals', () => {
    assert.deepEqual(classifyNumber('0b1010u'), { binary: true, hexFloat: false, isFloat: false, digitSeparator: false, suffix: 'u' });
    assert.equal(classifyNumber('0x1.8p3f').hexFloat, true);
    assert.equal(classifyNumber('0x1Fu').hexFloat, false);
    assert.equal(classifyNumber('0x1Fu').suffix, 'u');
    assert.equal(classifyNumber('10ms').suffix, 'ms');
    assert.equal(classifyNumber('1.5e10f').isFloat, true);
    assert.equal(classifyNumber('100ULL').suffix, 'ULL');
    assert.equal(classifyNumber("1'024uz").digitSeparator, true);
  });

  test('maps offsets to lines', () => {
    const starts = computeLineStarts('a\nbb\n\nccc');
    assert.deepEqual(starts, [0, 2, 5, 6]);
    assert.equal(lineOf(starts, 0), 0);
    assert.equal(lineOf(starts, 3), 1);
    assert.equal(lineOf(starts, 5), 2);
    assert.equal(lineOf(starts, 8), 3);
  });
});
