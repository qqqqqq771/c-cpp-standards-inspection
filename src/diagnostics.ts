import * as vscode from 'vscode';
import { analyze, standardVerdict } from './analysis/analyzer';
import type { Violation } from './analysis/analyzer';
import { getRule } from './analysis/rules';
import type { FeatureRule } from './analysis/rules';
import type { SyntaxEngine } from './analysis/syntax/engine';
import type { SyntaxFacts } from './analysis/syntax/facts';
import { checkedStandards, getDiagnosticsSettings, getLangState, isGnu, updateSetting } from './config';
import type { DiagnosticsMode, DiagnosticsSettings } from './config';
import { findStandard, langLabel, languageIdToLang } from './standards';
import type { Lang } from './standards';

export const DIAGNOSTIC_SOURCE = 'C/C++ Standards';

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const DEBOUNCE_MS = 300;
const SOURCE_GLOB = '**/*.{c,i,h,cc,cp,cpp,cxx,c++,ii,hh,hpp,hxx,h++,inl,ipp,tpp,txx,ixx,cppm,cu,cuh}';
const C_EXTENSIONS = new Set(['.c', '.i']);
/** Real documents only; skips virtual ones such as git diff views or output channels. */
const CHECKED_SCHEMES = new Set(['file', 'untitled', 'vscode-remote', 'vscode-vfs', 'vsls']);

const SEVERITY: Readonly<Record<DiagnosticsSettings['severity'], vscode.DiagnosticSeverity>> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
};

/** Display name of a rule; table-generated names are code and are not translated. */
export function ruleDisplayName(rule: FeatureRule): string {
  return rule.generated ? rule.name : vscode.l10n.t(rule.name);
}

function message(v: Violation, mode: DiagnosticsMode): string {
  const name = ruleDisplayName(v.rule);
  if (v.reason === 'forbidden' || !v.offending) {
    return vscode.l10n.t('{0} is forbidden by the rule settings (cppStandards.rules).', name);
  }
  if (v.rule.kind === 'since') {
    return mode === 'target'
      ? vscode.l10n.t('{0} requires {1}, but the target standard is {2}.', name, v.ruleStd.label, v.offending.label)
      : vscode.l10n.t('{0} requires {1}, but {2} is enabled and the code must compile with every enabled standard.', name, v.ruleStd.label, v.offending.label);
  }
  return mode === 'target'
    ? vscode.l10n.t('{0} was removed in {1} (target standard: {2}).', name, v.ruleStd.label, v.offending.label)
    : vscode.l10n.t('{0} was removed in {1}, but {2} is enabled and the code must compile with every enabled standard.', name, v.ruleStd.label, v.offending.label);
}

/** Language of a file that is not open, guessed from its extension and `files.associations`. */
function languageOfPath(uri: vscode.Uri): Lang | undefined {
  const path = uri.path.toLowerCase();
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot) : '';
  const associations = vscode.workspace.getConfiguration('files').get<Record<string, string>>('associations', {});
  for (const [pattern, languageId] of Object.entries(associations)) {
    if (pattern === `*${ext}` || pattern.toLowerCase() === `*${ext}`) {
      return languageIdToLang(languageId);
    }
  }
  // Everything else, including .h (which VS Code opens as C++ by default), is treated as C++.
  return C_EXTENSIONS.has(ext) ? 'c' : 'cpp';
}

