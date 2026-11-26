/**
 * A small C/C++ lexer that blanks out comments and the contents of string/character literals
 * (offsets and line breaks are preserved), so that regular expressions can scan the remaining
 * code without matching inside text. It also records the literal and comment tokens it finds,
 * because some features (raw strings, digit separators, `//` comments in C89, ...) live there.
 */

export type TokenKind = 'string' | 'char' | 'number' | 'lineComment' | 'blockComment';

export interface NumberInfo {
  readonly binary: boolean;
  readonly hexFloat: boolean;
  readonly digitSeparator: boolean;
  readonly isFloat: boolean;
  /** Literal suffix, e.g. `ull`, `f`, `ms`, `_km`. */
  readonly suffix: string;
}

export interface LexToken {
  readonly kind: TokenKind;
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
  /** Encoding prefix of a string/character literal (`u8`, `u`, `U`, `L`, optionally followed by `R`). */
  readonly prefix: string;
  /** True for raw string literals. */
  readonly raw: boolean;
  /** User-defined literal suffix of a string/character literal. */
  readonly suffix: string;
  /** Source text for comments and numbers; empty for strings and characters. */
  readonly text: string;
  readonly number?: NumberInfo;
}

export interface LexResult {
  /** Source with comments and literal contents replaced by spaces. Same length as the input. */
  readonly masked: string;
  readonly tokens: readonly LexToken[];
}

const LITERAL_PREFIXES = new Set(['L', 'u', 'U', 'u8', 'R', 'LR', 'uR', 'UR', 'u8R']);

const CH_LF = 10;
const CH_CR = 13;
const CH_DQUOTE = 34;
const CH_SQUOTE = 39;
const CH_PLUS = 43;
const CH_MINUS = 45;
const CH_DOT = 46;
const CH_SLASH = 47;
const CH_STAR = 42;
const CH_BACKSLASH = 92;

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c > 127;
}

function isIdentPart(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57);
}

function isDigit(c: number): boolean {
  return c >= 48 && c <= 57;
}

