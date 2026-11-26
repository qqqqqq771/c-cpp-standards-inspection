/**
 * Finds uses of language and library features that are not available in (or were removed from)
 * the standards a file is checked against. Pure function of the source text and options; it does
 * not depend on the VS Code API.
 */

import type { Lang, StandardInfo } from '../standards';
import { findStandard } from '../standards';
import { computeLineStarts, lex, lineOf } from './lexer';
import type { LexToken } from './lexer';
import { analyzePreprocessor } from './preprocessor';
import { ruleSet } from './rules';
import type { FeatureRule } from './rules';

export interface AnalyzeOptions {
  readonly lang: Lang;
  /**
   * Standards the code must compile with, sorted oldest first (at most 16).
   * In "target" mode this is just the target standard.
   */
  readonly checked: readonly StandardInfo[];
  /** GNU dialect: skip features that GCC/Clang accept as extensions. */
  readonly gnu?: boolean;
  /** Report features removed by a checked standard (default true). */
  readonly checkRemoved?: boolean;
  /** Evaluate `#if` conditions to skip code that is not compiled for the checked standards (default true). */
  readonly evaluatePreprocessor?: boolean;
  /**
   * Per-rule override: `allow` never reports the rule, `forbid` reports every use even when the
   * checked standards support it (and regardless of `gnu` / `checkRemoved`).
   */
  readonly ruleState?: (ruleId: string) => 'allow' | 'forbid' | undefined;
  /** Maximum number of violations to return (default 1000). */
  readonly maxResults?: number;
}

export interface Violation {
  readonly rule: FeatureRule;
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
  readonly line: number;
  /** Standard that introduced (kind `since`) or removed (kind `removed`) the feature. */
  readonly ruleStd: StandardInfo;
  /** `standard`: a checked standard does not support the feature. `forbidden`: forbidden by a rule override. */
  readonly reason: 'standard' | 'forbidden';
  /** Checked standard in which the code does not compile (reason `standard` only). */
  readonly offending?: StandardInfo;
}

export type VerdictKind = 'supported' | 'unsupported' | 'removed' | 'gnu' | 'removedUnchecked' | 'none';

export interface Verdict {
  readonly kind: VerdictKind;
  /** True when the rule is reported unless overridden. */
  readonly reported: boolean;
  readonly offending?: StandardInfo;
}

/**
 * How a rule compares with the checked standards (oldest first), ignoring overrides and
 * preprocessor conditions. Used to show the default behaviour of each rule.
 */
export function standardVerdict(
  rule: FeatureRule,
  checked: readonly StandardInfo[],
  options: { readonly gnu?: boolean; readonly checkRemoved?: boolean } = {},
): Verdict {
  const ruleStd = findStandard(rule.std);
  if (!ruleStd || checked.length === 0) {
    return { kind: 'none', reported: false };
  }
  let offending: StandardInfo | undefined;
  if (rule.kind === 'since') {
    offending = checked[0].rank < ruleStd.rank ? checked[0] : undefined;
  } else {
    const newest = checked[checked.length - 1];
    offending = newest.rank >= ruleStd.rank ? newest : undefined;
  }
  if (!offending) {
    return { kind: 'supported', reported: false };
  }
  if (options.gnu && rule.gnu) {
    return { kind: 'gnu', reported: false, offending };
  }
  if (rule.kind === 'removed') {
    return options.checkRemoved === false
      ? { kind: 'removedUnchecked', reported: false, offending }
      : { kind: 'removed', reported: true, offending };
  }
  return { kind: 'unsupported', reported: true, offending };
}

export interface AnalysisResult {
  readonly violations: readonly Violation[];
  readonly lineStarts: readonly number[];
  readonly truncated: boolean;
}

interface RawFinding {
  readonly rule: FeatureRule;
  readonly start: number;
  readonly end: number;
}