export class DiagnosticsManager implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('cppStandards');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Files checked by "Check Workspace" that are not necessarily open. */
  private readonly scanned = new Set<string>();
  private readonly disposables: vscode.Disposable[] = [];
  private syntaxEngine: SyntaxEngine | undefined;
  private syntaxFailed = false;

  constructor(private readonly log: vscode.LogOutputChannel) {
    this.disposables.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((doc) => this.schedule(doc, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, DEBOUNCE_MS)),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        const timer = this.timers.get(key);
        if (timer) {
          clearTimeout(timer);
          this.timers.delete(key);
        }
        if (!this.scanned.has(key)) {
          this.collection.delete(doc.uri);
        }
      }),
    );
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  /** Starts using the syntax engine (tree-sitter) and re-checks everything. */
  setSyntaxEngine(engine: SyntaxEngine): void {
    this.syntaxEngine = engine;
    this.syntaxFailed = false;
    this.recheckAll();
  }

  /** True when diagnostics currently use syntax trees. */
  get usesSyntaxTree(): boolean {
    return this.syntaxEngine !== undefined && !this.syntaxFailed && getDiagnosticsSettings().syntaxTree;
  }

  private syntaxFacts(text: string, lang: Lang, settings: DiagnosticsSettings): SyntaxFacts | undefined {
    if (!settings.syntaxTree || !this.syntaxEngine || this.syntaxFailed) {
      return undefined;
    }
    try {
      return this.syntaxEngine.analyze(lang, text);
    } catch (err) {
      // A crash inside the WebAssembly parser leaves it in an unknown state: stop using it.
      this.syntaxFailed = true;
      this.log.error(`The syntax engine failed and is disabled until the window is reloaded: ${String(err)}`);
      return undefined;
    }
  }

  /** Re-checks every open C/C++ document and every previously scanned file. */
  recheckAll(): void {
    for (const doc of vscode.workspace.textDocuments) {
      this.checkDocument(doc);
    }
    const open = new Set(vscode.workspace.textDocuments.map((d) => d.uri.toString()));
    const pending = [...this.scanned].filter((key) => !open.has(key)).map((key) => vscode.Uri.parse(key));
    void this.checkFiles(pending);
  }

  private schedule(doc: vscode.TextDocument, delay: number): void {
    if (!languageIdToLang(doc.languageId) || !CHECKED_SCHEMES.has(doc.uri.scheme)) {
      return;
    }
    const key = doc.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.checkDocument(doc);
      }, delay),
    );
  }

  checkDocument(doc: vscode.TextDocument): void {
    if (doc.isClosed || !CHECKED_SCHEMES.has(doc.uri.scheme)) {
      return;
    }
    const lang = languageIdToLang(doc.languageId);
    if (!lang) {
      // The language may have changed (e.g. from C++ to plain text).
      this.collection.delete(doc.uri);
      return;
    }
    const settings = getDiagnosticsSettings();
    if (!settings.enabled || this.isExcluded(doc, settings) || doc.getText().length > MAX_FILE_SIZE) {
      this.collection.delete(doc.uri);
      return;
    }
    this.collection.set(doc.uri, this.compute(doc.getText(), lang, settings, (offset) => doc.positionAt(offset)));
  }

  private isExcluded(doc: vscode.TextDocument, settings: DiagnosticsSettings): boolean {
    return settings.exclude.some((pattern) => vscode.languages.match({ pattern }, doc) > 0);
  }

  private compute(
    text: string,
    lang: Lang,
    settings: DiagnosticsSettings,
    positionAt: (offset: number) => vscode.Position,
  ): vscode.Diagnostic[] {
    const state = getLangState(lang);
    const checked = checkedStandards(state, settings.mode);
    if (checked.length === 0) {
      return [];
    }
    const started = Date.now();
    const rules = settings.rules;
    const syntax = this.syntaxFacts(text, lang, settings);
    const result = analyze(text, {
      lang,
      checked,
      gnu: isGnu(),
      checkRemoved: settings.checkRemoved,
      evaluatePreprocessor: settings.evaluatePreprocessor,
      syntax,
      ruleState: rules.isEmpty
        ? undefined
        : (id) => {
            const state = rules.resolve(id).state;
            return state === 'default' ? undefined : state;
          },
    });
    const elapsed = Date.now() - started;
    if (elapsed > 200) {
      this.log.debug(`Analysis took ${elapsed} ms for ${text.length} characters`);
    }
    const diagnostics = result.violations.map((v) => {
      const severity = SEVERITY[(rules.isEmpty ? undefined : rules.resolve(v.rule.id).severity) ?? settings.severity];
      const d = new vscode.Diagnostic(new vscode.Range(positionAt(v.start), positionAt(v.end)), message(v, settings.mode), severity);
      d.source = DIAGNOSTIC_SOURCE;
      d.code = v.rule.id;
      if (v.rule.kind === 'removed') {
        d.tags = [vscode.DiagnosticTag.Deprecated];
      }
      return d;
    });
    if (result.truncated && diagnostics.length > 0) {
      diagnostics[diagnostics.length - 1].message += ' ' + vscode.l10n.t('(Further findings in this file are not shown.)');
    }
    return diagnostics;
  }

  /** Checks all C/C++ files in the workspace, including files that are not open. */
  async checkWorkspace(): Promise<void> {
    const settings = getDiagnosticsSettings();
    if (!settings.enabled) {
      const enable = vscode.l10n.t('Enable');
      const choice = await vscode.window.showWarningMessage(vscode.l10n.t('Feature diagnostics are disabled.'), enable);
      if (choice !== enable) {
        return;
      }
      await updateSetting('diagnostics.enabled', true);
    }
    const exclude = ['**/node_modules/**', '**/.git/**', ...settings.exclude];
    const files = await vscode.workspace.findFiles(SOURCE_GLOB, `{${exclude.join(',')}}`, 20000);
    for (const key of this.scanned) {
      this.collection.delete(vscode.Uri.parse(key));
    }
    this.scanned.clear();
    const count = await this.checkFiles(files, true);
    let problems = 0;
    this.collection.forEach((_uri, diagnostics) => (problems += diagnostics.length));
    void vscode.window.showInformationMessage(vscode.l10n.t('Checked {0} files: {1} findings.', count, problems));
  }

  private async checkFiles(files: readonly vscode.Uri[], withProgress = false): Promise<number> {
    if (files.length === 0) {
      return 0;
    }
    const run = async (progress?: vscode.Progress<{ increment?: number; message?: string }>, token?: vscode.CancellationToken): Promise<number> => {
      const settings = getDiagnosticsSettings();
      const openDocs = new Map(vscode.workspace.textDocuments.map((d) => [d.uri.toString(), d]));
      const decoder = new TextDecoder('utf-8');
      let done = 0;
      for (const uri of files) {
        if (token?.isCancellationRequested) {
          break;
        }
        const key = uri.toString();
        this.scanned.add(key);
        const doc = openDocs.get(key);
        if (doc) {
          this.checkDocument(doc);
        } else {
          try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const lang = languageOfPath(uri);
            if (lang && bytes.length <= MAX_FILE_SIZE && settings.enabled) {
              const text = decoder.decode(bytes);
              const lineStarts = [0];
              for (let i = 0; i < text.length; i++) {
                if (text.charCodeAt(i) === 10) {
                  lineStarts.push(i + 1);
                }
              }
              const positionAt = (offset: number): vscode.Position => {
                let lo = 0;
                let hi = lineStarts.length - 1;
                while (lo < hi) {
                  const mid = (lo + hi + 1) >> 1;
                  if (lineStarts[mid] <= offset) {
                    lo = mid;
                  } else {
                    hi = mid - 1;
                  }
                }
                return new vscode.Position(lo, offset - lineStarts[lo]);
              };
              this.collection.set(uri, this.compute(text, lang, settings, positionAt));
            } else {
              this.collection.delete(uri);
            }
          } catch (err) {
            this.log.warn(`Could not check ${uri.fsPath}: ${String(err)}`);
          }
        }
        done++;
        if (progress && done % 25 === 0) {
          progress.report({ increment: (25 / files.length) * 100, message: `${done}/${files.length}` });
        }
      }
      return done;
    };
    if (!withProgress) {
      return run();
    }
    return vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Checking C/C++ files'), cancellable: true },
      (progress, token) => run(progress, token),
    );
  }
}

