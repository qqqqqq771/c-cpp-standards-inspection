/**
 * Detection rules for language and library features that were introduced or removed by a
 * C or C++ standard. Patterns run against the masked source produced by the lexer, so they
 * never match inside comments or string literals.
 *
 * Patterns may contain a named group `hl` that selects the range to highlight; otherwise the
 * whole match is highlighted. The detection is heuristic (no real parser), so the patterns lean
 * towards avoiding false positives.
 */

import type { Lang } from '../standards';
import type { LexToken } from './lexer';
import {
  CPP_ATTRIBUTES,
  CPP_FUNCTIONS_REMOVED,
  CPP_HEADERS,
  CPP_HEADERS_REMOVED,
  CPP_LIBRARY,
  CPP_LIBRARY_REMOVED,
  CPP_MEMBERS,
  C_FUNCTIONS,
  C_FUNCTIONS_REMOVED,
  C_HEADERS,
} from './tables';

export type RuleKind = 'since' | 'removed';
export type LookupTable = 'std' | 'header' | 'func' | 'member' | 'attr';
export type RuleCategory = 'language' | 'literal' | 'library' | 'header' | 'attribute' | 'preprocessor';

export const RULE_CATEGORIES: readonly RuleCategory[] = ['language', 'literal', 'library', 'header', 'attribute', 'preprocessor'];

export interface FeatureRule {
  /** Stable identifier, e.g. `cpp17.structured-binding` or `c99.lib.snprintf`. */
  readonly id: string;
  readonly lang: Lang;
  /** `since`: the feature needs `std` or newer. `removed`: the feature is gone as of `std`. */
  readonly kind: RuleKind;
  readonly std: string;
  /** English display name (translated at runtime when a translation exists). */
  readonly name: string;
  /** True for rules generated from the lookup tables; their names are code and need no translation. */
  readonly generated?: boolean;
  readonly pattern?: RegExp;
  readonly token?: (token: LexToken) => boolean;
  readonly lookup?: { readonly table: LookupTable; readonly key?: string; readonly test?: RegExp };
  /** The rule is skipped for a file when this pattern matches anywhere in it. */
  readonly unless?: RegExp;
  /** The feature is accepted as an extension in GNU dialects (`-std=gnu++NN`). */
  readonly gnu?: boolean;
  /** Grouping used by the rule settings panel. */
  readonly category: RuleCategory;
}

type RuleInput = Omit<FeatureRule, 'category'> & { readonly category?: RuleCategory };
type Extra = Pick<RuleInput, 'unless' | 'gnu' | 'category'>;

const RULES: FeatureRule[] = [];

function stdPrefix(std: string): string {
  return std.startsWith('c++') ? `cpp${std.slice(3)}` : std;
}

function keySlug(key: string): string {
  return key.replace(/::/g, '.').replace(/[^A-Za-z0-9_.]/g, '-');
}

const CATEGORY_BY_FEATURE: Readonly<Record<string, RuleCategory>> = {
  'va-args': 'preprocessor',
  'va-opt': 'preprocessor',
  'pragma-operator': 'preprocessor',
  elifdef: 'preprocessor',
  'warning-directive': 'preprocessor',
  embed: 'preprocessor',
  'attribute-using': 'attribute',
  'line-comment': 'language',
  stdbool: 'library',
  'stdint-types': 'library',
};

function defaultCategory(rule: RuleInput): RuleCategory {
  const feature = rule.id.slice(rule.id.lastIndexOf('.') + 1);
  if (!rule.generated && CATEGORY_BY_FEATURE[feature]) {
    return CATEGORY_BY_FEATURE[feature];
  }
  switch (rule.lookup?.table) {
    case 'header':
      return 'header';
    case 'attr':
      return 'attribute';
    case 'std':
    case 'func':
    case 'member':
      return 'library';
  }
  return rule.token ? 'literal' : 'language';
}

function add(rule: RuleInput): void {
  RULES.push({ ...rule, category: rule.category ?? defaultCategory(rule) });
}

/** Builds a RegExp from a raw template string (no need to double backslashes). */
function re(strings: TemplateStringsArray, ...subs: string[]): RegExp {
  return new RegExp(String.raw(strings, ...subs));
}

function since(lang: Lang, std: string, id: string, name: string, pattern: RegExp, extra: Extra = {}): void {
  add({ id: `${stdPrefix(std)}.${id}`, lang, kind: 'since', std, name, pattern, ...extra });
}

function removed(lang: Lang, std: string, id: string, name: string, pattern: RegExp, extra: Extra = {}): void {
  add({ id: `${stdPrefix(std)}.removed.${id}`, lang, kind: 'removed', std, name, pattern, ...extra });
}

function token(lang: Lang, std: string, id: string, name: string, test: (t: LexToken) => boolean, extra: Extra = {}): void {
  add({ id: `${stdPrefix(std)}.${id}`, lang, kind: 'since', std, name, token: test, ...extra });
}

