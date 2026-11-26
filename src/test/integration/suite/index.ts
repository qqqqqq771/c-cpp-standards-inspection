/**
 * Integration tests, run inside a VS Code instance by runTest.ts. Uses a tiny runner instead of
 * mocha to keep the dependency list short.
 */

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

const SOURCE = 'C/C++ Standards';
const KEYS = [
  'cpp.target', 'cpp.disabled', 'c.target', 'c.disabled', 'gnuExtensions', 'diagnostics.enabled', 'diagnostics.mode',
  'diagnostics.severity', 'diagnostics.ignoredRules', 'rules', 'sync.clangd', 'compilerFlagStyle',
];

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];
function test(name: string, fn: () => Promise<void>): void {
  tests.push({ name, fn });
}

const conf = (): vscode.WorkspaceConfiguration => vscode.workspace.getConfiguration('cppStandards');
const set = (key: string, value: unknown): Thenable<void> => conf().update(key, value, vscode.ConfigurationTarget.Workspace);

async function reset(): Promise<void> {
  for (const key of KEYS) {
    await set(key, undefined);
  }
}

async function waitFor<T>(probe: () => T | undefined | false, what: string, timeout = 10000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = probe();
    if (value !== undefined && value !== false) {
      return value;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function ours(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter((d) => d.source === SOURCE);
}

function codes(uri: vscode.Uri): string[] {
  return ours(uri).map((d) => String(d.code)).sort();
}

async function waitForCodes(uri: vscode.Uri, expected: string[]): Promise<void> {
  const want = [...expected].sort().join(',');
  await waitFor(() => codes(uri).join(',') === want, `diagnostics [${want}], last seen [${codes(uri).join(',')}]`);
}

async function open(language: string, content: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument({ language, content });
  await vscode.window.showTextDocument(doc);
  return doc;
}

function workspaceUri(...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, ...segments);
}

const CPP17_SAMPLE = '#include <optional>\nstd::optional<int> o;\nauto [a, b] = std::pair<int, int>{1, 2};\n';

test('contributes its commands', async () => {
  const all = await vscode.commands.getCommands(true);
  for (const id of ['cppStandards.selectCppStandard', 'cppStandards.manageCStandards', 'cppStandards.setTarget', 'cppStandards.checkWorkspace', 'cppStandards.cppFlag']) {
    assert.ok(all.includes(id), id);
  }
});

test('reports features newer than the target and clears them when the target changes', async () => {
  await vscode.commands.executeCommand('cppStandards.setTarget', 'cpp', 'c++14');
  const doc = await open('cpp', CPP17_SAMPLE);
  await waitForCodes(doc.uri, ['cpp17.header.optional', 'cpp17.lib.optional', 'cpp17.structured-binding']);
  const optional = ours(doc.uri).find((d) => d.code === 'cpp17.lib.optional')!;
  assert.match(optional.message, /C\+\+17.*C\+\+14/);
  assert.equal(optional.severity, vscode.DiagnosticSeverity.Warning);
  assert.equal(optional.range.start.line, 1);

  await vscode.commands.executeCommand('cppStandards.setTarget', 'cpp', 'c++17');
  await waitForCodes(doc.uri, []);
});

test('disabling the target moves it to the nearest enabled standard', async () => {
  await vscode.commands.executeCommand('cppStandards.setTarget', 'cpp', 'c++17');
  const doc = await open('cpp', CPP17_SAMPLE);
  await vscode.commands.executeCommand('cppStandards.disableStandard', { type: 'standard', lang: 'cpp', std: { id: 'c++17' } });
  assert.equal(conf().get('cpp.target'), 'c++14');
  assert.deepEqual(conf().get('cpp.disabled'), ['c++17']);
  await waitForCodes(doc.uri, ['cpp17.header.optional', 'cpp17.lib.optional', 'cpp17.structured-binding']);

  await vscode.commands.executeCommand('cppStandards.enableAll', 'cpp');
  assert.deepEqual(conf().get('cpp.disabled'), []);
});

test('refuses to disable the last enabled standard', async () => {
  await set('c.disabled', ['c89', 'c99', 'c11', 'c23']);
  await vscode.commands.executeCommand('cppStandards.disableStandard', { type: 'standard', lang: 'c', std: { id: 'c17' } });
  assert.deepEqual(conf().get('c.disabled'), ['c89', 'c99', 'c11', 'c23']);
});

test('a disabled standard can only become the target when enabling is requested', async () => {
  await set('cpp.disabled', ['c++20']);
  assert.equal(await vscode.commands.executeCommand('cppStandards.setTarget', 'cpp', 'c++20'), false);
  assert.equal(conf().inspect('cpp.target')?.workspaceValue, undefined);
  assert.equal(await vscode.commands.executeCommand('cppStandards.setTarget', 'cpp', 'c++20', { enable: true }), true);
  assert.equal(conf().get('cpp.target'), 'c++20');
  assert.deepEqual(conf().get('cpp.disabled'), []);
});

test('quick fixes change the target, suppress a line or ignore a rule', async () => {
  await vscode.commands.executeCommand('cppStandards.setTarget', 'cpp', 'c++14');
  const doc = await open('cpp', 'std::optional<int> o;\nstd::string_view v;\n');
  await waitForCodes(doc.uri, ['cpp17.lib.optional', 'cpp17.lib.string_view']);
  const diagnostic = ours(doc.uri).find((d) => d.code === 'cpp17.lib.optional')!;
  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, diagnostic.range);
  const titles = actions.map((a) => a.title);
  assert.ok(titles.includes('Set the C++ target standard to C++17'), titles.join(' | '));
  assert.ok(titles.includes('Suppress "cpp17.lib.optional" on this line'), titles.join(' | '));
  assert.ok(titles.includes('Allow "std::optional" in this workspace'), titles.join(' | '));
  assert.ok(titles.includes('Configure rules...'), titles.join(' | '));

  const suppress = actions.find((a) => a.title.startsWith('Suppress'))!;
  assert.ok(await vscode.workspace.applyEdit(suppress.edit!));
  assert.equal(doc.lineAt(0).text, '// cppstd-ignore-next-line cpp17.lib.optional');
  await waitForCodes(doc.uri, ['cpp17.lib.string_view']);

  const allow = actions.find((a) => a.title.startsWith('Allow'))!;
  await vscode.commands.executeCommand(allow.command!.command, ...(allow.command!.arguments ?? []));
  assert.deepEqual(conf().inspect('rules')?.workspaceValue, { 'cpp17.lib.optional': 'allow' });

  const setTarget = actions.find((a) => a.title.startsWith('Set the C++ target'))!;
  await vscode.commands.executeCommand(setTarget.command!.command, ...(setTarget.command!.arguments ?? []));
  assert.equal(conf().get('cpp.target'), 'c++17');
  await waitForCodes(doc.uri, []);
});