export class StandardsCodeActionProvider implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const lang = languageIdToLang(document.languageId);
    if (!lang) {
      return [];
    }
    const actions: vscode.CodeAction[] = [];
    const settings = getDiagnosticsSettings();
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE || typeof diagnostic.code !== 'string') {
        continue;
      }
      const rule = getRule(diagnostic.code);
      const ruleStd = findStandard(rule?.std);
      if (!rule || !ruleStd) {
        continue;
      }
      const state = getLangState(lang);
      const label = langLabel(lang);
      const command = (title: string, id: string, args: unknown[], preferred = false): void => {
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        action.command = { title, command: id, arguments: args };
        action.diagnostics = [diagnostic];
        action.isPreferred = preferred;
        actions.push(action);
      };

      const forbidden = settings.rules.resolve(rule.id).state === 'forbid';
      const verdict = standardVerdict(rule, checkedStandards(state, settings.mode), { gnu: isGnu(), checkRemoved: settings.checkRemoved });
      if (forbidden) {
        command(vscode.l10n.t('Stop forbidding "{0}"', ruleDisplayName(rule)), 'cppStandards.setRules', [[rule.id], { state: 'default' }]);
      }

      // Changing standards only helps when the selected standards are why the rule is reported
      // (not when it is reported solely because it is forbidden).
      if (verdict.reported && rule.kind === 'since') {
        if (settings.mode === 'target') {
          if (state.disabledIds.has(ruleStd.id)) {
            command(vscode.l10n.t('Enable {0} and make it the {1} target standard', ruleStd.label, label), 'cppStandards.setTarget', [lang, ruleStd.id, { enable: true }]);
          } else {
            command(vscode.l10n.t('Set the {0} target standard to {1}', label, ruleStd.label), 'cppStandards.setTarget', [lang, ruleStd.id]);
          }
        } else if (state.enabled.some((s) => s.rank >= ruleStd.rank)) {
          command(vscode.l10n.t('Disable {0} standards older than {1}', label, ruleStd.label), 'cppStandards.disableOutside', [lang, { min: ruleStd.id }]);
        }
      } else if (verdict.reported && settings.mode === 'target') {
        const older = [...state.enabled].reverse().find((s) => s.rank < ruleStd.rank);
        if (older) {
          command(vscode.l10n.t('Set the {0} target standard to {1}', label, older.label), 'cppStandards.setTarget', [lang, older.id]);
        }
      } else if (verdict.reported && state.enabled.some((s) => s.rank < ruleStd.rank)) {
        command(vscode.l10n.t('Disable {0} and newer {1} standards', ruleStd.label, label), 'cppStandards.disableOutside', [lang, { maxExclusive: ruleStd.id }]);
      }

      // Suppress on this line: insert a comment above it. C89 has no `//` comments.
      const line = document.lineAt(diagnostic.range.start.line);
      const indent = line.text.slice(0, line.firstNonWhitespaceCharacterIndex);
      const commentText = lang === 'c' ? `/* cppstd-ignore-next-line ${rule.id} */` : `// cppstd-ignore-next-line ${rule.id}`;
      const suppress = new vscode.CodeAction(vscode.l10n.t('Suppress "{0}" on this line', rule.id), vscode.CodeActionKind.QuickFix);
      suppress.edit = new vscode.WorkspaceEdit();
      const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
      suppress.edit.insert(document.uri, new vscode.Position(line.lineNumber, 0), `${indent}${commentText}${eol}`);
      suppress.diagnostics = [diagnostic];
      actions.push(suppress);

      command(vscode.l10n.t('Allow "{0}" in this workspace', ruleDisplayName(rule)), 'cppStandards.setRules', [[rule.id], { state: 'allow' }]);
      command(vscode.l10n.t('Configure rules...'), 'cppStandards.configureRules', [{ lang, search: rule.id }]);
    }
    return actions;
  }
}
