import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { highlights, ids } from './helpers';

const c = (src: string, target: string | string[], options = {}) => ids(src, 'c', target, options);

describe('C features', () => {
  test('C99', () => {
    assert.deepEqual(c('int x; // note', 'c89'), ['c99.line-comment']);
    assert.deepEqual(highlights('int x; // note', 'c', 'c89'), ['//']);
    assert.deepEqual(c('int x; // note', 'c89', { gnu: true }), []);
    assert.deepEqual(c('for (int i = 0; i < n; i++) {}', 'c89'), ['c99.for-declaration']);
    assert.deepEqual(c('for (i = 0; i < n; i++) {}', 'c89'), []);
    assert.deepEqual(c('static inline int f(void) { return 0; }', 'c89'), ['c99.inline']);
    assert.deepEqual(c('long long x;', 'c89'), ['c99.long-long']);
    assert.deepEqual(c('struct P p = { .x = 1, [2] = 3 };', 'c89'), ['c99.designated-initializers', 'c99.designated-initializers']);
    assert.deepEqual(c('f((struct P){ 1, 2 });', 'c89'), ['c99.compound-literal']);
    assert.deepEqual(c('snprintf(buf, n, "x");', 'c89'), ['c99.func.snprintf']);
    assert.deepEqual(c('#include <stdint.h>\nuint32_t x;', 'c89'), ['c99.header.stdint.h', 'c99.stdint-types']);
    assert.deepEqual(c('typedef unsigned int uint32_t;\nuint32_t x;', 'c89'), []);
    assert.deepEqual(c('bool b;', 'c89'), ['c99.stdbool']);
    assert.deepEqual(c('typedef int bool;\nbool b;', 'c89'), []);
    assert.deepEqual(c('int x; // note', 'c99'), []);
  });

  test('C11', () => {
    assert.deepEqual(c('_Static_assert(1, "x");', 'c99'), ['c11._static_assert']);
    assert.deepEqual(c('int t = _Generic(x, int: 1, default: 0);', 'c99'), ['c11._generic']);
    assert.deepEqual(c('const char* s = u8"x";', 'c99'), ['c11.unicode-string']);
    assert.deepEqual(c('#include <threads.h>', 'c99'), ['c11.header.threads.h']);
    assert.deepEqual(c('noreturn void die(void);', 'c99'), ['c11.noreturn']);
    assert.deepEqual(c('__declspec(noreturn) void a(void); __attribute__((cold, noreturn)) void b(void);', 'c99'), []);
    assert.deepEqual(c('gets(buf);', 'c17'), ['c11.removed.func.gets']);
    assert.deepEqual(c('gets(buf);', 'c99'), []);
  });

  test('C23', () => {
    assert.deepEqual(c('int* p = nullptr;', 'c17'), ['c23.nullptr']);
    assert.deepEqual(c('[[nodiscard]] int f(void);', 'c17'), ['c23.attributes']);
    assert.deepEqual(c('auto x = 5;', 'c17'), ['c23.auto']);
    assert.deepEqual(c('auto int y = 5;', 'c17'), []);
    assert.deepEqual(c('typeof(x) y;', 'c17'), ['c23.typeof']);
    assert.deepEqual(c('typeof(x) y;', 'c17', { gnu: true }), []);
    assert.deepEqual(c('int b = 0b101; int m = 1\'000;', 'c17'), ['c23.binary-literal', 'c23.digit-separator']);
    assert.deepEqual(c('#embed "x.bin"', 'c17'), ['c23.embed']);
    assert.deepEqual(c('int a[3] = {};', 'c17'), ['c23.empty-initializer']);
    assert.deepEqual(c('enum E : int { A };', 'c17'), ['c23.enum-base']);
    assert.deepEqual(c('static_assert(1);', 'c17'), ['c23.static-assert-no-message']);
    assert.deepEqual(c('int* p = nullptr;', 'c23'), []);
  });

  test('preprocessor in C files', () => {
    assert.deepEqual(c('#if __STDC_VERSION__ >= 202311L\nint* p = nullptr;\n#endif', 'c17'), []);
    assert.deepEqual(c('#ifdef __cplusplus\nauto x = nullptr;\n#endif', 'c17'), []);
    assert.deepEqual(c('#ifndef __cplusplus\nint* p = nullptr;\n#endif', 'c17'), ['c23.nullptr']);
    assert.deepEqual(c('#define restrict\nvoid f(int* restrict p);', 'c89'), ['c99.restrict']);
  });
});
