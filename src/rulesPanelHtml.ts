/**
 * HTML skeleton of the rule settings webview. Kept free of the VS Code API so tests can load
 * the same markup together with media/rules.js.
 */

export interface PanelHtmlOptions {
  readonly cspSource: string;
  readonly nonce: string;
  readonly scriptUri: string;
  readonly styleUri: string;
  readonly language: string;
  readonly title: string;
}

const escapeAttr = (value: string): string => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function panelHtml(o: PanelHtmlOptions): string {
  return `<!DOCTYPE html>
<html lang="${escapeAttr(o.language)}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${o.cspSource}; script-src 'nonce-${o.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttr(o.styleUri)}">
<title>${escapeAttr(o.title)}</title>
</head>
<body>
<header class="toolbar" id="toolbar">
  <div class="line">
    <label class="field"><span id="lblLang"></span><select id="lang"></select></label>
    <label class="field"><span id="lblMode"></span><select id="mode"></select></label>
    <label class="field" id="targetField"><span id="lblTarget"></span><select id="target"></select></label>
    <span class="spacer"></span>
    <a href="#" id="openSettings"></a>
  </div>
  <div class="line">
    <input type="search" id="search">
    <select id="category"></select>
    <select id="status"></select>
    <span class="bulk" id="bulk">
      <button type="button" data-bulk="allow"></button>
      <button type="button" data-bulk="forbid"></button>
      <button type="button" data-bulk="default"></button>
    </span>
  </div>
  <div class="line summary" id="summary" aria-live="polite"></div>
  <div class="row head" id="columns"></div>
</header>
<main id="groups"></main>
<script nonce="${o.nonce}" src="${escapeAttr(o.scriptUri)}"></script>
</body>
</html>`;
}
