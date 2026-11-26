/**
 * Evaluates preprocessor conditionals (`#if __cplusplus >= 201703L`, `#ifdef __cpp_concepts`,
 * `#if __has_include(<optional>)`, `#if 0`, ...) for each checked standard, so that code which is
 * only compiled for some standards is held only to those standards.
 *
 * The result is a bit mask per line: bit `i` is set when the line is (possibly) compiled under
 * `checked[i]`. Conditions that cannot be decided are treated as "possibly compiled", except for
 * compiler/feature probes that the extension does not know, whose guarded code is skipped.
 */

import type { StandardInfo } from '../standards';
import { findStandard } from '../standards';
import { lineEnd } from './lexer';
import {
  CPP_ATTRIBUTES,
  CPP_HEADERS,
  CPP_HEADERS_REMOVED,
  CPP_LANGUAGE_FEATURE_MACROS,
  CPP_LIBRARY,
  CPP_LIBRARY_FEATURE_MACROS,
  C_ATTRIBUTES,
  C_HEADERS,
} from './tables';

export interface PreprocessorInfo {
  /** Per-line mask of checked standards under which the line may be compiled; undefined when not evaluated. */
  readonly lineMasks?: Uint16Array;
  /**
   * Sorted, non-overlapping ranges inside directives where language features must not be reported,
   * e.g. macro names in `#define nullptr NULL` or the condition of `#if defined(__cpp_concepts)`.
   */
  readonly exempt: ReadonlyArray<readonly [number, number]>;
}

type Value = number | null;

interface MacroInfo {
  /** Whether the macro is defined: true/false, or null when unknown. */
  readonly defined: boolean | null;
  readonly value: Value;
  /** True when the macro probes a feature the extension cannot evaluate. */
  readonly guard?: boolean;
}

function invert(table: Readonly<Record<string, readonly string[]>>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [std, names] of Object.entries(table)) {
    for (const name of names) {
      if (!map.has(name)) {
        map.set(name, std);
      }
    }
  }
  return map;
}

const LANGUAGE_MACROS = invert(CPP_LANGUAGE_FEATURE_MACROS);
const LIBRARY_MACROS = invert(CPP_LIBRARY_FEATURE_MACROS);
const LIBRARY_NAMES = invert(CPP_LIBRARY);
const CPP_HEADER_SINCE = invert(CPP_HEADERS);
const CPP_HEADER_REMOVED = invert(CPP_HEADERS_REMOVED);
const C_HEADER_SINCE = invert(C_HEADERS);
const CPP_ATTRIBUTE_SINCE = invert(CPP_ATTRIBUTES);
const C_ATTRIBUTE_SINCE = invert(C_ATTRIBUTES);

const COMPILER_PROBES = new Set([
  '__has_feature', '__has_extension', '__has_builtin', '__has_attribute', '__has_warning',
  '__has_declspec_attribute', '__has_embed', '__building_module',
]);

const LIBCPP_STD_VER: Readonly<Record<string, number>> = {
  'c++98': 3, 'c++03': 3, 'c++11': 11, 'c++14': 14, 'c++17': 17, 'c++20': 20, 'c++23': 23, 'c++26': 26,
};

function atLeast(std: StandardInfo, id: string): boolean {
  const other = findStandard(id);
  return other !== undefined && other.lang === std.lang && std.rank >= other.rank;
}

function available(std: StandardInfo, since: string | undefined): boolean {
  return since !== undefined && atLeast(std, since);
}

function featureMacro(std: StandardInfo, since: string | undefined): MacroInfo {
  if (since === undefined) {
    return { defined: null, value: null, guard: true };
  }
  const ok = available(std, since);
  // Feature-test macros hold a date no later than the standard's own version macro;
  // using that value keeps comparisons such as `__cpp_constexpr >= 201603L` meaningful.
  return { defined: ok, value: ok ? std.versionMacro ?? 1 : 0 };
}