test('a forbidden rule is reported even when the target supports it, with its own severity', async () => {
  await set('cpp.target', 'c++20');
  const doc = await open('cpp', 'task f() { co_await g(); }\nstd::span<int> s;\n');
  await waitForCodes(doc.uri, []);
  await vscode.commands.executeCommand('cppStandards.setRules', ['cpp20.coroutines'], { state: 'forbid', severity: 'error' });
  assert.deepEqual(conf().inspect('rules')?.workspaceValue, { 'cpp20.coroutines': { state: 'forbid', severity: 'error' } });
  await waitForCodes(doc.uri, ['cpp20.coroutines']);
  const diagnostic = ours(doc.uri)[0];
  assert.equal(diagnostic.severity, vscode.DiagnosticSeverity.Error);
  assert.match(diagnostic.message, /forbidden/);

  const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, diagnostic.range);
  const titles = actions.map((a) => a.title);
  assert.ok(!titles.some((t) => t.startsWith('Set the C++ target')), titles.join(' | '));
  const stop = actions.find((a) => a.title.startsWith('Stop forbidding'))!;
  await vscode.commands.executeCommand(stop.command!.command, ...(stop.command!.arguments ?? []));
  assert.deepEqual(conf().inspect('rules')?.workspaceValue, { 'cpp20.coroutines': { severity: 'error' } });
  await waitForCodes(doc.uri, []);
});

test('prefix rules and bulk changes', async () => {
  await set('cpp.target', 'c++14');
  const doc = await open('cpp', 'std::optional<int> o;\nstd::any a;\nstd::variant<int> v;\n');
  await waitForCodes(doc.uri, ['cpp17.lib.any', 'cpp17.lib.optional', 'cpp17.lib.variant']);
  await set('rules', { 'cpp17.lib.*': 'allow' });
  await waitForCodes(doc.uri, []);
  // Resetting one rule under the prefix stores an explicit "default".
  await vscode.commands.executeCommand('cppStandards.setRules', ['cpp17.lib.any'], { state: 'default' });
  assert.deepEqual(conf().inspect('rules')?.workspaceValue, { 'cpp17.lib.*': 'allow', 'cpp17.lib.any': 'default' });
  await waitForCodes(doc.uri, ['cpp17.lib.any']);

  await set('rules', undefined);
  const many = ['cpp17.lib.any', 'cpp17.lib.optional', 'cpp17.lib.variant'];
  await vscode.commands.executeCommand('cppStandards.setRules', many, { state: 'allow' });
  await waitForCodes(doc.uri, []);
  await vscode.commands.executeCommand('cppStandards.setRules', many, { state: 'default' });
  assert.equal(conf().inspect('rules')?.workspaceValue, undefined);
  await waitForCodes(doc.uri, ['cpp17.lib.any', 'cpp17.lib.optional', 'cpp17.lib.variant']);
});

