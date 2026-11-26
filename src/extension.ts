import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SECTION } from './config';
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
      if (STANDARD_KEYS.some(affects) || affects('sync')) {
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
}

export function deactivate(): void {
  // Everything else is disposed through the extension context.
  RulesPanel.close();
}
