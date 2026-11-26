import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { allRules } from '../../analysis/rules';
import { CPP_STANDARDS, C_STANDARDS } from '../../standards';

const root = path.resolve(__dirname, '..', '..', '..');
const readJson = (file: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

function runtimeStrings(): Set<string> {
  const strings = new Set<string>();
  const srcDir = path.join(root, 'src');
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.ts'))) {
    const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
    for (const m of text.matchAll(/l10n\.t\(\s*(['"])((?:\\.|(?!\1).)*)\1/g)) {
      strings.add(m[2].replace(/\\(['"\\])/g, '$1'));
    }
    if (file === 'tree.ts') {
      for (const m of text.matchAll(/label: '([^']+)'/g)) {
        strings.add(m[1]);
      }
    }
  }
  for (const rule of allRules()) {
    if (!rule.generated) {
      strings.add(rule.name);
    }
  }
  for (const std of [...CPP_STANDARDS, ...C_STANDARDS]) {
    std.highlights.forEach((h) => strings.add(h));
  }
  return strings;
}

describe('localization', () => {
  test('every runtime string has a zh-cn translation with the same placeholders', () => {
    const bundle = readJson('l10n/bundle.l10n.zh-cn.json');
    const strings = runtimeStrings();
    const missing = [...strings].filter((s) => !(s in bundle));
    assert.deepEqual(missing, []);
    const unused = Object.keys(bundle).filter((k) => !strings.has(k));
    assert.deepEqual(unused, []);
    for (const [key, value] of Object.entries(bundle)) {
      const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      assert.equal(placeholders(String(value)), placeholders(key), key);
    }
  });

  test('package.json placeholders exist in both nls files', () => {
    const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const keys = new Set([...manifest.matchAll(/"%([^%"]+)%"/g)].map((m) => m[1]));
    const en = readJson('package.nls.json');
    const zh = readJson('package.nls.zh-cn.json');
    for (const key of keys) {
      assert.ok(key in en, `package.nls.json is missing ${key}`);
      assert.ok(key in zh, `package.nls.zh-cn.json is missing ${key}`);
    }
    assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
    assert.deepEqual(Object.keys(en).filter((k) => !keys.has(k)), []);
  });

  test('settings enums match the known standards', () => {
    const manifest = readJson('package.json') as { contributes: { configuration: { properties: Record<string, { enum?: string[]; items?: { enum?: string[] } }> } } };
    const props = manifest.contributes.configuration.properties;
    const cpp = CPP_STANDARDS.map((s) => s.id);
    const c = C_STANDARDS.map((s) => s.id);
    assert.deepEqual(props['cppStandards.cpp.target'].enum, cpp);
    assert.deepEqual(props['cppStandards.cpp.disabled'].items?.enum, cpp);
    assert.deepEqual(props['cppStandards.c.target'].enum, c);
    assert.deepEqual(props['cppStandards.c.disabled'].items?.enum, c);
  });
});
