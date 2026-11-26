import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import { getRule } from '../../analysis/rules';
import { findStandard } from '../../standards';
import {
  CLANG_TIDY_CHECKS,
  clangdBlock,
  clangTidyChecks,
  cmakeSettings,
  conformanceFlags,
  mergeManagedList,
  mergeManagedObject,
  removeClangdBlock,
  upsertClangdBlock,
} from '../../toolchain';

const std = (id: string) => findStandard(id)!;
const rankOf = (id: string) => std(id).rank;

describe('toolchain configuration', () => {
  test('conformance flags: -pedantic in ISO mode, compat warnings between the oldest checked standard and the target', () => {
    assert.deepEqual(conformanceFlags('cpp', std('c++20'), std('c++20'), false, rankOf), ['-pedantic']);
    assert.deepEqual(conformanceFlags('cpp', std('c++20'), std('c++14'), false, rankOf), ['-pedantic', '-Wpre-c++17-compat', '-Wpre-c++20-compat']);
    assert.deepEqual(conformanceFlags('cpp', std('c++11'), std('c++03'), true, rankOf), ['-Wc++98-compat']);
    assert.deepEqual(conformanceFlags('c', std('c17'), std('c89'), false, rankOf), ['-pedantic', '-Wdeclaration-after-statement', '-Wvla', '-Wpre-c11-compat']);
    assert.deepEqual(conformanceFlags('c', std('c23'), std('c11'), false, rankOf), ['-pedantic', '-Wpre-c2x-compat']);
  });

  test('clang-tidy checks only for forbidden core rules of the language', () => {
    for (const id of Object.keys(CLANG_TIDY_CHECKS)) {
      assert.ok(getRule(id), `${id} is not a rule`);
    }
    const forbidden = new Set(['cpp98.macro-constant', 'cpp98.function-like-macro', 'cpp98.c-style-cast', 'c89.rand', 'cpp17.lib.optional']);
    assert.deepEqual(clangTidyChecks('cpp', (id) => forbidden.has(id)), [
      'cppcoreguidelines-macro-usage',
      'cppcoreguidelines-pro-type-cstyle-cast',
      'google-readability-casting',
    ]);
    assert.deepEqual(clangTidyChecks('c', (id) => forbidden.has(id)), ['cert-msc30-c']);
    assert.deepEqual(clangTidyChecks('c', () => false), []);
  });

  test('.clangd block: -std flag per language, then warnings and clang-tidy checks', () => {
    const plain = clangdBlock([{ lang: 'cpp', target: std('c++23') }], false);
    assert.match(plain, /Add: \['-std=c\+\+23'\]\n/);
    assert.doesNotMatch(plain, /Diagnostics/);
    const full = clangdBlock(
      [
        { lang: 'c', target: std('c11'), flags: ['-pedantic'] },
        { lang: 'cpp', target: std('c++17'), flags: ['-pedantic', '-Wpre-c++17-compat'], checks: ['modernize-use-using'] },
      ],
      true,
    );
    assert.match(full, /Add: \['-std=gnu11', '-pedantic'\]/);
    assert.match(full, /Add: \['-std=gnu\+\+17', '-pedantic', '-Wpre-c\+\+17-compat'\]\nDiagnostics:\n {2}ClangTidy:\n {4}Add: \['modernize-use-using'\]/);
    assert.ok(full.indexOf('-std=gnu11') < full.indexOf('-std=gnu++17'));
  });

  test('.clangd block is replaced in place and removed without touching user fragments', () => {
    const user = 'CompileFlags:\n  Add: [-Wall]\n';
    const block = clangdBlock([{ lang: 'cpp', target: std('c++17') }], false);
    const once = upsertClangdBlock(user, block);
    assert.ok(once.startsWith(user));
    const updated = upsertClangdBlock(once, clangdBlock([{ lang: 'cpp', target: std('c++20') }], false));
    assert.ok(updated.includes('-std=c++20') && !updated.includes('-std=c++17'));
    assert.equal(removeClangdBlock(updated).trimEnd(), user.trimEnd());
  });

  test('CMake cache variables', () => {
    assert.deepEqual(cmakeSettings(std('c++03'), std('c89'), false), {
      CMAKE_CXX_STANDARD: '98',
      CMAKE_CXX_STANDARD_REQUIRED: 'ON',
      CMAKE_CXX_EXTENSIONS: 'OFF',
      CMAKE_C_STANDARD: '90',
      CMAKE_C_STANDARD_REQUIRED: 'ON',
      CMAKE_C_EXTENSIONS: 'OFF',
    });
    assert.equal(cmakeSettings(std('c++26'), undefined, true).CMAKE_CXX_STANDARD, '26');
    assert.equal(cmakeSettings(std('c++26'), undefined, true).CMAKE_CXX_EXTENSIONS, 'ON');
    assert.equal(cmakeSettings(undefined, std('c17'), false).CMAKE_C_STANDARD, '17');
  });

  test('shared list settings: only entries the extension added are changed', () => {
    // First sync: the user's entry stays, ours is appended; an entry the user already had is not claimed.
    let step = mergeManagedList(['user-check', 'modernize-use-using'], [], ['modernize-use-using', 'cert-err34-c']);
    assert.deepEqual(step.value, ['user-check', 'modernize-use-using', 'cert-err34-c']);
    assert.deepEqual(step.managed, ['cert-err34-c']);
    // Rule no longer forbidden: our entry goes, the user's entries stay.
    step = mergeManagedList(step.value, step.managed, []);
    assert.deepEqual(step.value, ['user-check', 'modernize-use-using']);
    assert.deepEqual(step.managed, []);
  });

  test('shared object settings: keys the user changed afterwards are left alone', () => {
    let step = mergeManagedObject({ CMAKE_BUILD_TYPE: 'Debug' }, {}, { CMAKE_CXX_STANDARD: '17' });
    assert.deepEqual(step.value, { CMAKE_BUILD_TYPE: 'Debug', CMAKE_CXX_STANDARD: '17' });
    step = mergeManagedObject(step.value, step.managed, { CMAKE_CXX_STANDARD: '20' });
    assert.deepEqual(step.value, { CMAKE_BUILD_TYPE: 'Debug', CMAKE_CXX_STANDARD: '20' });
    const userEdited = mergeManagedObject({ ...step.value, CMAKE_CXX_STANDARD: '14' }, step.managed, {});
    assert.deepEqual(userEdited.value, { CMAKE_BUILD_TYPE: 'Debug', CMAKE_CXX_STANDARD: '14' });
    const disabled = mergeManagedObject(step.value, step.managed, {});
    assert.deepEqual(disabled.value, { CMAKE_BUILD_TYPE: 'Debug' });
    // A value the user had already is not claimed, so it survives turning the sync off.
    const preexisting = mergeManagedObject({ CMAKE_CXX_STANDARD: '17' }, {}, { CMAKE_CXX_STANDARD: '17' });
    assert.deepEqual(mergeManagedObject(preexisting.value, preexisting.managed, {}).value, { CMAKE_CXX_STANDARD: '17' });
  });
});
