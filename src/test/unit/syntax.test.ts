import { before, describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { analyze } from '../../analysis/analyzer';
import type { AnalyzeOptions } from '../../analysis/analyzer';
import { DETECTORS } from '../../analysis/syntax/detectors';
import type { SyntaxEngine } from '../../analysis/syntax/engine';
import { getRule } from '../../analysis/rules';
import type { Lang } from '../../standards';
import { stds } from './helpers';
import { loadSyntaxEngine } from './syntaxEngine';

let engine: SyntaxEngine;
before(async () => {
  engine = await loadSyntaxEngine();
});

type Options = Partial<AnalyzeOptions> & { readonly forbid?: readonly string[] };

function run(src: string, lang: Lang, checked: string | string[], syntax: boolean, options: Options = {}): string[] {
  const forbid = new Set(options.forbid ?? []);
  return analyze(src, {
    lang,
    checked: stds(checked),
    ruleState: (id) => (forbid.has(id) ? 'forbid' : undefined),
    ...options,
    syntax: syntax ? engine.analyze(lang, src) : undefined,
  }).violations.map((v) => v.rule.id);
}

/** Rule ids found with the syntax engine and with the regular expressions only. */
function both(src: string, lang: Lang, checked: string | string[], options: Options = {}): { syntax: string[]; regex: string[] } {
  return { syntax: run(src, lang, checked, true, options), regex: run(src, lang, checked, false, options) };
}

const cpp = (src: string, checked: string | string[], options: Options = {}) => run(src, 'cpp', checked, true, options);
const c = (src: string, checked: string | string[], options: Options = {}) => run(src, 'c', checked, true, options);

describe('syntax engine', () => {
  test('every detector belongs to an existing rule of its language', () => {
    for (const lang of ['c', 'cpp'] as const) {
      for (const detector of DETECTORS[lang]) {
        assert.equal(getRule(detector.id)?.lang, lang, detector.id);
      }
    }
  });

  test('offsets are UTF-16 indices, like JavaScript strings', () => {
    const src = '/* ü€😀 */ auto [a, b] = p;';
    const facts = engine.analyze('cpp', src)!;
    const finding = facts.findings.find((f) => f.ruleId === 'cpp17.structured-binding')!;
    assert.equal(src.slice(finding.start, finding.end), 'auto [');
  });

  test('syntax-only rules are not reported without the engine', () => {
    const src = 'void f(void) { int a = 1; a++; int b = 2; }';
    assert.deepEqual(both(src, 'c', 'c89'), { syntax: ['c99.mixed-declarations'], regex: [] });
  });
});

describe('syntax detectors: C++', () => {
  test('C-style casts to any type, but not arithmetic on a parenthesized variable', () => {
    const forbid = ['cpp98.c-style-cast'];
    assert.deepEqual(both('Widget w = (Widget)other;', 'cpp', 'c++17', { forbid }), { syntax: ['cpp98.c-style-cast'], regex: [] });
    assert.deepEqual(cpp('int a = 1, b = 2; int c = (a) * b; int d = (a) - b;', 'c++17', { forbid }), []);
    assert.deepEqual(cpp('(void)unused; int x = (int)3.5;', 'c++17', { forbid }), ['cpp98.c-style-cast']);
  });

  test('selection statements with an initializer containing a lambda', () => {
    const src = 'void f() { if (auto it = std::find_if(v.begin(), v.end(), [](int x) { return x > 0; }); it != v.end()) {} }';
    const { syntax, regex } = both(src, 'cpp', 'c++14');
    assert.ok(syntax.includes('cpp17.selection-init'), syntax.join());
    assert.ok(!regex.includes('cpp17.selection-init'), regex.join());
  });

  test('constrained auto parameters are abbreviated templates', () => {
    assert.deepEqual(both('void f(Small auto x, const Sortable auto& y);', 'cpp', 'c++17'), {
      syntax: ['cpp20.abbreviated-template', 'cpp20.abbreviated-template'],
      regex: [],
    });
    assert.deepEqual(cpp('template <auto N> struct A {}; auto g = [](auto x) { return x; };', 'c++17'), []);
  });

  test('return type deduction and trailing return types with complex declarators', () => {
    const operator = 'struct V {}; auto operator+(const V& a, const V& b) { return a; }';
    assert.deepEqual(both(operator, 'cpp', 'c++11'), { syntax: ['cpp14.return-type-deduction'], regex: [] });
    const trailing = 'auto f(decltype(g(h(1))) x) -> int;';
    assert.ok(cpp(trailing, 'c++03').includes('cpp11.trailing-return'));
    assert.deepEqual(cpp('auto l = []() -> int { return 1; };', 'c++11'), []);
  });

  test('names made visible by using namespace std, using-declarations and namespace aliases', () => {
    assert.deepEqual(both('#include <vector>\nusing namespace std;\noptional<int> o;', 'cpp', 'c++14'), { syntax: ['cpp17.lib.optional'], regex: [] });
    assert.deepEqual(cpp('using std::make_unique;\nauto p = make_unique<int>(1);', 'c++11'), ['cpp14.lib.make_unique', 'cpp14.lib.make_unique']);
    // Qualified names are not resolved a second time.
    const facts = engine.analyze('cpp', 'using namespace std;\nstd::optional<int> o; auto p = std::make_unique<int>(1);')!;
    assert.deepEqual(facts.stdRefs, []);
    assert.deepEqual(cpp('void f() { using namespace std::chrono; auto d = days{1}; }', 'c++17'), ['cpp20.lib.chrono.days']);
    assert.deepEqual(cpp('namespace fs = std::filesystem;\nfs::path p;', 'c++14'), ['cpp17.lib.filesystem', 'cpp17.lib.filesystem']);
    // Only after the directive, and only within its scope.
    assert.deepEqual(cpp('optional<int> a;\nvoid f() { using namespace std; }\noptional<int> b;', 'c++14'), []);
    // Names the file declares itself are not the library's.
    assert.deepEqual(cpp('using namespace std;\ntemplate <class T> struct optional {};\noptional<int> o;', 'c++14'), []);
    assert.deepEqual(cpp('namespace fs = boost::filesystem;\nfs::path p;', 'c++14'), []);
    // Global C names (<stdint.h>, <math.h>) are not taken for their std:: twins.
    assert.deepEqual(cpp('using namespace std;\nuint32_t x = 0; double r = round(1.5); bool n = isnan(r);', 'c++03'), []);
  });

  test('class template argument deduction for standard templates', () => {
    assert.deepEqual(cpp('std::vector v{1, 2};', 'c++14'), ['cpp17.ctad']);
    assert.deepEqual(cpp('auto v = std::vector{1, 2};', 'c++14'), ['cpp17.ctad']);
    assert.deepEqual(cpp('std::mutex m; void f() { std::lock_guard lock(m); }', 'c++14'), ['cpp17.ctad']);
    assert.deepEqual(cpp('std::vector<int> v{1, 2}; std::string s("x"); Widget w{1};', 'c++14'), []);
    assert.deepEqual(cpp('std::vector v{1, 2};', 'c++17'), []);
    assert.deepEqual(cpp('using namespace std;\nvector v{1, 2};', 'c++14'), ['cpp17.ctad']);
    assert.deepEqual(cpp('using namespace std::chrono;\nduration d{1};', 'c++14'), []);
  });

  test('relaxed constexpr functions', () => {
    const loop = 'constexpr int pow2(int n) { int r = 1; for (int i = 0; i < n; ++i) r *= 2; return r; }';
    assert.deepEqual(cpp(loop, 'c++11'), ['cpp14.relaxed-constexpr']);
    assert.deepEqual(cpp(loop, 'c++14'), []);
    assert.deepEqual(cpp('constexpr int twice(int x) { return x * 2; }', 'c++11'), []);
    assert.deepEqual(cpp('struct S { constexpr S() {} int x = 0; };', 'c++11'), []);
  });

  test('lines that do not parse fall back to the regular expressions', () => {
    // `if consteval` is unknown to the grammar; the covered structured-binding rule still works there.
    assert.deepEqual(cpp('void f() { if consteval { auto [a, b] = g(); } }', 'c++14'), ['cpp23.if-consteval', 'cpp17.structured-binding']);
    // Macro bodies are opaque to the parser.
    assert.deepEqual(cpp('#define TO_INT(x) ((int)(x))', 'c++17', { forbid: ['cpp98.c-style-cast'] }), ['cpp98.c-style-cast']);
  });
});

describe('syntax detectors: C', () => {
  test('declarations mixed with code', () => {
    const src = 'void f(void) {\n  int a = 1;\n  a++;\n  int b = 2;\n  {\n    int c;\n  }\n}';
    assert.deepEqual(c(src, 'c89'), ['c99.mixed-declarations']);
    assert.deepEqual(c(src, 'c99'), []);
    assert.deepEqual(c(src, 'c89', { gnu: true }), []);
    assert.deepEqual(c('void f(void) { int a; struct S s; enum { K = 1 }; a = K; }', 'c89'), []);
  });

  test('variable-length arrays need a variable in the size', () => {
    assert.deepEqual(c('void f(int n) { int a[n]; int b[10]; }', 'c89'), ['c99.vla']);
    assert.deepEqual(c('#define N 10\nenum { K = 4 };\nvoid f(void) { int a[N]; int b[K]; int c[sizeof(int)]; }', 'c89'), []);
    // Only variables in scope count: `len` here is a macro from a header, not g's parameter.
    assert.deepEqual(c('void g(int len) { (void)len; }\nvoid f(void) { char buf[len]; }', 'c89'), []);
    assert.deepEqual(c('void f(int n, int a[n]);\nvoid h(void) { for (int i = 1; i < 3; i++) { int b[i]; } }', 'c99'), []);
    assert.deepEqual(c('void f(int n, int a[n]);\nint m = 3;\nvoid h(void) { int b[m]; }', 'c89'), ['c99.vla', 'c99.vla']);
  });

  test('K&R function definitions were removed in C23', () => {
    const src = 'int add(a, b) int a; int b; { return a + b; }';
    assert.deepEqual(c(src, 'c23'), ['c23.removed.kr-definition']);
    assert.deepEqual(c(src, 'c17'), []);
    assert.deepEqual(c('int add(int a, int b) { return a + b; }', 'c23'), []);
  });

  test('functions the file declares itself are not library functions', () => {
    const src = 'double round(double x) { return x; }\nint main(void) { return (int)round(1.5); }';
    assert.deepEqual(both(src, 'c', 'c89'), { syntax: [], regex: ['c99.func.round', 'c99.func.round'] });
  });

  test('for-loop declarations and compound literals with typedef names', () => {
    const src = 'typedef int myint;\ntypedef struct { int x; } P;\nvoid f(void) { P p; for (myint i = 0; i < 3; i++) {} p = (P){1}; }';
    assert.deepEqual(both(src, 'c', 'c89'), { syntax: ['c99.for-declaration', 'c99.compound-literal'], regex: [] });
  });
});