const STD_RE = /\bstd\s*::\s*([A-Za-z_]\w*(?:\s*::\s*[A-Za-z_]\w*)*)/g;
const HEADER_RE = /^[ \t]*#[ \t]*include[ \t]*<([^>\n]+)>/gm;
const FUNC_RE = /(?<![\w.]|->|::)\b([A-Za-z_]\w*)\s*\(/g;
const MEMBER_RE = /(?:\.|->)\s*([A-Za-z_]\w*)\s*\(/g;
const ATTR_RE = /\[\[([^[\]]*)\]\]/g;
const IGNORE_RE = /cppstd-ignore(-next-line)?(?![\w-])([^\n]*)/;

const compiledPatterns = new WeakMap<FeatureRule, RegExp>();

function compiled(rule: FeatureRule): RegExp {
  let re = compiledPatterns.get(rule);
  if (!re) {
    const flags = new Set([...rule.pattern!.flags, 'g', 'd']);
    re = new RegExp(rule.pattern!.source, [...flags].join(''));
    compiledPatterns.set(rule, re);
  }
  re.lastIndex = 0;
  return re;
}

/** True when `id` matches `pattern`, which may end with `*` to match a prefix. */
export function matchesRuleId(pattern: string, id: string): boolean {
  return pattern.endsWith('*') ? id.startsWith(pattern.slice(0, -1)) : pattern === id;
}

function collectIgnores(tokens: readonly LexToken[], lineStarts: readonly number[]): Map<number, string[] | null> {
  const ignores = new Map<number, string[] | null>();
  for (const tok of tokens) {
    if (tok.kind !== 'lineComment' && tok.kind !== 'blockComment') {
      continue;
    }
    const m = IGNORE_RE.exec(tok.text);
    if (!m) {
      continue;
    }
    const ids = m[2]
      .replace(/\*\/\s*$/, '')
      .split(/[\s,]+/)
      .filter((s) => /^[A-Za-z0-9][\w.+*-]*$/.test(s));
    const line = m[1] ? lineOf(lineStarts, tok.end) + 1 : lineOf(lineStarts, tok.start);
    const existing = ignores.get(line);
    if (existing === null || ids.length === 0) {
      ignores.set(line, null);
    } else {
      ignores.set(line, [...(existing ?? []), ...ids]);
    }
  }
  return ignores;
}

function overlaps(list: Array<readonly [number, number]>, start: number, end: number): number {
  // `list` is sorted by start and non-overlapping; returns -1 on overlap, else the insertion index.
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] < end) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo > 0 && list[lo - 1][1] > start ? -1 : lo;
}

/**
 * When several violations of the same kind overlap (e.g. `auto` and a structured binding
 * `auto [a, b]`), keep only the most specific one: the newest feature for `since`, the
 * earliest removal for `removed`, and the longest match on ties.
 */