function macroInfo(name: string, std: StandardInfo): MacroInfo {
  const cpp = std.lang === 'cpp';
  switch (name) {
    case '__cplusplus':
      return cpp ? { defined: true, value: std.versionMacro ?? 0 } : { defined: false, value: 0 };
    case '__STDC_VERSION__':
      return !cpp && std.versionMacro !== undefined ? { defined: true, value: std.versionMacro } : { defined: false, value: 0 };
    case '__STDC__':
      return { defined: true, value: 1 };
    case '_MSVC_LANG':
      return cpp ? { defined: null, value: std.versionMacro ?? 0 } : { defined: false, value: 0 };
    case '_LIBCPP_STD_VER':
      return cpp ? { defined: null, value: LIBCPP_STD_VER[std.id] ?? null } : { defined: false, value: 0 };
    case 'true':
      return { defined: false, value: 1 };
    case 'false':
      return { defined: false, value: 0 };
    case '__has_include':
    case '__has_include_next':
      return { defined: cpp ? atLeast(std, 'c++17') : atLeast(std, 'c23'), value: null };
    case '__has_cpp_attribute':
      return { defined: cpp && atLeast(std, 'c++20'), value: null };
    case '__has_c_attribute':
      return { defined: !cpp && atLeast(std, 'c23'), value: null };
  }
  const msvc = /^_HAS_CXX(\d\d)$/.exec(name);
  if (msvc) {
    return cpp ? { defined: null, value: atLeast(std, `c++${msvc[1]}`) ? 1 : 0 } : { defined: false, value: 0 };
  }
  if (name.startsWith('__cpp_lib_')) {
    if (!cpp) {
      return { defined: false, value: 0 };
    }
    const lib = name.slice('__cpp_lib_'.length);
    return featureMacro(std, LIBRARY_MACROS.get(lib) ?? LIBRARY_NAMES.get(lib));
  }
  if (name.startsWith('__cpp_')) {
    return cpp ? featureMacro(std, LANGUAGE_MACROS.get(name)) : { defined: false, value: 0 };
  }
  if (COMPILER_PROBES.has(name)) {
    return { defined: null, value: null, guard: true };
  }
  return { defined: null, value: null };
}

function callValue(name: string, args: string, std: StandardInfo): { value: Value; guard: boolean } {
  const cpp = std.lang === 'cpp';
  if (name === '__has_include' || name === '__has_include_next') {
    const header = /^\s*<([^>]+)>\s*$/.exec(args)?.[1]?.trim();
    if (!header) {
      return { value: null, guard: false };
    }
    const since = cpp ? CPP_HEADER_SINCE.get(header) : C_HEADER_SINCE.get(header);
    const removed = cpp ? CPP_HEADER_REMOVED.get(header) : undefined;
    if (since === undefined && removed === undefined) {
      return { value: null, guard: false };
    }
    const ok = (since === undefined || atLeast(std, since)) && (removed === undefined || !atLeast(std, removed));
    return { value: ok ? 1 : 0, guard: false };
  }
  if (name === '__has_cpp_attribute' || name === '__has_c_attribute') {
    const attr = args.trim();
    if (attr.includes('::')) {
      return { value: null, guard: false };
    }
    if (name === '__has_cpp_attribute' ? !cpp : cpp) {
      return { value: 0, guard: false };
    }
    const since = cpp ? CPP_ATTRIBUTE_SINCE.get(attr) : C_ATTRIBUTE_SINCE.get(attr);
    if (since === undefined) {
      return { value: null, guard: false };
    }
    return { value: available(std, since) ? std.versionMacro ?? 1 : 0, guard: false };
  }
  if (COMPILER_PROBES.has(name)) {
    return { value: null, guard: true };
  }
  return { value: null, guard: false };
}

const BINARY_PRECEDENCE: Readonly<Record<string, number>> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};

