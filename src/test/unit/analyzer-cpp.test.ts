import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { highlights, ids, violations } from './helpers';

const cpp = (src: string, target: string | string[], options = {}) => ids(src, 'cpp', target, options);

describe('C++ features', () => {
  test('library names', () => {
    assert.deepEqual(cpp('std::optional<int> o;', 'c++14'), ['cpp17.lib.optional']);
    assert.deepEqual(cpp('std::optional<int> o;', 'c++17'), []);
    assert.deepEqual(cpp('auto p = std::make_unique<int>(1);', 'c++11'), ['cpp14.lib.make_unique']);
    assert.deepEqual(cpp('std::print("hi");', 'c++20'), ['cpp23.lib.print']);
    assert.deepEqual(cpp('auto z = std::views::zip(a, b);', 'c++20'), ['cpp23.lib.views.zip']);
    assert.deepEqual(cpp('auto z = std::views::zip(a, b);', 'c++23'), []);
    assert.deepEqual(cpp('bool b = std::is_same_v<A, B>;', 'c++14'), ['cpp17.lib.variable-traits']);
    assert.deepEqual(cpp('typename std::enable_if_t<X, int> v;', 'c++11'), ['cpp14.lib.alias-traits']);
    assert.deepEqual(cpp('std::size_t n; std::vector<int> v;', 'c++98'), []);
    assert.deepEqual(highlights('std::chrono::days d;', 'cpp', 'c++03'), ['std::chrono::days']);
  });

  test('headers, members and removed library parts', () => {
    assert.deepEqual(cpp('#include <format>\n#include <vector>', 'c++17'), ['cpp20.header.format']);
    assert.deepEqual(cpp('v.emplace_back(1); p->shrink_to_fit();', 'c++03'), ['cpp11.member.emplace_back', 'cpp11.member.shrink_to_fit']);
    assert.deepEqual(cpp('if (s.starts_with("a")) {}', 'c++17'), ['cpp20.member.starts_with']);
    assert.deepEqual(cpp('std::auto_ptr<int> p;', 'c++17'), ['cpp17.removed.lib.auto_ptr']);
    assert.deepEqual(cpp('std::auto_ptr<int> p;', 'c++14'), []);
    assert.deepEqual(cpp('#include <codecvt>', 'c++26'), ['cpp26.removed.header.codecvt']);
  });

  test('C++11 core language', () => {
    assert.deepEqual(cpp('int* p = nullptr;', 'c++03'), ['cpp11.nullptr']);
    assert.deepEqual(cpp('auto x = 1;', 'c++03'), ['cpp11.auto']);
    assert.deepEqual(cpp('auto int x = 1;', 'c++03'), []);
    assert.deepEqual(cpp('for (auto& v : vec) {}', 'c++03'), ['cpp11.range-for', 'cpp11.auto']);
    assert.deepEqual(cpp('for (std::string s : names) {}', 'c++03'), ['cpp11.range-for']);
    assert.deepEqual(cpp('auto f = [&](int x) { return x; };', 'c++03'), ['cpp11.auto', 'cpp11.lambda']);
    assert.deepEqual(cpp('using Vec = std::vector<int>;', 'c++03'), ['cpp11.alias-declaration']);
    assert.deepEqual(cpp('enum class Color { Red };', 'c++03'), ['cpp11.enum-class']);
    assert.deepEqual(cpp('void f() const override;', 'c++03'), ['cpp11.override-final']);
    assert.deepEqual(cpp('struct S final {};', 'c++03'), ['cpp11.final-class']);
    assert.deepEqual(cpp('Foo() = default;', 'c++03'), ['cpp11.defaulted-deleted']);
    assert.deepEqual(cpp('template <typename... Ts> void f(Ts... ts);', 'c++03'), ['cpp11.variadic-template']);
    assert.deepEqual(cpp('static_assert(sizeof(int) == 4, "x");', 'c++03'), ['cpp11.static-assert']);
    assert.deepEqual(cpp('static_assert(sizeof(int) == 4, "x");', 'c++11'), []);
    assert.deepEqual(cpp('auto s = R"(raw)";', 'c++11'), []);
    assert.deepEqual(cpp('const char* s = R"(raw)";', 'c++03'), ['cpp11.raw-string']);
    assert.deepEqual(cpp('long long x = 1LL;', 'c++03'), ['cpp11.long-long', 'cpp11.long-long-literal']);
    assert.deepEqual(cpp('long long x = 1LL;', 'c++03', { gnu: true }), []);
  });

  test('C++14 to C++17', () => {
    assert.deepEqual(cpp('auto g = [](auto x) { return x; };', 'c++11'), ['cpp14.generic-lambda']);
    assert.deepEqual(cpp('auto f = [p = std::move(q)]() {};', 'c++11'), ['cpp14.lambda-init-capture']);
    assert.deepEqual(cpp('int n = 1\'000\'000; int b = 0b1010;', 'c++11'), ['cpp14.digit-separator', 'cpp14.binary-literal']);
    assert.deepEqual(cpp('auto s = "abc"s; auto t = 10ms;', 'c++11'), ['cpp14.string-literal-s', 'cpp14.chrono-literal']);
    assert.deepEqual(cpp('auto [a, b] = pair;', 'c++14'), ['cpp17.structured-binding']);
    assert.deepEqual(cpp('auto [a, b] = pair;', 'c++03'), ['cpp17.structured-binding']);
    assert.deepEqual(cpp('if constexpr (N > 0) {}', 'c++14'), ['cpp17.if-constexpr']);
    assert.deepEqual(cpp('if (auto it = m.find(k); it != m.end()) {}', 'c++14'), ['cpp17.selection-init']);
    assert.deepEqual(cpp('namespace a::b { }', 'c++14'), ['cpp17.nested-namespace']);
    assert.deepEqual(cpp('inline constexpr int k = 3;', 'c++14'), ['cpp17.inline-variable']);
    assert.deepEqual(cpp('return (args + ...);', 'c++14'), ['cpp17.fold-expression']);
    assert.deepEqual(cpp('template <auto N> struct X {};', 'c++14'), ['cpp17.template-auto']);
    assert.deepEqual(cpp('static_assert(sizeof(int) == 4);', 'c++14'), ['cpp17.static-assert-no-message']);
    assert.deepEqual(cpp('[[nodiscard]] int f();', 'c++14'), ['cpp17.attr.nodiscard']);
    assert.deepEqual(cpp('[[nodiscard]] int f();', 'c++03'), ['cpp17.attr.nodiscard']);
    assert.deepEqual(cpp('[[gnu::always_inline]] int f();', 'c++14'), []);
    assert.deepEqual(cpp('[[gnu::always_inline]] int f();', 'c++03'), ['cpp11.attributes']);
  });

  test('C++20 to C++26', () => {
    assert.deepEqual(cpp('template <typename T> concept C = true;', 'c++17'), ['cpp20.concept']);
    assert.deepEqual(cpp('auto c = x <=> y;', 'c++17'), ['cpp20.three-way-comparison']);
    assert.deepEqual(cpp('task f() { co_await g(); }', 'c++17'), ['cpp20.coroutines']);
    assert.deepEqual(cpp('Point p{.x = 1, .y = 2};', 'c++17'), ['cpp20.designated-initializers', 'cpp20.designated-initializers']);
    assert.deepEqual(cpp('Point p{.x = 1};', 'c++17', { gnu: true }), []);
    assert.deepEqual(cpp('void f(auto x) {}', 'c++17'), ['cpp20.abbreviated-template']);
    assert.deepEqual(cpp('export module foo;', 'c++17'), ['cpp20.module-declaration']);
    assert.deepEqual(cpp('[[likely]] return 1;', 'c++17'), ['cpp20.attr.likely']);
    assert.deepEqual(cpp('consteval int f() { if consteval { return 1; } return 2; }', 'c++20'), ['cpp23.if-consteval']);
    assert.deepEqual(cpp('import std;', 'c++20'), ['cpp23.import-std']);
    assert.deepEqual(cpp('void f(this auto&& self);', 'c++20'), ['cpp23.deducing-this']);
    assert.deepEqual(cpp('auto n = 10uz;', 'c++20'), ['cpp23.size-literal']);
    assert.deepEqual(cpp('#embed "data.bin"', 'c++23'), ['cpp26.embed']);
    assert.deepEqual(cpp('void f() = delete("use g");', 'c++23'), ['cpp26.delete-reason']);
  });

  test('removed language features', () => {
    assert.deepEqual(cpp('register int x;', 'c++17'), ['cpp17.removed.register']);
    assert.deepEqual(cpp('register int x;', 'c++14'), []);
    assert.deepEqual(cpp('register int x;', 'c++17', { checkRemoved: false }), []);
    assert.deepEqual(cpp('void f() throw();', 'c++20'), ['cpp20.removed.throw-empty']);
    assert.deepEqual(cpp('void f() throw(std::bad_alloc);', 'c++17'), ['cpp17.removed.dynamic-exception-spec']);
    assert.deepEqual(cpp('void f() { throw std::runtime_error("x"); }', 'c++20'), []);
  });

  test('common code is not flagged', () => {
    const src = [
      'int arr[] = {1, 2, 3};',
      'arr[0] = 1; handlers[i](x);',
      'x = a ? b : c;',
      'for (int i = 0; i < n; ++i) { if (a && b) {} }',
      'ptr->method(); obj.call();',
      'int printf(const char*, ...);',
      'inline bool operator==(const A&, const A&);',
      'delete [] p; new int[5];',
      'namespace fs = boost::filesystem;',
      'template <class T> class Box { T value; };',
      '// std::optional<int> nullptr auto [x] = y;',
      'const char* s = "std::optional nullptr";',
    ].join('\n');
    assert.deepEqual(cpp(src, 'c++98'), []);
  });
});