export function classifyNumber(text: string): NumberInfo {
  let body: string;
  let binary = false;
  let hexFloat = false;
  let isFloat = false;
  if (/^0[xX]/.test(text)) {
    body = /^0[xX][0-9a-fA-F']*(?:\.[0-9a-fA-F']*)?(?:[pP][+-]?[0-9']+)?/.exec(text)![0];
    hexFloat = /[.pP]/.test(body.slice(2));
    isFloat = hexFloat;
  } else if (/^0[bB][01]/.test(text)) {
    body = /^0[bB][01']*/.exec(text)![0];
    binary = true;
  } else {
    body = /^(?:[0-9][0-9']*)?(?:\.[0-9']*)?(?:[eE][+-]?[0-9']+)?/.exec(text)![0];
    isFloat = /[.eE]/.test(body);
  }
  return { binary, hexFloat, isFloat, digitSeparator: body.includes("'"), suffix: text.slice(body.length) };
}

export function lex(src: string): LexResult {
  const n = src.length;
  const tokens: LexToken[] = [];
  const parts: string[] = [];
  let copied = 0;

  const mask = (from: number, to: number): void => {
    if (to <= from) {
      return;
    }
    parts.push(src.slice(copied, from), src.slice(from, to).replace(/[^\r\n]/g, ' '));
    copied = to;
  };

  const readSuffix = (pos: number): number => {
    if (pos < n && isIdentStart(src.charCodeAt(pos))) {
      let j = pos + 1;
      while (j < n && isIdentPart(src.charCodeAt(j))) {
        j++;
      }
      return j;
    }
    return pos;
  };

  const quoted = (start: number, quotePos: number, prefix: string, quote: number): number => {
    let j = quotePos + 1;
    while (j < n) {
      const ch = src.charCodeAt(j);
      if (ch === CH_BACKSLASH) {
        j += src.charCodeAt(j + 1) === CH_CR && src.charCodeAt(j + 2) === CH_LF ? 3 : 2;
        continue;
      }
      if (ch === quote || ch === CH_LF) {
        break;
      }
      j++;
    }
    j = Math.min(j, n);
    const closed = j < n && src.charCodeAt(j) === quote;
    mask(quotePos + 1, j);
    const end = closed ? j + 1 : j;
    const suffixEnd = closed ? readSuffix(end) : end;
    tokens.push({
      kind: quote === CH_DQUOTE ? 'string' : 'char',
      start,
      end: suffixEnd,
      prefix,
      raw: false,
      suffix: src.slice(end, suffixEnd),
      text: '',
    });
    return suffixEnd;
  };

  const rawString = (start: number, quotePos: number, prefix: string): number | undefined => {
    const open = src.indexOf('(', quotePos + 1);
    if (open < 0 || open - quotePos - 1 > 16) {
      return undefined;
    }
    const delimiter = src.slice(quotePos + 1, open);
    if (/[\s()\\"]/.test(delimiter)) {
      return undefined;
    }
    const terminator = ')' + delimiter + '"';
    const close = src.indexOf(terminator, open + 1);
    const closingQuote = close < 0 ? n : close + terminator.length - 1;
    mask(quotePos + 1, closingQuote);
    const end = close < 0 ? n : closingQuote + 1;
    const suffixEnd = close < 0 ? n : readSuffix(end);
    tokens.push({ kind: 'string', start, end: suffixEnd, prefix, raw: true, suffix: src.slice(end, suffixEnd), text: '' });
    return suffixEnd;
  };

  const comment = (kind: TokenKind, start: number, end: number): void => {
    tokens.push({ kind, start, end, prefix: '', raw: false, suffix: '', text: src.slice(start, end) });
    mask(start, end);
  };

  const numberAt = (start: number): number => {
    let j = start;
    while (j < n) {
      const ch = src.charCodeAt(j);
      if ((ch === 101 || ch === 69 || ch === 112 || ch === 80) && (src.charCodeAt(j + 1) === CH_PLUS || src.charCodeAt(j + 1) === CH_MINUS)) {
        j += 2;
        continue;
      }
      if (isIdentPart(ch) || ch === CH_DOT) {
        j++;
        continue;
      }
      // Digit separator (C++14, C23): a quote between two pp-number characters.
      if (ch === CH_SQUOTE && j + 1 < n && isIdentPart(src.charCodeAt(j + 1))) {
        j++;
        continue;
      }
      break;
    }
    const text = src.slice(start, j);
    tokens.push({ kind: 'number', start, end: j, prefix: '', raw: false, suffix: '', text, number: classifyNumber(text) });
    return j;
  };

  let i = 0;
  while (i < n) {
    const c = src.charCodeAt(i);
    if (c === CH_SLASH) {
      const d = src.charCodeAt(i + 1);
      if (d === CH_SLASH) {
        let j = i + 2;
        while (j < n) {
          if (src.charCodeAt(j) === CH_LF) {
            let k = j - 1;
            if (src.charCodeAt(k) === CH_CR) {
              k--;
            }
            if (k > i + 1 && src.charCodeAt(k) === CH_BACKSLASH) {
              j++;
              continue;
            }
            break;
          }
          j++;
        }
        // Do not include a trailing CR in the comment.
        const end = j > i + 2 && src.charCodeAt(j - 1) === CH_CR ? j - 1 : j;
        comment('lineComment', i, end);
        i = j;
        continue;
      }
      if (d === CH_STAR) {
        const close = src.indexOf('*/', i + 2);
        const end = close < 0 ? n : close + 2;
        comment('blockComment', i, end);
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (c === CH_DQUOTE) {
      i = quoted(i, i, '', CH_DQUOTE);
      continue;
    }
    if (c === CH_SQUOTE) {
      i = quoted(i, i, '', CH_SQUOTE);
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(src.charCodeAt(j))) {
        j++;
      }
      const next = src.charCodeAt(j);
      if ((next === CH_DQUOTE || next === CH_SQUOTE) && j < n) {
        const word = src.slice(i, j);
        if (LITERAL_PREFIXES.has(word)) {
          if (next === CH_DQUOTE) {
            const raw = word.endsWith('R') ? rawString(i, j, word) : undefined;
            i = raw ?? quoted(i, j, word, CH_DQUOTE);
            continue;
          }
          if (!word.endsWith('R')) {
            i = quoted(i, j, word, CH_SQUOTE);
            continue;
          }
        }
      }
      i = j;
      continue;
    }
    if (isDigit(c) || (c === CH_DOT && isDigit(src.charCodeAt(i + 1)))) {
      i = numberAt(i);
      continue;
    }
    i++;
  }
  parts.push(src.slice(copied));
  return { masked: parts.join(''), tokens };
}

/** Offsets at which each line starts. */
export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === CH_LF) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Zero-based line containing `offset`. */
export function lineOf(lineStarts: readonly number[], offset: number): number {
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
  return lo;
}

/** Index one past the last character of `line`, excluding the line break. */
export function lineEnd(text: string, lineStarts: readonly number[], line: number): number {
  let end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
  if (end > lineStarts[line] && text.charCodeAt(end - 1) === CH_CR) {
    end--;
  }
  return end;
}