test('the deprecated ignoredRules setting is still honoured', async () => {
  await set('cpp.target', 'c++14');
  const doc = await open('cpp', 'std::optional<int> o;\n');
  await waitForCodes(doc.uri, ['cpp17.lib.optional']);
  await set('diagnostics.ignoredRules', ['cpp17.*']);
  await waitForCodes(doc.uri, []);
});

test('the rule settings panel opens for a language', async () => {
  await vscode.commands.executeCommand('cppStandards.configureRules', { lang: 'cpp', search: 'cpp17.lib.optional' });
  const panelTab = await waitFor(
    () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes('cppStandards.rules')),
    'rule settings panel',
  );
  assert.equal(panelTab.label, 'C/C++ Rule Settings');
  // Opening it again reuses the same panel.
  await vscode.commands.executeCommand('cppStandards.configureRules', 'c');
  const panels = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input instanceof vscode.TabInputWebview);
  assert.equal(panels.length, 1);
});

test('single rule view: a feature of the target standard can be disabled and allowed again', async () => {
  const all = await vscode.commands.getCommands(true);
  for (const id of ['cppStandards.findRule', 'cppStandards.allowRule', 'cppStandards.disableRule', 'cppStandards.disableGroup', 'cppStandards.singleRules.focus']) {
    assert.ok(all.includes(id), id);
  }
  await set('cpp.target', 'c++20');
  const doc = await open('cpp', '#define MAX_SIZE 100\nconstexpr int kMax = 100;\n');
  await waitForCodes(doc.uri, []);

  // Unchecking "#define constants" in the view stores "forbid": C++20 supports the feature.
  const macro = { type: 'rule', lang: 'cpp', key: 'since:c++98', category: 'preprocessor', id: 'cpp98.macro-constant' };
  await vscode.commands.executeCommand('cppStandards.disableRule', macro);
  assert.deepEqual(conf().inspect('rules')?.workspaceValue, { 'cpp98.macro-constant': 'forbid' });
  await waitForCodes(doc.uri, ['cpp98.macro-constant']);
  assert.match(ours(doc.uri)[0].message, /forbidden/);
  assert.equal(ours(doc.uri)[0].range.start.line, 0);

  // Checking it again removes the override instead of storing "allow".
  await vscode.commands.executeCommand('cppStandards.allowRule', macro);
  assert.equal(conf().inspect('rules')?.workspaceValue, undefined);
  await waitForCodes(doc.uri, []);
});

test('single rule view: bulk actions pick the right state for each rule', async () => {
  await set('cpp.target', 'c++20');
  const doc = await open('cpp', '#define MAX 1\n#undef MAX\n#warning check\n');
  await waitForCodes(doc.uri, ['cpp23.warning-directive']);

  // A C++23 category: not in C++20, so "Allow All" stores "allow".
  await vscode.commands.executeCommand('cppStandards.allowGroup', { type: 'ruleCategory', lang: 'cpp', key: 'since:c++23', category: 'preprocessor' });
  assert.deepEqual(conf().inspect('rules')?.workspaceValue, { 'cpp23.elifdef': 'allow', 'cpp23.warning-directive': 'allow' });
  await waitForCodes(doc.uri, []);

  // Core preprocessor features: in C++20, so "Disable All" stores "forbid".
  await vscode.commands.executeCommand('cppStandards.disableGroup', { type: 'ruleCategory', lang: 'cpp', key: 'since:c++98', category: 'preprocessor' });
  await waitForCodes(doc.uri, ['cpp98.macro-constant', 'cpp98.undef']);
  await vscode.commands.executeCommand('cppStandards.resetRule', { type: 'rule', lang: 'cpp', key: 'since:c++98', category: 'preprocessor', id: 'cpp98.undef' });
  await waitForCodes(doc.uri, ['cpp98.macro-constant']);

  await vscode.commands.executeCommand('cppStandards.resetGroup', { type: 'ruleCategory', lang: 'cpp', key: 'since:c++98', category: 'preprocessor' });
  await vscode.commands.executeCommand('cppStandards.resetGroup', { type: 'ruleCategory', lang: 'cpp', key: 'since:c++23', category: 'preprocessor' });
  assert.equal(conf().inspect('rules')?.workspaceValue, undefined);
  await waitForCodes(doc.uri, ['cpp23.warning-directive']);
});