describe('preprocessor-aware checks', () => {
  test('version-guarded code is checked only for the standards that compile it', () => {
    const src = '#if __cplusplus >= 201703L\nstd::optional<int> o;\n#else\nstd::optional<int> p;\n#endif\n';
    assert.deepEqual(violations(src, 'cpp', 'c++14').map((v) => v.line), [3]);
    assert.deepEqual(violations(src, 'cpp', 'c++17').map((v) => v.line), []);
    assert.deepEqual(violations(src, 'cpp', ['c++11', 'c++14', 'c++17', 'c++20']).map((v) => v.line), [3]);
    // Without evaluation both branches are checked.
    assert.deepEqual(violations(src, 'cpp', 'c++14', { evaluatePreprocessor: false }).map((v) => v.line), [1, 3]);
  });

  test('feature-test macros, __has_include and #if 0', () => {
    assert.deepEqual(cpp('#ifdef __cpp_concepts\ntemplate <class T> concept C = true;\n#endif', 'c++17'), []);
    assert.deepEqual(cpp('#if __has_include(<optional>)\nstd::optional<int> o;\n#endif', 'c++14'), []);
    assert.deepEqual(cpp('#if 0\nstd::optional<int> o;\n#endif', 'c++14'), []);
    assert.deepEqual(cpp('#if __has_feature(cxx_concepts)\nconcept C = true;\n#endif', 'c++17'), []);
    assert.deepEqual(cpp('#if defined(MY_FLAG)\nstd::optional<int> o;\n#endif', 'c++14'), ['cpp17.lib.optional']);
  });

  test('compatibility macros in directives are not usages', () => {
    const src = '#if __cplusplus < 201103L\n#define nullptr NULL\n#endif\nint* p = nullptr;';
    assert.deepEqual(violations(src, 'cpp', 'c++03').map((v) => v.line), [3]);
  });

  test('suppression comments', () => {
    assert.deepEqual(cpp('std::optional<int> o; // cppstd-ignore', 'c++14'), []);
    assert.deepEqual(cpp('// cppstd-ignore-next-line\nstd::optional<int> o;', 'c++14'), []);
    assert.deepEqual(cpp('/* cppstd-ignore-next-line cpp17.lib.optional */\nstd::optional<int> o;', 'c++14'), []);
    assert.deepEqual(cpp('// cppstd-ignore-next-line cpp20.*\nstd::optional<int> o;', 'c++14'), ['cpp17.lib.optional']);
    assert.deepEqual(cpp('// cppstd-ignore-next-line cpp17.*\nstd::optional<int> o;', 'c++14'), []);
    assert.deepEqual(cpp('std::optional<int> o;', 'c++14', { ruleState: (id: string) => (id.startsWith('cpp17.') ? 'allow' : undefined) }), []);
  });
});

describe('policy', () => {
  test('all-enabled mode reports the oldest/newest conflicting standard', () => {
    const vs = violations('auto p = std::make_unique<int>(1);\nregister int r;', 'cpp', ['c++11', 'c++14', 'c++17']);
    assert.deepEqual(vs.map((v) => [v.rule.id, v.offending?.id]), [
      ['cpp14.lib.make_unique', 'c++11'],
      ['cpp17.removed.register', 'c++17'],
    ]);
  });

  test('a feature can be both too new and already removed', () => {
    const vs = violations('std::result_of<F()>::type x;', 'cpp', ['c++03', 'c++20']);
    assert.deepEqual(vs.map((v) => v.rule.id).sort(), ['cpp11.lib.result_of', 'cpp20.removed.lib.result_of']);
  });

  test('results are capped', () => {
    const src = Array.from({ length: 50 }, () => 'int* p = nullptr;').join('\n');
    const all = violations(src, 'cpp', 'c++03');
    assert.equal(all.length, 50);
    assert.equal(violations(src, 'cpp', 'c++03', { maxResults: 10 }).length, 10);
  });
});
