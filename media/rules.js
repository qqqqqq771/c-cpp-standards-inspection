// Webview script for the "C/C++ Rule Settings" panel. Receives rule data from the extension and
// sends back rule changes; all persistence happens in the extension (cppStandards.rules).
(function () {
  'use strict';

  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();
  const saved = vscode.getState() || {};
  const ui = {
    search: typeof saved.search === 'string' ? saved.search : '',
    category: typeof saved.category === 'string' ? saved.category : 'all',
    status: typeof saved.status === 'string' ? saved.status : 'all',
    /** Group key -> true (collapsed) or false (expanded); missing keys use the default. */
    collapsed: saved.collapsed && typeof saved.collapsed === 'object' ? saved.collapsed : {},
  };

  const STATES = ['default', 'allow', 'forbid'];
  const SEVERITIES = ['error', 'warning', 'information', 'hint'];
  const CATEGORIES = ['language', 'literal', 'library', 'header', 'attribute', 'preprocessor'];
  const STATUSES = ['all', 'reported', 'notReported', 'unsupported', 'supported', 'custom'];
  const SUPPORTED = new Set(['supported', 'gnu', 'removedUnchecked']);
  const ICONS = { supported: '✓', gnu: '✓', unsupported: '✕', removed: '⚠', removedUnchecked: '–', none: '–' };

  let data = null;
  let S = {};
  let stdIndex = new Map();
  let stdLabel = new Map();

  const $ = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (template, ...args) => String(template).replace(/\{(\d+)\}/g, (m, i) => (args[i] !== undefined ? String(args[i]) : m));
  const save = () => vscode.setState(ui);

  const isCustom = (row) => row.state !== 'default' || Boolean(row.severity);

  function verdictInfo(verdict, offending) {
    const cls = SUPPORTED.has(verdict) ? 'v-ok' : verdict === 'removed' ? 'v-removed' : verdict === 'unsupported' ? 'v-bad' : 'v-none';
    return { cls, icon: ICONS[verdict] || '–', text: fmt(S['verdict.' + verdict] || verdict, offending || '') };
  }

  function matches(row) {
    if (ui.category !== 'all' && row.category !== ui.category) {
      return false;
    }
    switch (ui.status) {
      case 'reported':
        if (!row.reported) return false;
        break;
      case 'notReported':
        if (row.reported) return false;
        break;
      case 'unsupported':
        if (SUPPORTED.has(row.verdict) || row.verdict === 'none') return false;
        break;
      case 'supported':
        if (!SUPPORTED.has(row.verdict)) return false;
        break;
      case 'custom':
        if (!isCustom(row)) return false;
        break;
    }
    const terms = ui.search.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) {
      return true;
    }
    const haystack = (row.name + ' ' + row.id).toLowerCase();
    return terms.every((t) => haystack.includes(t));
  }

  function groups() {
    const map = new Map();
    for (const row of data.rows) {
      const key = row.kind + ':' + row.std;
      if (!map.has(key)) {
        map.set(key, { key, kind: row.kind, std: row.std, rows: [] });
      }
      map.get(key).rows.push(row);
    }
    return [...map.values()].sort(
      (a, b) => (a.kind === b.kind ? 0 : a.kind === 'since' ? -1 : 1) || stdIndex.get(a.std) - stdIndex.get(b.std),
    );
  }

  function isCollapsed(group) {
    if (ui.search.trim() !== '') {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(ui.collapsed, group.key)) {
      return ui.collapsed[group.key];
    }
    // By default, expand only the groups the compared standard does not support.
    return group.rows.every((r) => SUPPORTED.has(r.verdict));
  }

  function fillSelect(select, options, value) {
    select.innerHTML = options
      .map(([v, label]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(label)}</option>`)
      .join('');
  }

  function renderToolbar() {
    $('lblLang').textContent = S.language;
    $('lblMode').textContent = S.compareWith;
    $('lblTarget').textContent = S.standard;
    fillSelect($('lang'), data.langs.map((l) => [l.id, l.label]), data.lang);
    fillSelect($('mode'), [['target', S.modeTarget], ['allEnabled', S.modeAll]], data.mode);
    fillSelect($('target'), data.standards.filter((s) => s.enabled).map((s) => [s.id, s.label]), data.target);
    $('targetField').hidden = data.mode !== 'target';
    $('search').placeholder = S.search;
    $('search').setAttribute('aria-label', S.search);
    if (document.activeElement !== $('search')) {
      $('search').value = ui.search;
    }
    fillSelect($('category'), [['all', S.allCategories], ...CATEGORIES.map((c) => [c, S['category.' + c]])], ui.category);
    fillSelect($('status'), STATUSES.map((s) => [s, S['status.' + s]]), ui.status);
    for (const button of document.querySelectorAll('[data-bulk]')) {
      button.textContent = S['bulk.' + button.dataset.bulk];
      button.title = S.bulkScope;
    }
    $('openSettings').textContent = S.openSettings;
    $('columns').innerHTML =
      `<span></span><span>${esc(S.colFeature)}</span><span>${esc(fmt(S.colCompare, data.compared))}</span>` +
      `<span>${esc(S.colSetting)}</span><span>${esc(S.colSeverity)}</span><span>${esc(S.colResult)}</span>`;
    const reported = data.rows.filter((r) => r.reported).length;
    const custom = data.rows.filter(isCustom).length;
    $('summary').textContent = fmt(S.summary, data.rows.length, reported, custom);
    updateToolbarHeight();
  }

  function rowHtml(row) {
    const v = verdictInfo(row.verdict, row.offending);
    const segment = STATES.map(
      (s) =>
        `<button type="button" class="st-${s}" data-act="state" data-state="${s}" data-key="${esc(row.id)}|${s}" ` +
        `aria-pressed="${row.state === s}" title="${esc(S['stateTip.' + s])}">${esc(S['state.' + s])}</button>`,
    ).join('');
    const inherited =
      row.stateKey && row.stateKey !== row.id ? `<div class="inherit">${esc(fmt(S.inheritedFrom, row.stateKey))}</div>` : '';
    const severity = row.severity || 'default';
    const severityTitle =
      row.severityKey && row.severityKey !== row.id ? ` title="${esc(fmt(S.inheritedFrom, row.severityKey))}"` : '';
    const options = ['default', ...SEVERITIES]
      .map((s) => {
        const label = s === 'default' ? fmt(S.severityDefault, S['severity.' + data.globalSeverity]) : S['severity.' + s];
        return `<option value="${s}"${s === severity ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('');
    return (
      `<div class="row rule${row.reported ? ' reported' : ''}${isCustom(row) ? ' custom' : ''}" data-id="${esc(row.id)}">` +
      `<span class="verdict ${v.cls}" aria-hidden="true">${v.icon}</span>` +
      `<div class="feature"><div class="name">${esc(row.name)}</div>` +
      `<div class="meta"><code>${esc(row.id)}</code> · ${esc(S['category.' + row.category])}</div></div>` +
      `<div class="compare ${v.cls}">${esc(v.text)}</div>` +
      `<div class="setting"><div class="seg" role="group" aria-label="${esc(S.colSetting)}: ${esc(row.name)}">${segment}</div>${inherited}</div>` +
      `<div class="severity"><select class="sev" data-act="severity" data-key="${esc(row.id)}|sev"${severityTitle} ` +
      `aria-label="${esc(S.colSeverity)}: ${esc(row.name)}">${options}</select></div>` +
      `<div class="result">${esc(row.reported ? S.reported : S.notReported)}</div>` +
      `</div>`
    );
  }

  function groupHtml(group, visible) {
    const collapsed = isCollapsed(group);
    const sample = group.rows.find((r) => r.verdict !== 'gnu') || group.rows[0];
    const v = verdictInfo(sample.verdict, sample.offending);
    const custom = group.rows.filter(isCustom).length;
    const title = fmt(group.kind === 'since' ? S.groupSince : S.groupRemoved, stdLabel.get(group.std) || group.std);
    const count = visible.length === group.rows.length ? String(visible.length) : `${visible.length} / ${group.rows.length}`;
    const bulk = ['allow', 'forbid', 'default']
      .map(
        (s) =>
          `<button type="button" data-act="groupBulk" data-state="${s}" data-key="gbulk|${esc(group.key)}|${s}" ` +
          `title="${esc(S.bulkScope)}">${esc(S['bulk.' + s])}</button>`,
      )
      .join('');
    return (
      `<section class="group${collapsed ? ' collapsed' : ''}" data-group="${esc(group.key)}">` +
      `<div class="group-header" data-act="toggle">` +
      `<button type="button" class="toggle" data-act="toggle" data-key="toggle|${esc(group.key)}" aria-expanded="${!collapsed}" ` +
      `title="${esc(collapsed ? S.expand : S.collapse)}">${collapsed ? '▸' : '▾'}</button>` +
      `<span class="title">${esc(title)}</span><span class="badge">${count}</span>` +
      `<span class="gverdict ${v.cls}">${v.icon} ${esc(v.text)}</span>` +
      (custom ? `<span class="tag">${esc(fmt(S.customizedCount, custom))}</span>` : '') +
      `<span class="spacer"></span><span class="bulk">${bulk}</span></div>` +
      (collapsed ? '' : `<div class="rows">${visible.map(rowHtml).join('')}</div>`) +
      `</section>`
    );
  }

  function renderGroups() {
    const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : undefined;
    const scrollY = window.scrollY;
    const html = [];
    for (const group of groups()) {
      const visible = group.rows.filter(matches);
      if (visible.length > 0) {
        html.push(groupHtml(group, visible));
      }
    }
    $('groups').innerHTML = html.length > 0 ? html.join('') : `<p class="empty">${esc(S.noMatches)}</p>`;
    window.scrollTo(0, scrollY);
    if (focusKey) {
      const escaped = window.CSS && CSS.escape ? CSS.escape(focusKey) : focusKey.replace(/["\\]/g, '\\$&');
      const el = document.querySelector(`[data-key="${escaped}"]`);
      if (el) {
        el.focus({ preventScroll: true });
      }
    }
  }

  function visibleIds(groupKey) {
    return data.rows.filter((r) => (!groupKey || r.kind + ':' + r.std === groupKey) && matches(r)).map((r) => r.id);
  }

  function updateToolbarHeight() {
    document.documentElement.style.setProperty('--toolbar-h', $('toolbar').offsetHeight + 'px');
  }

  // Toolbar events
  $('lang').addEventListener('change', (e) => vscode.postMessage({ type: 'setLang', lang: e.target.value }));
  $('mode').addEventListener('change', (e) => vscode.postMessage({ type: 'setMode', mode: e.target.value }));
  $('target').addEventListener('change', (e) => vscode.postMessage({ type: 'setTarget', id: e.target.value }));
  $('openSettings').addEventListener('click', (e) => {
    e.preventDefault();
    vscode.postMessage({ type: 'openSettings' });
  });
  let searchTimer;
  $('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      ui.search = e.target.value;
      save();
      renderGroups();
    }, 150);
  });
  $('category').addEventListener('change', (e) => {
    ui.category = e.target.value;
    save();
    renderGroups();
  });
  $('status').addEventListener('change', (e) => {
    ui.status = e.target.value;
    save();
    renderGroups();
  });
  $('bulk').addEventListener('click', (e) => {
    const button = e.target.closest('[data-bulk]');
    if (button && data) {
      vscode.postMessage({ type: 'setRules', ids: visibleIds(), state: button.dataset.bulk });
    }
  });

  // Rule and group events (delegated)
  $('groups').addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !data) {
      return;
    }
    const act = el.dataset.act;
    if (act === 'state') {
      const id = el.closest('.rule').dataset.id;
      vscode.postMessage({ type: 'setRules', ids: [id], state: el.dataset.state });
    } else if (act === 'groupBulk') {
      const key = el.closest('.group').dataset.group;
      vscode.postMessage({ type: 'setRules', ids: visibleIds(key), state: el.dataset.state });
    } else if (act === 'toggle') {
      const key = el.closest('.group').dataset.group;
      const group = groups().find((g) => g.key === key);
      ui.collapsed[key] = !isCollapsed(group);
      save();
      renderGroups();
    }
  });
  $('groups').addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.act === 'severity') {
      const id = el.closest('.rule').dataset.id;
      vscode.postMessage({ type: 'setRules', ids: [id], severity: el.value });
    }
  });
  window.addEventListener('resize', updateToolbarHeight);

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'data') {
      data = msg.payload;
      S = data.strings;
      stdIndex = new Map(data.standards.map((s, i) => [s.id, i]));
      stdLabel = new Map(data.standards.map((s) => [s.id, s.label]));
      const categoryOrder = new Map(CATEGORIES.map((c, i) => [c, i]));
      data.rows.sort((a, b) => categoryOrder.get(a.category) - categoryOrder.get(b.category) || a.name.localeCompare(b.name));
      renderToolbar();
      renderGroups();
    } else if (msg.type === 'search' && typeof msg.search === 'string') {
      ui.search = msg.search;
      ui.category = 'all';
      ui.status = 'all';
      save();
      if (data) {
        renderToolbar();
        renderGroups();
      }
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
