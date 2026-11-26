/**
 * Exercises media/rules.js (the rule settings webview) in jsdom: rendering, filtering and the
 * messages sent back to the extension.
 */

import { describe, test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { panelHtml } from '../../rulesPanelHtml';

const root = path.resolve(__dirname, '..', '..', '..');
const script = fs.readFileSync(path.join(root, 'media', 'rules.js'), 'utf8');

/** Strings: templates where the script formats values, the key itself everywhere else. */
const STRINGS = new Proxy<Record<string, string>>(
  {
    'verdict.unsupported': 'Not available in {0}',
    groupSince: 'Introduced in {0}',
    groupRemoved: 'Removed in {0}',
    inheritedFrom: 'from {0}',
    severityDefault: 'Default ({0})',
    summary: '{0} rules · {1} reported · {2} customized',
    customizedCount: '{0} customized',
    colCompare: 'Compared with {0}',
  },
  { get: (target, key) => (typeof key === 'string' ? target[key] ?? key : undefined) },
);

function payload(): Record<string, unknown> {
  return {
    lang: 'cpp',
    langs: [
      { id: 'cpp', label: 'C++' },
      { id: 'c', label: 'C' },
    ],
    standards: [
      { id: 'c++11', label: 'C++11', enabled: true },
      { id: 'c++14', label: 'C++14', enabled: true },
      { id: 'c++17', label: 'C++17', enabled: true },
      { id: 'c++20', label: 'C++20', enabled: false },
    ],
    target: 'c++14',
    mode: 'target',
    compared: 'C++14',
    globalSeverity: 'warning',
    rows: [
      { id: 'cpp11.auto', name: 'auto type deduction', category: 'language', kind: 'since', std: 'c++11', verdict: 'supported', state: 'default', reported: false },
      { id: 'cpp17.lib.optional', name: 'std::optional', category: 'library', kind: 'since', std: 'c++17', verdict: 'unsupported', offending: 'C++14', state: 'allow', stateKey: 'cpp17.lib.optional', reported: false },
      { id: 'cpp17.lib.any', name: 'std::any', category: 'library', kind: 'since', std: 'c++17', verdict: 'unsupported', offending: 'C++14', state: 'allow', stateKey: 'cpp17.lib.*', reported: false },
      { id: 'cpp17.structured-binding', name: 'structured bindings', category: 'language', kind: 'since', std: 'c++17', verdict: 'unsupported', offending: 'C++14', state: 'default', reported: true },
      {
        id: 'cpp17.removed.register', name: 'register storage class', category: 'language', kind: 'removed', std: 'c++17', verdict: 'supported',
        state: 'forbid', stateKey: 'cpp17.removed.register', severity: 'error', severityKey: 'cpp17.removed.register', reported: true,
      },
    ],
    strings: STRINGS,
  };
}

function setup() {
  const dom = new JSDOM(
    panelHtml({ cspSource: 'test', nonce: 'n', scriptUri: 'rules.js', styleUri: 'rules.css', language: 'en', title: 'Rules' }),
    { runScripts: 'outside-only', pretendToBeVisual: true },
  );
  const win = dom.window as unknown as Window & typeof globalThis & { eval(code: string): unknown; acquireVsCodeApi: unknown };
  const posted: Array<Record<string, unknown>> = [];
  let state: unknown;
  win.acquireVsCodeApi = () => ({
    // Clone like the real postMessage does (this also moves objects out of the jsdom realm).
    postMessage: (m: Record<string, unknown>) => posted.push(JSON.parse(JSON.stringify(m))),
    getState: () => state,
    setState: (s: unknown) => (state = s),
  });
  win.scrollTo = () => undefined;
  win.eval(script);
  const doc = win.document;
  const send = (data: unknown): void => {
    win.dispatchEvent(new win.MessageEvent('message', { data }));
  };
  const $ = <T extends Element>(selector: string): T => {
    const el = doc.querySelector<T>(selector);
    assert.ok(el, `missing ${selector}`);
    return el;
  };
  const change = (selector: string, value: string): void => {
    const el = $<HTMLSelectElement | HTMLInputElement>(selector);
    el.value = value;
    el.dispatchEvent(new win.Event(el.tagName === 'INPUT' ? 'input' : 'change', { bubbles: true }));
  };
  const rowIds = (): string[] => [...doc.querySelectorAll<HTMLElement>('.rule')].map((r) => r.dataset.id!);
  const last = (): Record<string, unknown> => posted[posted.length - 1];
  send({ type: 'data', payload: payload() });
  return { doc, posted, send, $, change, rowIds, last, state: () => state as Record<string, unknown> };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('rule settings webview', () => {
  test('announces itself and renders groups in standard order, expanding unsupported ones', () => {
    const { doc, posted, rowIds, $ } = setup();
    assert.deepEqual(posted[0], { type: 'ready' });
    const groups = [...doc.querySelectorAll<HTMLElement>('.group')].map((g) => [g.dataset.group, g.classList.contains('collapsed')]);
    assert.deepEqual(groups, [
      ['since:c++11', true],
      ['since:c++17', false],
      ['removed:c++17', true],
    ]);
    // Within a group: language features before library names, then by name.
    assert.deepEqual(rowIds(), ['cpp17.structured-binding', 'cpp17.lib.any', 'cpp17.lib.optional']);
    assert.equal($('#summary').textContent, '5 rules · 2 reported · 3 customized');
    assert.equal($('[data-group="since:c++17"] .title').textContent, 'Introduced in C++17');
    assert.deepEqual([...doc.querySelectorAll<HTMLOptionElement>('#target option')].map((o) => o.value), ['c++11', 'c++14', 'c++17']);
  });

  test('shows the state of each rule and where an inherited state comes from', () => {
    const { $, doc } = setup();
    const pressed = (id: string) => $(`.rule[data-id="${id}"] [aria-pressed="true"]`).getAttribute('data-state');
    assert.equal(pressed('cpp17.lib.optional'), 'allow');
    assert.equal(pressed('cpp17.structured-binding'), 'default');
    assert.equal($('.rule[data-id="cpp17.lib.any"] .inherit').textContent, 'from cpp17.lib.*');
    assert.equal($('.rule[data-id="cpp17.lib.optional"] .compare').textContent, 'Not available in C++14');
    // A rule's own entry is not shown as inherited.
    assert.equal(doc.querySelector('.rule[data-id="cpp17.lib.optional"] .inherit'), null);
    assert.ok($('.rule[data-id="cpp17.structured-binding"]').classList.contains('reported'));
  });

  test('row buttons and severity selects send rule changes', () => {
    const { $, last, doc } = setup();
    ($('.rule[data-id="cpp17.structured-binding"] [data-state="forbid"]') as HTMLButtonElement).click();
    assert.deepEqual(last(), { type: 'setRules', ids: ['cpp17.structured-binding'], state: 'forbid' });

    // Expand the removed-features group by clicking its header, then change a severity.
    ($('[data-group="removed:c++17"] .group-header .title') as HTMLElement).click();
    const select = $<HTMLSelectElement>('.rule[data-id="cpp17.removed.register"] select');
    assert.equal(select.value, 'error');
    select.value = 'hint';
    select.dispatchEvent(new doc.defaultView!.Event('change', { bubbles: true }));
    assert.deepEqual(last(), { type: 'setRules', ids: ['cpp17.removed.register'], severity: 'hint' });
  });

  test('search filters rows, expands matching groups, and bulk actions use the visible rows', async () => {
    const { change, rowIds, $, last } = setup();
    change('#search', 'std::');
    await wait(250);
    assert.deepEqual(rowIds(), ['cpp17.lib.any', 'cpp17.lib.optional']);
    assert.equal($('[data-group="since:c++17"] .badge').textContent, '2 / 3');
    ($('[data-group="since:c++17"] [data-act="groupBulk"][data-state="forbid"]') as HTMLButtonElement).click();
    assert.deepEqual(last(), { type: 'setRules', ids: ['cpp17.lib.any', 'cpp17.lib.optional'], state: 'forbid' });

    change('#search', 'register');
    await wait(250);
    assert.deepEqual(rowIds(), ['cpp17.removed.register']);
  });

  test('status and category filters drive the toolbar bulk buttons', () => {
    const { change, $, last } = setup();
    change('#status', 'reported');
    ($('#bulk [data-bulk="allow"]') as HTMLButtonElement).click();
    assert.deepEqual(last(), { type: 'setRules', ids: ['cpp17.removed.register', 'cpp17.structured-binding'], state: 'allow' });
    change('#status', 'all');
    change('#category', 'library');
    ($('#bulk [data-bulk="default"]') as HTMLButtonElement).click();
    assert.deepEqual(last(), { type: 'setRules', ids: ['cpp17.lib.any', 'cpp17.lib.optional'], state: 'default' });
  });

  test('toolbar selects send language, mode and target changes', () => {
    const { change, last, $ } = setup();
    change('#target', 'c++17');
    assert.deepEqual(last(), { type: 'setTarget', id: 'c++17' });
    change('#mode', 'allEnabled');
    assert.deepEqual(last(), { type: 'setMode', mode: 'allEnabled' });
    change('#lang', 'c');
    assert.deepEqual(last(), { type: 'setLang', lang: 'c' });
    ($('#openSettings') as HTMLAnchorElement).click();
    assert.deepEqual(last(), { type: 'openSettings' });
  });

  test('a search request from the extension resets filters and shows the rule', () => {
    const { send, $, rowIds, change } = setup();
    change('#status', 'reported');
    send({ type: 'search', search: 'cpp17.lib.optional' });
    assert.equal($<HTMLInputElement>('#search').value, 'cpp17.lib.optional');
    assert.equal($<HTMLSelectElement>('#status').value, 'all');
    assert.deepEqual(rowIds(), ['cpp17.lib.optional']);
  });

  test('collapsed groups are remembered in the webview state', () => {
    const { $, state } = setup();
    ($('[data-group="since:c++17"] .toggle') as HTMLButtonElement).click();
    assert.ok($('[data-group="since:c++17"]').classList.contains('collapsed'));
    assert.deepEqual((state().collapsed as Record<string, boolean>)['since:c++17'], true);
  });
});
