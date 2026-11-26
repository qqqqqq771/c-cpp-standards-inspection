/**
 * Core rules: features of the first standard (C++98 / C89) that are never reported because of the
 * selected standard but can be forbidden individually, e.g. "no #define constants".
 */

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { allRules } from '../../analysis/rules';
import { findStandard } from '../../standards';
import type { Lang } from '../../standards';
import { violations } from './helpers';

const isCore = (id: string): boolean => /^(?:cpp98|c89)\./.test(id);
const forbidCore = (id: string): 'forbid' | undefined => (isCore(id) ? 'forbid' : undefined);

/** `rule id=highlighted text` for every core rule reported when all core rules are forbidden. */
function found(src: string, lang: Lang = 'cpp', std = lang === 'cpp' ? 'c++20' : 'c17'): string[] {
  return violations(src, lang, std, { ruleState: forbidCore })
    .filter((v) => isCore(v.rule.id))
    .map((v) => `${v.rule.id}=${src.slice(v.start, v.end)}`);
}

describe('core rules', () => {
  test('belong to the first standard of their language', () => {
    const core = allRules().filter((r) => isCore(r.id));
    assert.ok(core.length >= 30, `only ${core.length} core rules`);
    for (const rule of core) {
      assert.equal(rule.kind, 'since', rule.id);
      assert.equal(findStandard(rule.std)?.rank, 0, rule.id);
    }
  });

  test('are never reported unless forbidden, whatever the standard', () => {
    const src = '#define MAX 10\nint x = (int)y; goto end; int* p = NULL; T* q = new T; typedef int I;\n';
    for (const std of ['c++98', 'c++11', 'c++17', 'c++26']) {
      assert.deepEqual(violations(src, 'cpp', std).filter((v) => isCore(v.rule.id)), [], std);
    }
    assert.deepEqual(violations('#define MAX 10\ngoto end;\n', 'c', 'c89'), []);
    assert.deepEqual(violations('#define MAX 10\ngoto end;\n', 'c', ['c89', 'c99', 'c11', 'c17', 'c23']), []);
  });

  test('a forbidden core rule is reported as forbidden in every standard', () => {
    for (const std of ['c++98', 'c++20']) {
      const vs = violations('#define MAX 10\n', 'cpp', std, { ruleState: (id) => (id === 'cpp98.macro-constant' ? 'forbid' : undefined) });
      assert.deepEqual(vs.map((v) => [v.rule.id, v.reason, v.offending]), [['cpp98.macro-constant', 'forbidden', undefined]]);
    }
  });

  test('macro constants: object-like macros whose value contains a literal', () => {
    const src = [
      '#define MAX 100',
      '#define PI 3.14',
      '# define NAME "name"',
      '#define NEG -1',
      '#define MASK (1u << 3)',
      "#define CH 'a'",
      '#define ON true',
      '#define BYTE ((uint8_t)5)',
      '#define WITH_COMMENT 1 // trailing comment',
      '#define CRLF 2\r',
      '',
    ].join('\n');
    assert.deepEqual(found(src).filter((f) => f.startsWith('cpp98.macro-constant')), [
      'cpp98.macro-constant=define MAX',
      'cpp98.macro-constant=define PI',
      'cpp98.macro-constant=define NAME',
      'cpp98.macro-constant=define NEG',
      'cpp98.macro-constant=define MASK',
      'cpp98.macro-constant=define CH',
      'cpp98.macro-constant=define ON',
      'cpp98.macro-constant=define BYTE',
      'cpp98.macro-constant=define WITH_COMMENT',
      'cpp98.macro-constant=define CRLF',
    ]);
  });

  test('macro constants: guards, aliases, attributes, statements and function-like macros are not constants', () => {
    const src = [
      '#define GUARD_H',
      '#define EXPORT __declspec(dllexport)',
      '#define VISIBLE __attribute__((visibility("default")))',
      '#define ALIAS other_name',
      '#define DEPRECATED [[deprecated("old")]]',
      '#define STATEMENT do { } while (0)',
      '#define MULTI_LINE \\',
      '  5',
      '#define SQUARE(x) ((x) * (x))',
      '// #define IN_COMMENT 1',
      '#if 0',
      '#define INACTIVE 1',
      '#endif',
      '',
    ].join('\n');
    assert.deepEqual(found(src), ['cpp98.function-like-macro=define SQUARE']);
  });

  test('#undef', () => {
    assert.deepEqual(found('#undef MAX\n'), ['cpp98.undef=undef']);
  });

  test('C-style casts to built-in, _t and pointer types', () => {
    const src = 'a = (int)b; d = (double)x / y; p = (char*)&v; q = (const Foo*)ptr; return (unsigned long)n;\nf((size_t)-1, (std::uint8_t)c);\n';
    assert.deepEqual(found(src), [
      'cpp98.c-style-cast=(int)',
      'cpp98.c-style-cast=(double)',
      'cpp98.c-style-cast=(char*)',
      'cpp98.c-style-cast=(const Foo*)',
      'cpp98.c-style-cast=(unsigned long)',
      'cpp98.c-style-cast=(size_t)',
      'cpp98.c-style-cast=(std::uint8_t)',
    ]);
  });

  test('declarations, sizeof, function types and parenthesized expressions are not casts', () => {
    const src =
      'void f(int); void g(int) const; int n = sizeof(int) - 1; std::function<void(int)> h; (void)x;\n' +
      'if (a) (b); x = (a + b) * c; y = (a * b); void (*fp)(int) = 0; auto l = [](int) {}; s.operator()(int);\n';
    assert.deepEqual(found(src), []);
  });

  test('C-style variadic functions, but not variadic templates or fold expressions', () => {
    const src = 'int printf(const char *fmt, ...);\nvoid log(int n, ...) { va_list ap; va_start(ap, n); }\ntemplate <class... Ts> void f(Ts... ts) { (g(ts), ...); (ts, ...); }\n';
    assert.deepEqual(found(src), [
      'cpp98.variadic-function=...',
      'cpp98.variadic-function=...',
      'cpp98.variadic-function=va_list',
      'cpp98.variadic-function=va_start',
    ]);
  });

  test('new and delete expressions, but not deleted functions, operator declarations or <new>', () => {
    const src = 'T* p = new T; delete p; delete[] q;\nX(const X&) = delete;\nvoid* operator new(size_t); void operator delete(void*);\n#include <new>\nint new_value;\n';
    assert.deepEqual(found(src), ['cpp98.new-delete=new', 'cpp98.new-delete=delete', 'cpp98.new-delete=delete']);
  });

  test('unscoped enumeration definitions', () => {
    const src = 'enum Color { Red }; enum { A }; enum E : int { B }; enum class S { C }; enum struct T { D }; enum Color c;\n';
    assert.deepEqual(found(src), ['cpp98.unscoped-enum=enum', 'cpp98.unscoped-enum=enum', 'cpp98.unscoped-enum=enum']);
  });

  test('octal literals, but not 0, hexadecimal, binary or floating literals', () => {
    assert.deepEqual(found('int a = 0755; int b = 0; int c = 0x1F; double d = 0.5; unsigned e = 0755u; long f = 0b101; double g = 0e1;\n'), [
      'cpp98.octal-literal=0755',
      'cpp98.octal-literal=0755u',
    ]);
  });

  test('library functions, also through std::, but not members or other namespaces', () => {
    const src =
      'void* m = malloc(4); std::free(m); obj.free(); ns::free(x); p->malloc(1); quick_exit(1); std::exit(0);\n' +
      'strcpy(a, b); int n = atoi(s); srand(1); signal(SIGINT, h); try_lock(); my_rand(); longjmp(env, 1);\n';
    assert.deepEqual(found(src), [
      'cpp98.dynamic-memory=malloc',
      'cpp98.dynamic-memory=free',
      'cpp98.process-control=exit',
      'cpp98.unbounded-string=strcpy',
      'cpp98.ato-conversion=atoi',
      'cpp98.rand=srand',
      'cpp98.signal=signal',
      'cpp98.setjmp=longjmp',
    ]);
  });

  test('other C++ features', () => {
    const src = [
      '#include <stdio.h>',
      '#include <cstdio>',
      '#include "math.h"',
      'using namespace std;',
      'typedef int I;',
      'int* p = NULL;',
      'goto end;',
      'union U { int a; };',
      'asm("nop");',
      'reinterpret_cast<int*>(p); const_cast<int*>(q); dynamic_cast<B*>(c); typeid(x);',
      'throw 1; try {} catch (...) {}',
      '',
    ].join('\n');
    assert.deepEqual(found(src), [
      'cpp98.c-header=stdio.h',
      'cpp98.using-namespace=using namespace',
      'cpp98.typedef=typedef',
      'cpp98.null-macro=NULL',
      'cpp98.goto=goto',
      'cpp98.union=union',
      'cpp98.asm=asm',
      'cpp98.reinterpret-cast=reinterpret_cast',
      'cpp98.const-cast=const_cast',
      'cpp98.rtti=dynamic_cast',
      'cpp98.rtti=typeid',
      'cpp98.exceptions=throw',
      'cpp98.exceptions=try',
      'cpp98.exceptions=catch',
    ]);
  });

  test('C has its own core rules and none of the C++-only ones', () => {
    const src = '#define MAX 100\n#define F(x) x\ngoto end;\nint x = 0755;\nvoid* p = malloc(1);\nint printf(const char *fmt, ...);\nint y = (int)z;\ntypedef int I; int* q = NULL;\n';
    assert.deepEqual(found(src, 'c'), [
      'c89.macro-constant=define MAX',
      'c89.function-like-macro=define F',
      'c89.goto=goto',
      'c89.octal-literal=0755',
      'c89.dynamic-memory=malloc',
      'c89.variadic-function=...',
    ]);
  });

  test('nothing is reported inside comments or string literals', () => {
    assert.deepEqual(found('// #define X 1 and goto\nconst char* s = "goto (int)x NULL malloc(1)";\n'), []);
  });

  test('a suppression comment silences a forbidden core rule', () => {
    assert.deepEqual(found('// cppstd-ignore-next-line cpp98.macro-constant\n#define MAX 100\n'), []);
  });
});
