import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SECTION } from './config';
import { SyntaxEngine } from './analysis/syntax/engine';
import { DiagnosticsManager, StandardsCodeActionProvider } from './diagnostics';
import { RulesPanel } from './rulesPanel';
import { registerSingleRulesView } from './singleRules';
import { StatusBar } from './statusBar';
import { SyncManager } from './sync';
import { handleCheckboxChange, StandardsTreeProvider } from './tree';

const STANDARD_KEYS = ['cpp.target', 'cpp.disabled', 'c.target', 'c.disabled', 'gnuExtensions'];

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('C/C++ Standards', { log: true });
  const tree = new StandardsTreeProvider();
  const treeView = vscode.window.createTreeView('cppStandards.view', { treeDataProvider: tree });
  const statusBar = new StatusBar();
  const sync = new SyncManager(context, log);
  const diagnostics = new DiagnosticsManager(log);

  context.subscriptions.push(
    log,
    treeView,
    statusBar,
    sync,
    diagnostics,
    treeView.onDidChangeCheckboxState((e) => {
      handleCheckboxChange(e, tree).catch((err) => log.error(`Could not apply change: ${String(err)}`));
    }),
    vscode.languages.registerCodeActionsProvider(
      [{ language: 'c' }, { language: 'cpp' }, { language: 'cuda-cpp' }],
      new StandardsCodeActionProvider(),
      StandardsCodeActionProvider.metadata,
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(SECTION) && !e.affectsConfiguration('files.associations')) {
        return;
      }
      tree.refresh();
      statusBar.update();
      diagnostics.recheckAll();
      RulesPanel.refresh();
      const affects = (key: string): boolean => e.affectsConfiguration(`${SECTION}.${key}`);
      // Conformance warnings follow the diagnostics mode, clang-tidy checks follow the forbidden rules.
      if (STANDARD_KEYS.some(affects) || affects('sync') || affects('diagnostics.mode') || affects('rules')) {
        sync.scheduleSync();
      }
    }),
  );

  registerCommands(context, { diagnostics, sync });
  const singleRules = registerSingleRulesView(context, log);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(SECTION)) {
        singleRules.refresh();
      }
    }),
  );
  diagnostics.recheckAll();
  void sync.syncOnStartup();
  loadSyntaxEngine(context, diagnostics, log);
}

/** Loads tree-sitter in the background; until then (or if it fails) the regex engine is used. */
function loadSyntaxEngine(context: vscode.ExtensionContext, diagnostics: DiagnosticsManager, log: vscode.LogOutputChannel): void {
  const started = Date.now();
  SyntaxEngine.load(context.asAbsolutePath('grammars')).then(
    (engine) => {
      context.subscriptions.push(engine);
      log.info(`Syntax engine (tree-sitter) loaded in ${Date.now() - started} ms`);
      diagnostics.setSyntaxEngine(engine);
    },
    (err) => log.warn(`Syntax engine unavailable, using regular expressions only: ${String(err)}`),
  );
}

export function deactivate(): void {
  // Everything else is disposed through the extension context.
  RulesPanel.close();
}