test('all-enabled mode holds code to every enabled standard but honours version checks', async () => {
  await set('diagnostics.mode', 'allEnabled');
  await set('cpp.disabled', ['c++98', 'c++03', 'c++23', 'c++26']);
  const doc = await open('cpp', 'auto p = std::make_unique<int>(1);\n#if __cplusplus >= 201703L\nstd::optional<int> o;\n#endif\n');
  await waitForCodes(doc.uri, ['cpp14.lib.make_unique']);
  assert.match(ours(doc.uri)[0].message, /C\+\+11/);
});

test('C files are checked against the C target', async () => {
  await set('c.target', 'c89');
  const doc = await open('c', '// comment\nint main(void) { for (int i = 0; i < 1; i++) {} return 0; }\n');
  await waitForCodes(doc.uri, ['c99.for-declaration', 'c99.line-comment']);
  await set('gnuExtensions', true);
  await waitForCodes(doc.uri, []);
  await set('gnuExtensions', undefined);
  await set('c.target', 'c99');
  await waitForCodes(doc.uri, []);
});

test('severity and enable settings apply immediately', async () => {
  await set('cpp.target', 'c++11');
  const doc = await open('cpp', 'std::optional<int> o;\n');
  await waitForCodes(doc.uri, ['cpp17.lib.optional']);
  await set('diagnostics.severity', 'error');
  await waitFor(() => ours(doc.uri)[0]?.severity === vscode.DiagnosticSeverity.Error, 'error severity');
  await set('diagnostics.enabled', false);
  await waitForCodes(doc.uri, []);
});

test('compiler flag commands for tasks.json', async () => {
  await set('cpp.target', 'c++20');
  assert.equal(await vscode.commands.executeCommand('cppStandards.cppFlag'), '-std=c++20');
  assert.equal(await vscode.commands.executeCommand('cppStandards.cFlag'), '-std=c17');
  await set('gnuExtensions', true);
  assert.equal(await vscode.commands.executeCommand('cppStandards.cppFlag'), '-std=gnu++20');
  await set('compilerFlagStyle', 'msvc');
  assert.equal(await vscode.commands.executeCommand('cppStandards.cppFlag'), '/std:c++20');
});

test('clangd sync maintains and removes a managed block', async () => {
  const uri = workspaceUri('.clangd');
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('Diagnostics:\n  UnusedIncludes: Strict\n'));
  await set('cpp.target', 'c++20');
  await set('sync.clangd', true);
  const read = async () => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  const text = await waitForAsync(async () => {
    const t = await read();
    return t.includes("Add: ['-std=c++20']") ? t : undefined;
  }, '.clangd block');
  assert.ok(text.startsWith('Diagnostics:\n  UnusedIncludes: Strict\n# >>> cpp-standards'));
  assert.ok(text.includes("Add: ['-std=c17']"));

  await set('cpp.target', 'c++23');
  await waitForAsync(async () => ((await read()).includes("Add: ['-std=c++23']") ? true : undefined), 'updated .clangd block');
  assert.equal((await read()).match(/cpp-standards: managed/g)?.length, 1);

  await set('sync.clangd', false);
  await waitForAsync(async () => ((await read()) === 'Diagnostics:\n  UnusedIncludes: Strict\n' ? true : undefined), 'block removal');
});

test('workspace check covers files that are not open', async () => {
  await set('cpp.target', 'c++17');
  const uri = workspaceUri('src', 'concepts.cpp');
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode('template <class T>\nconcept Small = sizeof(T) < 8;\n'));
  await vscode.commands.executeCommand('cppStandards.checkWorkspace');
  await waitForCodes(uri, ['cpp20.concept']);
  await set('cpp.target', 'c++20');
  await waitForCodes(uri, []);
});

async function waitForAsync<T>(probe: () => Promise<T | undefined>, what: string, timeout = 10000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Closes every editor without save prompts (test documents are untitled and dirty). */
async function closeAllEditors(): Promise<void> {
  const openTabs = (): number => vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.length, 0);
  for (let i = 0; i < 50 && openTabs() > 0; i++) {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
}

export async function run(): Promise<void> {
  // The extension id follows the manifest, so changing the publisher does not break the tests.
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8')) as { publisher: string; name: string };
  const ext = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(ext, 'extension not found');
  await ext.activate();
  let failed = 0;
  for (const t of tests) {
    await reset();
    try {
      await t.fn();
      console.log(`  ✔ ${t.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✘ ${t.name}\n${err instanceof Error ? err.stack : String(err)}`);
    } finally {
      await closeAllEditors();
    }
  }
  await reset();
  console.log(`${tests.length - failed}/${tests.length} integration tests passed`);
  if (failed > 0) {
    throw new Error(`${failed} integration test(s) failed`);
  }
}