const OP_RE = /\s*(<<|>>|<=|>=|==|!=|&&|\|\||[-+*/%<>&|^!~?:(),])/y;
const NUM_RE = /\s*(0[xX][0-9a-fA-F']+|0[bB][01']+|\d[\d']*)[uUlLzZ]*\b/y;
const IDENT_RE = /\s*([A-Za-z_]\w*)/y;

function applyBinary(op: string, a: Value, b: Value): Value {
  if (op === '&&') {
    if (a === 0 || b === 0) {
      return 0;
    }
    return a === null || b === null ? null : 1;
  }
  if (op === '||') {
    if ((a !== null && a !== 0) || (b !== null && b !== 0)) {
      return 1;
    }
    return a === null || b === null ? null : 0;
  }
  if (a === null || b === null) {
    return null;
  }
  switch (op) {
    case '|': return a | b;
    case '^': return a ^ b;
    case '&': return a & b;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '>': return a > b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? null : Math.trunc(a / b);
    case '%': return b === 0 ? null : a % b;
    default: return null;
  }
}

class ConditionEvaluator {
  private pos = 0;
  guard = false;

  constructor(private readonly src: string, private readonly std: StandardInfo) {}

  evaluate(): Value {
    try {
      const value = this.conditional();
      return /^\s*$/.test(this.src.slice(this.pos)) ? value : null;
    } catch {
      return null;
    }
  }

  private peekOp(): string | undefined {
    OP_RE.lastIndex = this.pos;
    const m = OP_RE.exec(this.src);
    return m ? m[1] : undefined;
  }

  private takeOp(op: string): boolean {
    OP_RE.lastIndex = this.pos;
    const m = OP_RE.exec(this.src);
    if (m && m[1] === op) {
      this.pos = OP_RE.lastIndex;
      return true;
    }
    return false;
  }

  private expect(op: string): void {
    if (!this.takeOp(op)) {
      throw new Error(`expected ${op}`);
    }
  }

  private conditional(): Value {
    const cond = this.binary(1);
    if (!this.takeOp('?')) {
      return cond;
    }
    const a = this.conditional();
    this.expect(':');
    const b = this.conditional();
    if (cond === null) {
      return a === b ? a : null;
    }
    return cond !== 0 ? a : b;
  }

  private binary(minPrecedence: number): Value {
    let left = this.unary();
    for (;;) {
      const op = this.peekOp();
      const precedence = op === undefined ? undefined : BINARY_PRECEDENCE[op];
      if (op === undefined || precedence === undefined || precedence < minPrecedence) {
        return left;
      }
      this.takeOp(op);
      const right = this.binary(precedence + 1);
      left = applyBinary(op, left, right);
    }
  }

  private unary(): Value {
    if (this.takeOp('!')) {
      const v = this.unary();
      return v === null ? null : v === 0 ? 1 : 0;
    }
    if (this.takeOp('~')) {
      const v = this.unary();
      return v === null ? null : ~v;
    }
    if (this.takeOp('-')) {
      const v = this.unary();
      return v === null ? null : -v;
    }
    if (this.takeOp('+')) {
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Value {
    if (this.takeOp('(')) {
      const v = this.conditional();
      this.expect(')');
      return v;
    }
    NUM_RE.lastIndex = this.pos;
    const num = NUM_RE.exec(this.src);
    if (num) {
      this.pos = NUM_RE.lastIndex;
      const digits = num[1].replace(/'/g, '');
      if (/^0[xX]/.test(digits)) {
        return parseInt(digits.slice(2), 16);
      }
      if (/^0[bB]/.test(digits)) {
        return parseInt(digits.slice(2), 2);
      }
      return digits.length > 1 && digits.startsWith('0') ? parseInt(digits, 8) : parseInt(digits, 10);
    }
    IDENT_RE.lastIndex = this.pos;
    const ident = IDENT_RE.exec(this.src);
    if (!ident) {
      throw new Error('unexpected token');
    }
    this.pos = IDENT_RE.lastIndex;
    const name = ident[1];
    if (name === 'defined') {
      const paren = this.takeOp('(');
      IDENT_RE.lastIndex = this.pos;
      const target = IDENT_RE.exec(this.src);
      if (!target) {
        throw new Error('expected identifier');
      }
      this.pos = IDENT_RE.lastIndex;
      if (paren) {
        this.expect(')');
      }
      const info = macroInfo(target[1], this.std);
      if (info.guard) {
        this.guard = true;
      }
      return info.defined === null ? null : info.defined ? 1 : 0;
    }
    if (this.peekOp() === '(') {
      const args = this.balancedArgs();
      const result = callValue(name, args, this.std);
      if (result.guard) {
        this.guard = true;
      }
      return result.value;
    }
    const info = macroInfo(name, this.std);
    if (info.guard) {
      this.guard = true;
    }
    return info.defined === false ? 0 : info.value;
  }

  private balancedArgs(): string {
    this.expect('(');
    const start = this.pos;
    let depth = 1;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos++];
      if (ch === '(') {
        depth++;
      } else if (ch === ')' && --depth === 0) {
        return this.src.slice(start, this.pos - 1);
      }
    }
    throw new Error('unbalanced parentheses');
  }
}

/** Evaluates a preprocessor condition for one standard. Exposed for tests. */
export function evaluateCondition(expression: string, std: StandardInfo): { value: Value; guard: boolean } {
  const evaluator = new ConditionEvaluator(expression, std);
  const value = evaluator.evaluate();
  return { value, guard: evaluator.guard };
}

interface Frame {
  readonly parent: number;
  taken: number;
  current: number;
}

const DIRECTIVE_RE = /^[ \t]*#[ \t]*([A-Za-z_]\w*)?/;

export function analyzePreprocessor(
  masked: string,
  lineStarts: readonly number[],
  checked: readonly StandardInfo[],
  evaluate: boolean,
): PreprocessorInfo {
  const lineCount = lineStarts.length;
  const full = (1 << checked.length) - 1;
  const masks = evaluate ? new Uint16Array(lineCount) : undefined;
  const exempt: Array<readonly [number, number]> = [];
  const stack: Frame[] = [];
  const current = (): number => (stack.length > 0 ? stack[stack.length - 1].current : full);

  const branch = (condition: string): { definite: number; active: number } => {
    let definite = 0;
    let active = 0;
    checked.forEach((std, i) => {
      const { value, guard } = evaluateCondition(condition, std);
      if (value !== null && value !== 0) {
        definite |= 1 << i;
      }
      if (value === null ? !guard : value !== 0) {
        active |= 1 << i;
      }
    });
    return { definite, active };
  };

  let line = 0;
  while (line < lineCount) {
    const start = lineStarts[line];
    const end = lineEnd(masked, lineStarts, line);
    if (masked.charCodeAt(start) !== 35 && !/^[ \t]*#/.test(masked.slice(start, end))) {
      if (masks) {
        masks[line] = current();
      }
      line++;
      continue;
    }

    // Join continuation lines.
    let last = line;
    let directiveEnd = end;
    while (last + 1 < lineCount && masked.charCodeAt(directiveEnd - 1) === 92) {
      last++;
      directiveEnd = lineEnd(masked, lineStarts, last);
    }
    const text = masked.slice(start, directiveEnd);
    const m = DIRECTIVE_RE.exec(text)!;
    const name = m[1] ?? '';
    const restStart = start + m[0].length;
    const rest = masked.slice(restStart, directiveEnd).replace(/\\\r?\n/g, ' ');

    switch (name) {
      case 'if':
      case 'elif':
      case 'ifdef':
      case 'ifndef':
      case 'elifdef':
      case 'elifndef':
      case 'undef':
      case 'pragma':
      case 'error':
      case 'warning':
      case 'line':
      case 'ident':
        if (directiveEnd > restStart) {
          exempt.push([restStart, directiveEnd]);
        }
        break;
      case 'define': {
        const head = /^[ \t]*[A-Za-z_]\w*(?:\([^)]*\))?/.exec(rest);
        if (head) {
          exempt.push([restStart, restStart + head[0].length]);
        }
        break;
      }
    }

    let directiveMask = current();
    if (masks) {
      const ident = /^\s*([A-Za-z_]\w*)/.exec(rest)?.[1] ?? '';
      const top = stack.length > 0 ? stack[stack.length - 1] : undefined;
      switch (name) {
        case 'if':
        case 'ifdef':
        case 'ifndef': {
          const condition = name === 'if' ? rest : `${name === 'ifndef' ? '!' : ''}defined(${ident})`;
          const parent = current();
          const r = branch(condition);
          stack.push({ parent, taken: r.definite & parent, current: r.active & parent });
          directiveMask = parent;
          break;
        }
        case 'elif':
        case 'elifdef':
        case 'elifndef': {
          if (!top) {
            break;
          }
          const condition = name === 'elif' ? rest : `${name === 'elifndef' ? '!' : ''}defined(${ident})`;
          const r = branch(condition);
          top.current = top.parent & ~top.taken & r.active;
          top.taken |= r.definite & top.parent;
          directiveMask = top.parent;
          break;
        }
        case 'else':
          if (top) {
            top.current = top.parent & ~top.taken;
            top.taken = top.parent;
            directiveMask = top.parent;
          }
          break;
        case 'endif':
          if (top) {
            stack.pop();
            directiveMask = top.parent;
          }
          break;
      }
      for (let l = line; l <= last; l++) {
        masks[l] = directiveMask;
      }
    }
    line = last + 1;
  }
  return { lineMasks: masks, exempt };
}