function tableRules(
  lang: Lang,
  kind: RuleKind,
  table: LookupTable,
  data: Readonly<Record<string, readonly string[]>>,
  display: (key: string) => string,
): void {
  for (const [std, keys] of Object.entries(data)) {
    for (const key of keys) {
      const kindPart = kind === 'removed' ? 'removed.' : '';
      add({
        id: `${stdPrefix(std)}.${kindPart}${table === 'std' ? 'lib' : table}.${keySlug(key)}`,
        lang,
        kind,
        std,
        name: display(key),
        generated: true,
        lookup: { table, key },
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shared pattern fragments

/** Context in which `[` starts a lambda introducer rather than a subscript. */
const LAMBDA_START = String.raw`(?:[=(,{;:?!&|]|\breturn)\s*`;
const BUILTIN_TYPES = 'int|char|short|long|float|double|signed|unsigned|bool|wchar_t';

// ---------------------------------------------------------------------------------------------
// Core features: part of the first standard (C++98 / C89) and therefore of every standard.
// They are never reported because of the selected standard; they exist so that individual
// features can be forbidden (coding guidelines such as "no #define constants").

// Macro rules highlight `define NAME`: the macro name alone lies in a range the preprocessor
// analysis exempts (so that `#define nullptr NULL` does not report `nullptr`).
/** An object-like macro whose replacement list is a constant expression (contains a literal). */
const MACRO_CONSTANT =
  /^[ \t]*#[ \t]*(?<hl>define[ \t]+[A-Za-z_]\w*)[ \t]+(?![^\n]*\b(?:__attribute__|__declspec|_Pragma|__pragma)\b)(?=[^\n]*(?:\b\d|\.\d|["']|\b(?:true|false)\b))[-+~!()\w \t.,'"*/%&|^<>?:]*\r?$/m;
const FUNCTION_MACRO = /^[ \t]*#[ \t]*(?<hl>define[ \t]+[A-Za-z_]\w*)\(/m;
const UNDEF = /^[ \t]*#[ \t]*(?<hl>undef)\b/m;
/** A C-style variadic parameter list (`int n, ...)`) or the <stdarg.h> macros. */
const C_VARIADIC = /[\w*&]\s+[*&]*\s*[A-Za-z_]\w*\s*,\s*(?<hl>\.\.\.)\s*\)|\bva_(?:list|start|arg|end|copy)\b/;
/** Octal integer literal (`0755`); a lone `0` is decimal-like and allowed. */
const isOctal = (t: LexToken): boolean => t.kind === 'number' && !t.number!.isFloat && /^0[0-7']+$/.test(t.text.slice(0, t.text.length - t.number!.suffix.length));

/** Function call, also through `std::`, but not a member or another namespace's function. */
function callOf(names: string): RegExp {
  return new RegExp(String.raw`(?<![\w.]|->|::\s*)(?:\bstd\s*::\s*)?\b(?<hl>${names})\s*\(`);
}

for (const lang of ['cpp', 'c'] as const) {
  const std = lang === 'cpp' ? 'c++98' : 'c89';
  since(lang, std, 'macro-constant', 'macro constants (#define NAME value)', MACRO_CONSTANT, { category: 'preprocessor' });
  since(lang, std, 'function-like-macro', 'function-like macros (#define F(x) ...)', FUNCTION_MACRO, { category: 'preprocessor' });
  since(lang, std, 'undef', '#undef', UNDEF, { category: 'preprocessor' });
  since(lang, std, 'goto', 'goto', /\bgoto\b/);
  since(lang, std, 'union', 'unions', /\bunion\b/);
  since(lang, std, 'variadic-function', 'C-style variadic functions (..., va_list)', C_VARIADIC);
  since(lang, std, 'asm', 'inline assembly (asm)', /\b(?:asm|__asm__|__asm)\b/);
  token(lang, std, 'octal-literal', 'octal integer literals (0755)', isOctal);
  since(lang, std, 'dynamic-memory', 'C dynamic memory functions (malloc, calloc, realloc, free)', callOf('malloc|calloc|realloc|free'), { category: 'library' });
  since(lang, std, 'unbounded-string', 'unbounded string functions (strcpy, strcat, sprintf, vsprintf)', callOf('strcpy|strcat|sprintf|vsprintf'), { category: 'library' });
  since(lang, std, 'ato-conversion', 'string conversions without error checking (atoi, atol, atof)', callOf('atoi|atol|atoll|atof'), { category: 'library' });
  since(lang, std, 'setjmp', 'setjmp / longjmp', callOf('setjmp|longjmp'), { category: 'library' });
  since(lang, std, 'rand', 'rand / srand', callOf('rand|srand'), { category: 'library' });
  since(lang, std, 'process-control', 'process termination and control (abort, exit, system)', callOf('abort|exit|system'), { category: 'library' });
  since(lang, std, 'signal', 'signal handling (signal, raise)', callOf('signal|raise'), { category: 'library' });
}

// C++ only.
/** A parenthesized built-in, `_t` or pointer type followed by an operand: `(int)x`, `(Foo*)p`. */
const C_CAST_TYPE = String.raw`(?:const\s+|volatile\s+)*(?:(?:(?:unsigned|signed)\s+)?(?:long\s+long|long\s+double|int|char|short|long|float|double|bool|wchar_t)(?:\s+int)?|unsigned|signed|(?:std\s*::\s*)?[a-z_]\w*_t|void(?=\s*\*)|(?:struct\s+|class\s+)?[A-Za-z_][\w:]*(?:\s*<[^<>()]*>)?(?=\s*(?:const\s*)?[*&]))(?:\s*(?:const\b|volatile\b|\*|&))*`;
since('cpp', 'c++98', 'c-style-cast', 'C-style casts ((int)x)', re`(?:^|[=(,;{}?:!&|+\-*/%<>~^[]|\breturn|\bthrow|\bcase)\s*(?<hl>\(\s*${C_CAST_TYPE}\s*\))\s*(?=[\w("'.]|[-+!~*&]\s*[\w(])`);
since('cpp', 'c++98', 'reinterpret-cast', 'reinterpret_cast', /\breinterpret_cast\b/);
since('cpp', 'c++98', 'const-cast', 'const_cast', /\bconst_cast\b/);
since('cpp', 'c++98', 'rtti', 'run-time type information (dynamic_cast, typeid)', /\b(?:dynamic_cast|typeid)\b/);
since('cpp', 'c++98', 'exceptions', 'exceptions (throw, try, catch)', /\b(?:throw|try|catch)\b/);
since('cpp', 'c++98', 'new-delete', 'new / delete expressions', /(?<!\boperator\s*|<\s*)\b(?:new|(?<!=\s*)delete)\b/);
since('cpp', 'c++98', 'using-namespace', 'using-directives (using namespace)', /\busing\s+namespace\b/);
since('cpp', 'c++98', 'typedef', 'typedef declarations', /\btypedef\b/);
since('cpp', 'c++98', 'null-macro', 'NULL macro', /\bNULL\b/);
since('cpp', 'c++98', 'unscoped-enum', 'unscoped enumerations (enum without class)', /\benum\b(?!\s+(?:class|struct)\b)(?=\s*(?:[A-Za-z_]\w*\s*)?(?::[^;{}]*)?\{)/);
since('cpp', 'c++98', 'c-header', 'C library headers in C++ (<stdio.h> instead of <cstdio>)', /^[ \t]*#[ \t]*include[ \t]*<(?<hl>(?:assert|ctype|errno|float|iso646|limits|locale|math|setjmp|signal|stdarg|stddef|stdio|stdlib|string|time|wchar|wctype|stdint|inttypes|stdbool|fenv|complex|uchar|stdalign|tgmath)\.h)>/m, { category: 'header' });

// ---------------------------------------------------------------------------------------------
// C++ language features

// C++11
since('cpp', 'c++11', 'nullptr', 'nullptr', /\bnullptr\b/);
since('cpp', 'c++11', 'constexpr', 'constexpr', /\bconstexpr\b/);
since('cpp', 'c++11', 'decltype', 'decltype', /\bdecltype\b/);
since('cpp', 'c++11', 'noexcept', 'noexcept', /\bnoexcept\b/);
since('cpp', 'c++11', 'static-assert', 'static_assert', /\bstatic_assert\b/);
since('cpp', 'c++11', 'alignas', 'alignas / alignof', /\balign(?:as|of)\b/);
since('cpp', 'c++11', 'thread-local', 'thread_local', /\bthread_local\b/);
since('cpp', 'c++11', 'char16-char32', 'char16_t / char32_t', /\bchar(?:16|32)_t\b/);
since('cpp', 'c++11', 'auto', 'auto type deduction', re`\bauto\b(?!\s+(?:${BUILTIN_TYPES})\b)`);
since('cpp', 'c++11', 'lambda', 'lambda expressions', re`${LAMBDA_START}(?<hl>\[[\w\s&=*,.]*\])\s*(?:\(|\{|mutable\b|->|<)`);
since('cpp', 'c++11', 'range-for', 'range-based for loops', /\b(?<hl>for)\s*\((?:[^;:(){}?]|::)+:(?!:)/);
since('cpp', 'c++11', 'enum-class', 'scoped enumerations (enum class)', /\benum\s+(?:class|struct)\b/);
since('cpp', 'c++11', 'enum-base', 'enumerations with a fixed underlying type', /\benum\s+(?:class\s+|struct\s+)?[A-Za-z_]\w*\s*:\s*(?!:)[A-Za-z_]/);
since('cpp', 'c++11', 'alias-declaration', 'alias declarations (using X = ...)', /\busing\s+(?!namespace\b)[A-Za-z_]\w*\s*=(?!=)/);
since('cpp', 'c++11', 'override-final', 'override / final specifiers', /\)\s*(?:const\s*)?(?:volatile\s*)?(?:&&?\s*)?(?:noexcept\b(?:\s*\([^()]*\))?\s*)?(?<hl>override|final)\b/);
since('cpp', 'c++11', 'final-class', 'final classes', /\b(?:class|struct)\s+[A-Za-z_]\w*\s+(?<hl>final)\b/);
since('cpp', 'c++11', 'defaulted-deleted', '= default / = delete', /\)\s*(?:const\s*)?(?:noexcept\s*)?=\s*(?<hl>default|delete)\b/);
since('cpp', 'c++11', 'variadic-template', 'variadic templates', /\b(?:typename|class|sizeof)\s*\.\.\./);
since('cpp', 'c++11', 'user-defined-literal', 'user-defined literal operators', /\boperator\s*""\s*[A-Za-z_]/);
since('cpp', 'c++11', 'inline-namespace', 'inline namespaces', /\binline\s+namespace\b/);
since('cpp', 'c++11', 'trailing-return', 'trailing return types', /\bauto\s+(?:[A-Za-z_]\w*\s*::\s*)*[A-Za-z_]\w*\s*\((?:[^;{}()]|\([^()]*\))*\)\s*(?:const\s*)?(?:&&?\s*)?(?:noexcept\s*)?->/);
since('cpp', 'c++11', 'explicit-conversion', 'explicit conversion operators', /\bexplicit\s+operator\b/);
since('cpp', 'c++11', 'func', '__func__', /\b__func__\b/);
since('cpp', 'c++11', 'va-args', 'variadic macros (__VA_ARGS__)', /\b__VA_ARGS__\b/, { gnu: true });
since('cpp', 'c++11', 'pragma-operator', '_Pragma operator', /\b_Pragma\s*\(/);
since('cpp', 'c++11', 'long-long', 'long long', /\blong\s+long\b/, { gnu: true });

// C++14
since('cpp', 'c++14', 'generic-lambda', 'generic lambdas (auto parameters)', re`${LAMBDA_START}\[[\w\s&=*,.]*\]\s*\((?:[^()]*,)?\s*(?:const\s+)?(?<hl>auto)\b`);
since('cpp', 'c++14', 'lambda-init-capture', 'lambda init-captures', re`${LAMBDA_START}\[(?:\s*[&=]?\s*[\w.]*\s*,)*\s*&?\s*(?<hl>[A-Za-z_]\w*\s*=)(?!=)`);
since('cpp', 'c++14', 'decltype-auto', 'decltype(auto)', /\bdecltype\s*\(\s*auto\s*\)/);
since('cpp', 'c++14', 'return-type-deduction', 'function return type deduction', /\bauto\s+(?:[A-Za-z_]\w*\s*::\s*)*[A-Za-z_]\w*\s*\((?:[^;{}()]|\([^()]*\))*\)\s*(?:const\s*)?(?:&&?\s*)?(?:noexcept\s*)?(?:(?:override|final)\s*)*\{/);

// C++17
since('cpp', 'c++17', 'structured-binding', 'structured bindings', /\bauto\s*(?:&&?)?\s*\[/);
since('cpp', 'c++17', 'if-constexpr', 'if constexpr', /\bif\s+constexpr\b/);
since('cpp', 'c++17', 'selection-init', 'if / switch with initializer', /\b(?<hl>if|switch)\s*(?:constexpr\s*)?\((?:[^;(){}]|\([^()]*\))*;/);
since('cpp', 'c++17', 'nested-namespace', 'nested namespace definitions', /\bnamespace\s+[A-Za-z_]\w*(?:\s*::\s*(?:inline\s+)?[A-Za-z_]\w*)+\s*\{/);
since('cpp', 'c++17', 'inline-variable', 'inline variables', /\binline\s+(?:(?:static|constexpr|const|thread_local)\s+)*(?!namespace\b)[A-Za-z_][\w:]*(?:\s*<[^;{}()]*>)?[\s*&]+(?!operator\b)[A-Za-z_]\w*\s*(?:=(?!=)|\{[^{}]*\}\s*;)/);
since('cpp', 'c++17', 'fold-expression', 'fold expressions', /\(\s*\.\.\.\s*(?:&&|\|\||<<|>>|[-+*/%^&|,])|(?:\|\||<<|[-+/%^|])\s*\.\.\.\s*\)|(?:&&|\|\||<<|>>|[-+*/%^&|])\s*\.\.\.\s*(?:&&|\|\||<<|>>|[-+*/%^&|])/);
since('cpp', 'c++17', 'template-auto', 'template <auto> parameters', /\btemplate\s*<\s*(?:[^<>;{}]*,\s*)?auto\b/);
since('cpp', 'c++17', 'static-assert-no-message', 'static_assert without a message', /\bstatic_assert\s*\((?:[^,;()]|\([^()]*\))*\)\s*;/);
since('cpp', 'c++17', 'lambda-star-this', 'lambda capture of *this', re`${LAMBDA_START}\[[^\[\]]*?(?<hl>\*\s*this)\b`);
since('cpp', 'c++17', 'attribute-using', 'attribute namespaces ([[using ns: ...]])', /\[\[\s*using\b/);

// C++20
since('cpp', 'c++20', 'concept', 'concepts', /\bconcept\b/);
since('cpp', 'c++20', 'requires', 'requires clauses and expressions', /\brequires\b/);
since('cpp', 'c++20', 'coroutines', 'coroutines (co_await / co_yield / co_return)', /\bco_(?:await|yield|return)\b/);
since('cpp', 'c++20', 'three-way-comparison', 'three-way comparison operator <=>', /<=>/);
since('cpp', 'c++20', 'consteval', 'consteval', /\bconsteval\b/);
since('cpp', 'c++20', 'constinit', 'constinit', /\bconstinit\b/);
since('cpp', 'c++20', 'designated-initializers', 'designated initializers', /[{,]\s*(?<hl>\.[A-Za-z_]\w*)\s*(?:=(?!=)|\{)/, { gnu: true });
since('cpp', 'c++20', 'char8-t', 'char8_t', /\bchar8_t\b/);
since('cpp', 'c++20', 'module-declaration', 'modules (module declarations)', /^[ \t]*(?:export[ \t]+)?(?<hl>module)\b[ \t]*(?:[A-Za-z_][\w.]*)?[ \t]*(?::[ \t]*[A-Za-z_][\w.]*)?[ \t]*;/m);
since('cpp', 'c++20', 'module-import', 'modules (import declarations)', /^[ \t]*(?:export[ \t]+)?(?<hl>import)[ \t]+(?:[A-Za-z_][\w.]*|:[ \t]*[\w.]+|<[^>\n]*>|"[^"\n]*")[ \t]*;/m);
since('cpp', 'c++20', 'using-enum', 'using enum', /\busing\s+enum\b/);
since('cpp', 'c++20', 'template-lambda', 'lambdas with template parameter lists', re`${LAMBDA_START}\[[\w\s&=*,.]*\]\s*(?<hl><)`);
since('cpp', 'c++20', 'explicit-bool', 'conditional explicit (explicit(bool))', /\bexplicit\s*\(/);
since('cpp', 'c++20', 'abbreviated-template', 'abbreviated function templates (auto parameters)', /\b(?!(?:if|while|for|switch|return|sizeof|catch|decltype|alignof|alignas|noexcept|static_assert|requires|typeid)\b)[A-Za-z_]\w*\s*\((?:[^(){};]*,)?\s*(?:const\s+)?(?<hl>auto)\b\s*(?:&&?|\*)?\s*(?:\.\.\.\s*)?[A-Za-z_]\w*\s*(?:=[^,(){};]*)?[,)]/);
since('cpp', 'c++20', 'va-opt', '__VA_OPT__', /\b__VA_OPT__\b/);
since('cpp', 'c++20', 'nested-inline-namespace', 'nested inline namespaces (a::inline b)', /\bnamespace\s+[A-Za-z_]\w*(?:\s*::\s*(?:inline\s+)?[A-Za-z_]\w*)*\s*::\s*inline\b/);
since('cpp', 'c++20', 'range-for-init', 'range-based for with initializer', /\b(?<hl>for)\s*\((?:[^;(){}]|\([^()]*\))*;(?:[^;:(){}?]|::)+:(?!:)/);
since('cpp', 'c++20', 'lambda-pack-init-capture', 'pack expansion in lambda init-captures', re`${LAMBDA_START}\[[^\[\]]*?(?<hl>\.\.\.\s*[A-Za-z_]\w*\s*=)`);

// C++23
since('cpp', 'c++23', 'if-consteval', 'if consteval', /\bif\s*!?\s*consteval\b/);
since('cpp', 'c++23', 'deducing-this', 'explicit object parameters (deducing this)', /\(\s*(?<hl>this)\s+(?!(?:and|or|bitand|bitor|xor|not_eq)\b)[A-Za-z_]/);
since('cpp', 'c++23', 'multidimensional-subscript', 'multidimensional subscript operator', /\boperator\s*\[\s*\]\s*\((?:[^(),;<]|\([^()]*\))*,/);
since('cpp', 'c++23', 'static-call-operator', 'static operator() and operator[]', /\bstatic\b[^;{}()]*\boperator\s*(?:\(\s*\)|\[\s*\])\s*\(/);
since('cpp', 'c++23', 'elifdef', '#elifdef / #elifndef', /^[ \t]*#[ \t]*(?<hl>elifn?def)\b/m);
since('cpp', 'c++23', 'warning-directive', '#warning', /^[ \t]*#[ \t]*(?<hl>warning)\b/m, { gnu: true });
since('cpp', 'c++23', 'decay-copy', 'auto(x) decay-copy', /(?:[=(,!?]|\breturn)\s*(?<hl>auto)\s*[({](?!\s*[*&)}])/);
since('cpp', 'c++23', 'import-std', 'standard library modules (import std;)', /^[ \t]*(?:export[ \t]+)?(?<hl>import)[ \t]+std(?:\.compat)?[ \t]*;/m);

// C++26
since('cpp', 'c++26', 'embed', '#embed', /^[ \t]*#[ \t]*(?<hl>embed)\b/m);
since('cpp', 'c++26', 'delete-reason', '= delete("reason")', /=\s*delete\s*\(/);
since('cpp', 'c++26', 'pack-indexing', 'pack indexing', /\.\.\.\s*\[/);
since('cpp', 'c++26', 'reflection', 'static reflection (^^ and [: :])', /\^\^|\[:(?!:)/);
since('cpp', 'c++26', 'contracts', 'contracts (pre, post, contract_assert)', /\bcontract_assert\b|\)\s*(?:const\s*)?(?:noexcept\s*)?(?<hl>pre|post)\s*\(/);

// Removed C++ language features
removed('cpp', 'c++17', 'register', 'register storage class', /\bregister\b/);
removed('cpp', 'c++17', 'dynamic-exception-spec', 'dynamic exception specifications throw(T)', /\)\s*(?:const\s*)?(?:volatile\s*)?(?<hl>throw\s*\(\s*[^)\s][^)]*\))/);
removed('cpp', 'c++20', 'throw-empty', 'throw() exception specifications', /\)\s*(?:const\s*)?(?:volatile\s*)?(?<hl>throw\s*\(\s*\))/);

// C++ literal tokens
const isNumber = (t: LexToken): boolean => t.kind === 'number' && t.number !== undefined;
const suffixIs = (t: LexToken, test: RegExp): boolean => isNumber(t) && test.test(t.number!.suffix);

token('cpp', 'c++11', 'raw-string', 'raw string literals', (t) => t.kind === 'string' && t.raw);
token('cpp', 'c++11', 'unicode-string', 'u8"", u"" and U"" string literals', (t) => t.kind === 'string' && /^(?:u8|u|U)R?$/.test(t.prefix));
token('cpp', 'c++11', 'unicode-char', "u'' and U'' character literals", (t) => t.kind === 'char' && (t.prefix === 'u' || t.prefix === 'U'));
token('cpp', 'c++17', 'u8-char', "u8'' character literals", (t) => t.kind === 'char' && t.prefix === 'u8');
token('cpp', 'c++11', 'udl-string', 'user-defined literals', (t) => (t.kind === 'string' || t.kind === 'char') && t.suffix.startsWith('_'));
token('cpp', 'c++14', 'string-literal-s', 'std::string literals ("..."s)', (t) => t.kind === 'string' && t.suffix === 's');
token('cpp', 'c++17', 'string-view-literal', 'std::string_view literals ("..."sv)', (t) => t.kind === 'string' && t.suffix === 'sv');
token('cpp', 'c++11', 'udl-number', 'user-defined literals', (t) => suffixIs(t, /^_/));
token('cpp', 'c++14', 'chrono-literal', 'std::chrono and std::complex literals (10ms, 2i)', (t) => suffixIs(t, /^(?:h|min|s|ms|us|ns|i|if|il)$/));
token('cpp', 'c++20', 'chrono-date-literal', 'std::chrono day and year literals (1d, 2024y)', (t) => suffixIs(t, /^[dy]$/) && !t.number!.isFloat);
token('cpp', 'c++14', 'binary-literal', 'binary literals', (t) => isNumber(t) && t.number!.binary, { gnu: true });
token('cpp', 'c++14', 'digit-separator', 'digit separators', (t) => isNumber(t) && t.number!.digitSeparator);
token('cpp', 'c++17', 'hex-float', 'hexadecimal floating literals', (t) => isNumber(t) && t.number!.hexFloat, { gnu: true });
token('cpp', 'c++11', 'long-long-literal', 'long long integer literals (LL)', (t) => suffixIs(t, /^(?:[uU](?:ll|LL)|(?:ll|LL)[uU]?)$/), { gnu: true });
token('cpp', 'c++23', 'size-literal', 'size_t literals (uz, z)', (t) => suffixIs(t, /^(?:[uU][zZ]|[zZ][uU]?)$/));
token('cpp', 'c++23', 'extended-float-literal', 'extended floating-point literals (f16, f32, f64, f128, bf16)', (t) => suffixIs(t, /^(?:[fF](?:16|32|64|128)|(?:bf|BF)16)$/));

// C++ attributes: the generic `[[...]]` syntax plus specific standard attributes.
add({ id: 'cpp11.attributes', lang: 'cpp', kind: 'since', std: 'c++11', name: 'attribute syntax [[...]]', lookup: { table: 'attr', key: '*' } });

// C++ library
tableRules('cpp', 'since', 'std', CPP_LIBRARY, (k) => `std::${k}`);
tableRules('cpp', 'removed', 'std', CPP_LIBRARY_REMOVED, (k) => `std::${k}`);
tableRules('cpp', 'since', 'header', CPP_HEADERS, (k) => `<${k}>`);
tableRules('cpp', 'removed', 'header', CPP_HEADERS_REMOVED, (k) => `<${k}>`);
tableRules('cpp', 'removed', 'func', CPP_FUNCTIONS_REMOVED, (k) => `${k}()`);
tableRules('cpp', 'since', 'member', CPP_MEMBERS, (k) => `.${k}()`);
tableRules('cpp', 'since', 'attr', CPP_ATTRIBUTES, (k) => `[[${k}]]`);
add({
  id: 'cpp14.lib.alias-traits', lang: 'cpp', kind: 'since', std: 'c++14', name: 'std::*_t alias templates',
  lookup: {
    table: 'std',
    test: /^(?:enable_if|conditional|decay|remove_(?:const|volatile|cv|reference|pointer|extent|all_extents)|add_(?:const|volatile|cv|pointer|lvalue_reference|rvalue_reference)|common_type|underlying_type|result_of|make_signed|make_unsigned|aligned_storage|aligned_union|tuple_element)_t$/,
  },
});
add({
  id: 'cpp17.lib.variable-traits', lang: 'cpp', kind: 'since', std: 'c++17', name: 'std::*_v variable templates',
  lookup: { table: 'std', test: /^[a-z_]+_v$/ },
});

// ---------------------------------------------------------------------------------------------
// C language features

// C99
since('c', 'c99', 'inline', 'inline functions', /\binline\b/, { gnu: true });
since('c', 'c99', 'restrict', 'restrict', /\brestrict\b/);
since('c', 'c99', 'bool-type', '_Bool', /\b_Bool\b/);
since('c', 'c99', 'stdbool', 'bool (<stdbool.h>)', /\bbool\b/, { unless: /\btypedef\b[^;]*\bbool\s*;|#[ \t]*define[ \t]+bool\b/ });
since('c', 'c99', 'complex', '_Complex / _Imaginary', /\b_(?:Complex|Imaginary)\b/);
since('c', 'c99', 'long-long', 'long long', /\blong\s+long\b/, { gnu: true });
since('c', 'c99', 'designated-initializers', 'designated initializers', /[{,]\s*(?<hl>(?:\.[A-Za-z_]\w*|\[[^\[\]\n]+\])+)\s*=(?!=)/, { gnu: true });
since('c', 'c99', 'compound-literal', 'compound literals', /\(\s*(?:const\s+)?(?:(?:struct|union)\s+[A-Za-z_]\w*|(?:unsigned|signed)(?:\s+(?:int|char|short|long))?|int|char|short|long|float|double|_Bool|bool|[A-Za-z_]\w*_t)(?:\s*\*)*(?:\s*\[\s*\w*\s*\])?\s*\)\s*\{/, { gnu: true });
since('c', 'c99', 'for-declaration', 'declarations in for-loop initializers', /\b(?<hl>for)\s*\(\s*(?:const\s+)?(?:(?:unsigned|signed)(?:\s+(?:int|char|short|long))?|int|char|short|long|float|double|_Bool|bool|[A-Za-z_]\w*_t|struct\s+[A-Za-z_]\w*|enum\s+[A-Za-z_]\w*)\b[\s*]*[A-Za-z_]\w*\s*[=;,[]/, { gnu: true });
since('c', 'c99', 'func', '__func__', /\b__func__\b/, { gnu: true });
since('c', 'c99', 'va-args', 'variadic macros (__VA_ARGS__)', /\b__VA_ARGS__\b/, { gnu: true });
since('c', 'c99', 'pragma-operator', '_Pragma operator', /\b_Pragma\s*\(/);
since('c', 'c99', 'static-array-parameter', 'static in array parameter declarations', /\[\s*(?:(?:const|restrict|volatile)\s+)*static\b/);
since('c', 'c99', 'stdint-types', '<stdint.h> integer types', /\bu?int(?:_least|_fast)?(?:8|16|32|64)_t\b|\bu?int(?:ptr|max)_t\b/, { unless: /\btypedef\b[^;]*\bu?int(?:8|16|32|64)_t\s*;/ });

// C11
for (const keyword of ['_Static_assert', '_Alignas', '_Alignof', '_Noreturn', '_Thread_local', '_Atomic', '_Generic']) {
  since('c', 'c11', keyword.toLowerCase(), keyword, new RegExp(`\\b${keyword}\\b`));
}
since('c', 'c11', 'static-assert', 'static_assert', /\bstatic_assert\b/);
since('c', 'c11', 'alignas', 'alignas / alignof', /\balign(?:as|of)\b/);
// Not inside vendor attribute lists such as __declspec(noreturn) or __attribute__((noreturn, cold)).
since('c', 'c11', 'noreturn', 'noreturn', /(?<![(,]\s*)\bnoreturn\b/);
since('c', 'c11', 'thread-local', 'thread_local', /\bthread_local\b/);
since('c', 'c11', 'char16-char32', 'char16_t / char32_t', /\bchar(?:16|32)_t\b/);

// C23
since('c', 'c23', 'nullptr', 'nullptr', /\bnullptr(?:_t)?\b/);
since('c', 'c23', 'constexpr', 'constexpr', /\bconstexpr\b/);
since('c', 'c23', 'typeof', 'typeof', /\btypeof\b/, { gnu: true });
since('c', 'c23', 'typeof-unqual', 'typeof_unqual', /\btypeof_unqual\b/);
since('c', 'c23', 'auto', 'auto type inference', /\b(?<hl>auto)\s+(?!(?:int|char|short|long|float|double|signed|unsigned|_Bool|bool|const|volatile|struct|union|enum|static|register|extern|_Complex|_Atomic|restrict)\b)[A-Za-z_]\w*\s*=(?!=)/);
since('c', 'c23', 'embed', '#embed', /^[ \t]*#[ \t]*(?<hl>embed)\b/m);
since('c', 'c23', 'elifdef', '#elifdef / #elifndef', /^[ \t]*#[ \t]*(?<hl>elifn?def)\b/m);
since('c', 'c23', 'warning-directive', '#warning', /^[ \t]*#[ \t]*(?<hl>warning)\b/m, { gnu: true });
since('c', 'c23', 'va-opt', '__VA_OPT__', /\b__VA_OPT__\b/);
since('c', 'c23', 'bitint', '_BitInt(N)', /\b_BitInt\s*\(/);
since('c', 'c23', 'decimal-float', '_Decimal32 / _Decimal64 / _Decimal128', /\b_Decimal(?:32|64|128)\b/);
since('c', 'c23', 'static-assert-no-message', 'static_assert without a message', /\b(?:_Static_assert|static_assert)\s*\((?:[^,;()]|\([^()]*\))*\)\s*;/);
since('c', 'c23', 'enum-base', 'enumerations with a fixed underlying type', /\benum\s+[A-Za-z_]\w*\s*:\s*(?!:)[A-Za-z_]/);
since('c', 'c23', 'empty-initializer', 'empty initializers (= {})', /=\s*(?<hl>\{\s*\})/, { gnu: true });
since('c', 'c23', 'char8-t', 'char8_t', /\bchar8_t\b/);
add({ id: 'c23.attributes', lang: 'c', kind: 'since', std: 'c23', name: 'attributes [[...]]', lookup: { table: 'attr', key: '*' } });
add({
  id: 'c23.func.unreachable', lang: 'c', kind: 'since', std: 'c23', name: 'unreachable()', generated: true,
  lookup: { table: 'func', key: 'unreachable' }, unless: /#[ \t]*define[ \t]+unreachable\b/,
});

// Removed C features
removed('c', 'c23', 'atomic-var-init', 'ATOMIC_VAR_INIT', /\bATOMIC_VAR_INIT\b/);

// C literal tokens
token('c', 'c99', 'line-comment', '// comments', (t) => t.kind === 'lineComment', { gnu: true });
token('c', 'c99', 'hex-float', 'hexadecimal floating literals', (t) => isNumber(t) && t.number!.hexFloat);
token('c', 'c99', 'long-long-literal', 'long long integer literals (LL)', (t) => suffixIs(t, /^(?:[uU](?:ll|LL)|(?:ll|LL)[uU]?)$/), { gnu: true });
token('c', 'c11', 'unicode-string', 'u8"", u"" and U"" string literals', (t) => t.kind === 'string' && /^(?:u8|u|U)$/.test(t.prefix));
token('c', 'c11', 'unicode-char', "u'' and U'' character literals", (t) => t.kind === 'char' && (t.prefix === 'u' || t.prefix === 'U'));
token('c', 'c23', 'u8-char', "u8'' character literals", (t) => t.kind === 'char' && t.prefix === 'u8');
token('c', 'c23', 'binary-literal', 'binary literals', (t) => isNumber(t) && t.number!.binary, { gnu: true });
token('c', 'c23', 'digit-separator', 'digit separators', (t) => isNumber(t) && t.number!.digitSeparator);
token('c', 'c23', 'bitint-literal', '_BitInt literals (wb, uwb)', (t) => suffixIs(t, /^(?:[uU]?(?:wb|WB)|(?:wb|WB)[uU])$/));
token('c', 'c23', 'decimal-float-literal', 'decimal floating literals (df, dd, dl)', (t) => isNumber(t) && t.number!.isFloat && /^(?:df|dd|dl|DF|DD|DL)$/.test(t.number!.suffix));

// C library
tableRules('c', 'since', 'header', C_HEADERS, (k) => `<${k}>`);
tableRules('c', 'since', 'func', C_FUNCTIONS, (k) => `${k}()`);
tableRules('c', 'removed', 'func', C_FUNCTIONS_REMOVED, (k) => `${k}()`);

// ---------------------------------------------------------------------------------------------
// Indexes

export interface RuleSet {
  readonly regex: readonly FeatureRule[];
  readonly tokens: readonly FeatureRule[];
  /** Exact-key lookups per table. */
  readonly lookups: ReadonlyMap<LookupTable, ReadonlyMap<string, readonly FeatureRule[]>>;
  /** Pattern-based lookups per table. */
  readonly lookupTests: ReadonlyMap<LookupTable, readonly FeatureRule[]>;
}

function buildRuleSet(lang: Lang): RuleSet {
  const regex: FeatureRule[] = [];
  const tokens: FeatureRule[] = [];
  const lookups = new Map<LookupTable, Map<string, FeatureRule[]>>();
  const lookupTests = new Map<LookupTable, FeatureRule[]>();
  for (const rule of RULES) {
    if (rule.lang !== lang) {
      continue;
    }
    if (rule.pattern) {
      regex.push(rule);
    } else if (rule.token) {
      tokens.push(rule);
    } else if (rule.lookup?.key !== undefined) {
      let table = lookups.get(rule.lookup.table);
      if (!table) {
        lookups.set(rule.lookup.table, (table = new Map()));
      }
      const list = table.get(rule.lookup.key) ?? [];
      list.push(rule);
      table.set(rule.lookup.key, list);
    } else if (rule.lookup?.test) {
      const list = lookupTests.get(rule.lookup.table) ?? [];
      list.push(rule);
      lookupTests.set(rule.lookup.table, list);
    }
  }
  return { regex, tokens, lookups, lookupTests };
}

const RULE_SETS: Readonly<Record<Lang, RuleSet>> = { c: buildRuleSet('c'), cpp: buildRuleSet('cpp') };
const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function ruleSet(lang: Lang): RuleSet {
  return RULE_SETS[lang];
}

export function allRules(): readonly FeatureRule[] {
  return RULES;
}

export function getRule(id: string): FeatureRule | undefined {
  return RULES_BY_ID.get(id);
}
