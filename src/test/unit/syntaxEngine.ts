import * as path from 'node:path';
import { SyntaxEngine } from '../../analysis/syntax/engine';

export const GRAMMAR_DIR = path.resolve(__dirname, '..', '..', '..', 'grammars');

let loading: Promise<SyntaxEngine> | undefined;

/** The syntax engine, loaded once per test process. */
export function loadSyntaxEngine(): Promise<SyntaxEngine> {
  loading ??= SyntaxEngine.load(GRAMMAR_DIR);
  return loading;
}