function dedupe(violations: Violation[]): Violation[] {
  const result: Violation[] = [];
  for (const kind of ['since', 'removed'] as const) {
    const ofKind = violations.filter((v) => v.rule.kind === kind);
    ofKind.sort((a, b) => {
      const byRank = kind === 'since' ? b.ruleStd.rank - a.ruleStd.rank : a.ruleStd.rank - b.ruleStd.rank;
      return byRank || b.end - b.start - (a.end - a.start) || a.start - b.start;
    });
    const accepted: Array<readonly [number, number]> = [];
    for (const v of ofKind) {
      const at = overlaps(accepted, v.start, Math.max(v.end, v.start + 1));
      if (at >= 0) {
        accepted.splice(at, 0, [v.start, Math.max(v.end, v.start + 1)]);
        result.push(v);
      }
    }
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

export function analyze(src: string, options: AnalyzeOptions): AnalysisResult {
  const lineStarts = computeLineStarts(src);
  const checked = options.checked;
  if (checked.length === 0) {
    return { violations: [], lineStarts, truncated: false };
  }
  if (checked.length > 16) {
    throw new Error('At most 16 standards can be checked at once');
  }
  const { masked, tokens } = lex(src);
  const set = ruleSet(options.lang);
  const gnu = options.gnu ?? false;
  const checkRemoved = options.checkRemoved ?? true;
  const pp = analyzePreprocessor(masked, lineStarts, checked, options.evaluatePreprocessor ?? true);
  const ignores = collectIgnores(tokens, lineStarts);

  const unlessCache = new Map<RegExp, boolean>();
  const stateCache = new Map<FeatureRule, 'allow' | 'forbid' | undefined>();
  const stateOf = (rule: FeatureRule): 'allow' | 'forbid' | undefined => {
    if (!options.ruleState) {
      return undefined;
    }
    if (!stateCache.has(rule)) {
      stateCache.set(rule, options.ruleState(rule.id));
    }
    return stateCache.get(rule);
  };
  /**
   * False when no checked standard can make the rule a violation: a feature introduced no later
   * than the oldest checked standard (including every feature of the first standard), or removed
   * after the newest one. Such rules only matter when forbidden, so scanning for them is skipped.
   */
  const canOffend = (rule: FeatureRule): boolean => {
    const ruleStd = findStandard(rule.std);
    if (!ruleStd) {
      return false;
    }
    return rule.kind === 'since' ? ruleStd.rank > checked[0].rank : ruleStd.rank <= checked[checked.length - 1].rank;
  };
  const activeCache = new Map<FeatureRule, boolean>();
  const active = (rule: FeatureRule): boolean => {
    let result = activeCache.get(rule);
    if (result !== undefined) {
      return result;
    }
    const state = stateOf(rule);
    if (state === 'allow') {
      result = false;
    } else if (state !== 'forbid' && ((gnu && rule.gnu) || (rule.kind === 'removed' && !checkRemoved) || !canOffend(rule))) {
      result = false;
    } else if (rule.unless) {
      let hit = unlessCache.get(rule.unless);
      if (hit === undefined) {
        hit = rule.unless.test(masked);
        unlessCache.set(rule.unless, hit);
      }
      result = !hit;
    } else {
      result = true;
    }
    activeCache.set(rule, result);
    return result;
  };

  const raw: RawFinding[] = [];
  const addAll = (rules: readonly FeatureRule[] | undefined, start: number, end: number): void => {
    for (const rule of rules ?? []) {
      if (active(rule)) {
        raw.push({ rule, start, end });
      }
    }
  };

  // Regular-expression rules.
  for (const rule of set.regex) {
    if (!active(rule)) {
      continue;
    }
    const re = compiled(rule);
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) {
      const range = m.indices?.groups?.hl ?? m.indices![0];
      raw.push({ rule, start: range[0], end: range[1] });
      if (m[0].length === 0) {
        re.lastIndex++;
      }
    }
  }

  // Token rules.
  if (set.tokens.length > 0) {
    const tokenRules = set.tokens.filter(active);
    for (const tok of tokens) {
      for (const rule of tokenRules) {
        if (rule.token!(tok)) {
          // Highlight only the `//` marker of a line comment.
          raw.push({ rule, start: tok.start, end: tok.kind === 'lineComment' ? tok.start + 2 : tok.end });
        }
      }
    }
  }

  // Lookup tables.
  const stdTable = set.lookups.get('std');
  const stdTests = set.lookupTests.get('std');
  if (stdTable || stdTests) {
    for (const m of masked.matchAll(STD_RE)) {
      const start = m.index!;
      const base = start + m[0].length - m[1].length;
      const segments = [...m[1].matchAll(/[A-Za-z_]\w*/g)].map((s) => ({ name: s[0], end: base + s.index! + s[0].length }));
      for (let k = segments.length; k >= 1; k--) {
        const key = segments.slice(0, k).map((s) => s.name).join('::');
        addAll(stdTable?.get(key), start, segments[k - 1].end);
      }
      for (const rule of stdTests ?? []) {
        if (rule.lookup!.test!.test(segments[0].name) && active(rule)) {
          raw.push({ rule, start, end: segments[0].end });
        }
      }
    }
  }
  const headerTable = set.lookups.get('header');
  if (headerTable) {
    for (const m of masked.matchAll(HEADER_RE)) {
      const start = m.index! + m[0].lastIndexOf('<');
      addAll(headerTable.get(m[1].trim()), start, m.index! + m[0].length);
    }
  }
  const funcTable = set.lookups.get('func');
  if (funcTable) {
    for (const m of masked.matchAll(FUNC_RE)) {
      const rules = funcTable.get(m[1]);
      if (rules) {
        addAll(rules, m.index!, m.index! + m[1].length);
      }
    }
  }
  const memberTable = set.lookups.get('member');
  if (memberTable) {
    for (const m of masked.matchAll(MEMBER_RE)) {
      const rules = memberTable.get(m[1]);
      if (rules) {
        const start = m.index! + m[0].indexOf(m[1]);
        addAll(rules, start, start + m[1].length);
      }
    }
  }
  const attrTable = set.lookups.get('attr');
  if (attrTable) {
    for (const m of masked.matchAll(ATTR_RE)) {
      const start = m.index!;
      addAll(attrTable.get('*'), start, start + m[0].length);
      let content = m[1];
      if (/^\s*using\b/.test(content)) {
        continue;
      }
      for (let prev = ''; prev !== content; ) {
        prev = content;
        content = content.replace(/\([^()]*\)/g, (s) => ' '.repeat(s.length));
      }
      const contentStart = start + 2;
      for (const item of content.matchAll(/[^,]+/g)) {
        const attr = /^(\s*)([A-Za-z_]\w*)(\s*::)?/.exec(item[0]);
        if (!attr || attr[3]) {
          continue; // vendor attribute such as [[gnu::always_inline]]
        }
        const nameStart = contentStart + item.index! + attr[1].length;
        addAll(attrTable.get(attr[2]), nameStart, nameStart + attr[2].length);
      }
    }
  }

  // Decide which findings are violations.
  const full = (1 << checked.length) - 1;
  const exempt = pp.exempt;
  const inExempt = (offset: number): boolean => {
    let lo = 0;
    let hi = exempt.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (exempt[mid][0] <= offset) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo > 0 && offset < exempt[lo - 1][1];
  };

  const violations: Violation[] = [];
  for (const finding of raw) {
    const { rule, start, end } = finding;
    const ruleStd = findStandard(rule.std);
    if (!ruleStd || inExempt(start)) {
      continue;
    }
    const line = lineOf(lineStarts, start);
    const mask = pp.lineMasks ? pp.lineMasks[line] : full;
    if (mask === 0) {
      continue;
    }
    let offending: StandardInfo | undefined;
    // GNU dialects accept some features as extensions, and removed features can be ignored;
    // neither exemption applies to a forbidden rule, which is reported as `forbidden` instead.
    const standardApplies = !(gnu && rule.gnu) && !(rule.kind === 'removed' && !checkRemoved);
    if (standardApplies && rule.kind === 'since') {
      for (let i = 0; i < checked.length; i++) {
        if (mask & (1 << i)) {
          if (checked[i].rank < ruleStd.rank) {
            offending = checked[i];
          }
          break;
        }
      }
    } else if (standardApplies) {
      for (let i = checked.length - 1; i >= 0; i--) {
        if (mask & (1 << i)) {
          if (checked[i].rank >= ruleStd.rank) {
            offending = checked[i];
          }
          break;
        }
      }
    }
    const forbidden = stateOf(rule) === 'forbid';
    if (!offending && !forbidden) {
      continue;
    }
    if (ignores.has(line)) {
      const ids = ignores.get(line);
      if (ids === null || ids?.some((p) => matchesRuleId(p, rule.id))) {
        continue;
      }
    }
    violations.push({ rule, start, end, line, ruleStd, reason: offending ? 'standard' : 'forbidden', offending });
  }

  const deduped = dedupe(violations);
  const max = options.maxResults ?? 1000;
  return { violations: deduped.slice(0, max), lineStarts, truncated: deduped.length > max };
}
