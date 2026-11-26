import { analyze } from '../../analysis/analyzer';
import type { AnalyzeOptions, Violation } from '../../analysis/analyzer';
import type { SyntaxEngine } from '../../analysis/syntax/engine';
import { findStandard } from '../../standards';
import type { Lang, StandardInfo } from '../../standards';

export function stds(ids: string | readonly string[]): StandardInfo[] {
  const list = (typeof ids === 'string' ? [ids] : ids).map((id) => {
    const std = findStandard(id);
    if (!std) {
      throw new Error(`unknown standard ${id}`);
    }
    return std;
  });
  return list.sort((a, b) => a.rank - b.rank);
}

let engine: SyntaxEngine | undefined;

/** Runs the helpers below with syntax facts from `syntax` (undefined: regular expressions only). */
export function useSyntaxEngine(syntax: SyntaxEngine | undefined): void {
  engine = syntax;
}

export function violations(
  src: string,
  lang: Lang,
  checked: string | readonly string[],
  options: Partial<AnalyzeOptions> = {},
): readonly Violation[] {
  const syntax = options.syntax ?? engine?.analyze(lang, src);
  return analyze(src, { lang, checked: stds(checked), ...options, syntax }).violations;
}

/** Rule ids of the violations, in source order. */
export function ids(
  src: string,
  lang: Lang,
  checked: string | readonly string[],
  options: Partial<AnalyzeOptions> = {},
): string[] {
  return violations(src, lang, checked, options).map((v) => v.rule.id);
}

/** Source text highlighted by each violation. */
export function highlights(src: string, lang: Lang, checked: string | readonly string[]): string[] {
  return violations(src, lang, checked).map((v) => src.slice(v.start, v.end));
}
