/**
 * Loads tree-sitter (WebAssembly) and the C and C++ grammars, and turns source text into
 * `SyntaxFacts`. Loading is asynchronous; once loaded, `analyze` is synchronous, so the analyzer
 * itself does not change shape. Without the engine (not loaded yet, failed to load, or disabled)
 * the analyzer falls back to its regular expressions.
 */

import * as path from 'node:path';
import type * as TreeSitter from 'web-tree-sitter';
import type { Lang } from '../../standards';
import { buildQuerySource, collectFacts } from './detectors';
import type { SyntaxFacts } from './facts';

/** Files larger than this are checked with the regular expressions only. */
export const SYNTAX_MAX_LENGTH = 1024 * 1024;
/** Upper bound for one parse plus query, after which the regular expressions are used. */
const TIME_BUDGET_MS = 3000;

interface LanguageData {
  readonly language: TreeSitter.Language;
  readonly query: TreeSitter.Query;
}

export class SyntaxEngine {
  private disposed = false;

  private constructor(
    private readonly parser: TreeSitter.Parser,
    private readonly languages: ReadonlyMap<Lang, LanguageData>,
  ) {}

  /** Loads the runtime and the grammars found in `grammarDir` (`tree-sitter-c.wasm`, `tree-sitter-cpp.wasm`). */
  static async load(grammarDir: string): Promise<SyntaxEngine> {
    // Loaded lazily so that a missing or broken runtime only disables the syntax engine.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ts = require('web-tree-sitter') as typeof TreeSitter;
    await ts.Parser.init();
    const languages = new Map<Lang, LanguageData>();
    for (const lang of ['c', 'cpp'] as const) {
      const language = await ts.Language.load(path.join(grammarDir, `tree-sitter-${lang}.wasm`));
      languages.set(lang, { language, query: new ts.Query(language, buildQuerySource(lang)) });
    }
    return new SyntaxEngine(new ts.Parser(), languages);
  }

  /** Parses `text` and collects facts; undefined when the text cannot be parsed usefully. */
  analyze(lang: Lang, text: string): SyntaxFacts | undefined {
    const data = this.languages.get(lang);
    if (!data || this.disposed || text.length > SYNTAX_MAX_LENGTH) {
      return undefined;
    }
    const deadline = Date.now() + TIME_BUDGET_MS;
    const overBudget = (): boolean => Date.now() > deadline;
    this.parser.setLanguage(data.language);
    const tree = this.parser.parse(text, null, { progressCallback: overBudget });
    if (!tree) {
      return undefined;
    }
    try {
      const captures = data.query.captures(tree.rootNode, { progressCallback: overBudget });
      return overBudget() ? undefined : collectFacts(lang, text.length, captures);
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const { query } of this.languages.values()) {
      query.delete();
    }
    this.parser.delete();
  }
}
