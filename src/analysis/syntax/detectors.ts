/**
 * Syntax-tree detectors and name facts (tree-sitter).
 *
 * Each language has one combined query. Captures named `d<N>` are candidates for detector N and
 * are refined by its `find` function; captures named `c.<kind>` collect facts about names
 * (declarations, using-directives, namespace aliases), `r.<kind>` are names that may refer to
 * the standard library, and `unparsed` marks parse errors and opaque macro bodies.
 *
 * This module only depends on the web-tree-sitter types, not on its runtime.
 */

import type { Node, QueryCapture } from 'web-tree-sitter';
import type { Lang } from '../../standards';
import { C_FUNCTIONS } from '../tables';
import type { NameSegment, OffsetRange, StdRef, SyntaxFacts, SyntaxFinding } from './facts';

type Found = OffsetRange | readonly OffsetRange[] | undefined;

export interface Detector {
  /** Rule id, see rules.ts. */
  readonly id: string;
  /** Query patterns; `@d` marks the node handed to `find`. */
  readonly query: string;
  /** Highlight range(s) for a captured node, or undefined when it is not a finding. Default: the node. */
  readonly find?: (node: Node, ctx: NameContext) => Found;
}

/** Names declared in the file, and the scopes of `using namespace std...` directives. */
export interface NameContext {
  readonly variables: ReadonlySet<string>;
  readonly fields: ReadonlySet<string>;
  readonly types: ReadonlySet<string>;
  readonly functions: ReadonlySet<string>;
  readonly macros: ReadonlySet<string>;
  readonly enumerators: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
  /** True when `name` is declared anywhere in the file (so it is not the standard library's). */
  declared(name: string): boolean;
  /** Paths below `std` an unqualified `name` at `offset` may refer to (one per active directive). */
  stdCandidates(name: string, offset: number): NameSegment[][];
  /** Target of a namespace alias used at `offset`, as a path below `std` (`fs` → `filesystem`). */
  stdAlias(name: string, offset: number): readonly string[] | undefined;
}

const range = (n: Node): OffsetRange => [n.startIndex, n.endIndex];

function childOfType(node: Node, ...types: string[]): Node | undefined {
  return node.children.find((c) => types.includes(c.type)) ?? undefined;
}

/** Range of the first token (keyword) of a node, e.g. `for` of a for loop. */
function firstToken(node: Node): OffsetRange {
  const first = node.child(0);
  return first ? range(first) : range(node);
}

/** The `auto` keyword of a placeholder type (`auto`, `const auto&`, `Concept auto`), not `decltype(auto)`. */
function autoOf(placeholder: Node): OffsetRange | undefined {
  const auto = childOfType(placeholder, 'auto');
  return auto ? range(auto) : undefined;
}

const DECLARATOR_WRAPPERS = new Set([
  'pointer_declarator', 'reference_declarator', 'array_declarator', 'init_declarator', 'parenthesized_declarator',
  'attributed_declarator', 'variadic_declarator', 'abstract_pointer_declarator', 'abstract_reference_declarator',
]);

/** Innermost name of a declarator and whether it declares a function. */
function declaredName(declarator: Node): { name: Node; isFunction: boolean } | undefined {
  let node: Node | null = declarator;
  let isFunction = false;
  for (let depth = 0; node && depth < 32; depth++) {
    if (node.type === 'function_declarator') {
      isFunction = true;
      node = node.childForFieldName('declarator');
    } else if (DECLARATOR_WRAPPERS.has(node.type)) {
      node = node.childForFieldName('declarator') ?? node.namedChildren.find((c) => c !== null && !c.type.startsWith('type_qualifier')) ?? null;
    } else if (node.type === 'identifier' || node.type === 'field_identifier' || node.type === 'type_identifier') {
      return { name: node, isFunction };
    } else {
      return undefined;
    }
  }
  return undefined;
}

/** True when a declarator declares a function (whatever its name: identifier, operator, destructor...). */
function declaresFunction(declarator: Node): boolean {
  let node: Node | null = declarator;
  for (let depth = 0; node && depth < 32; depth++) {
    if (node.type === 'function_declarator') {
      return true;
    }
    node = DECLARATOR_WRAPPERS.has(node.type) ? (node.childForFieldName('declarator') ?? node.namedChild(0)) : null;
  }
  return false;
}

/** True when the declaration `decl` declares a variable (not a function) called `name`. */
function declaresVariable(decl: Node, name: string): boolean {
  return decl.childrenForFieldName('declarator').some((d) => {
    const declared = d ? declaredName(d) : undefined;
    return declared !== undefined && !declared.isFunction && declared.name.text === name;
  });
}

/** True when `name` is a parameter or variable visible at `node`, i.e. declared before it in an enclosing scope. */
function isVariableInScope(name: string, node: Node): boolean {
  const before = node.startIndex;
  for (let scope = node.parent; scope; scope = scope.parent) {
    switch (scope.type) {
      case 'parameter_list':
      case 'compound_statement':
      case 'translation_unit':
        for (const child of scope.namedChildren) {
          if (!child || child.startIndex >= before) {
            break;
          }
          if ((child.type === 'declaration' || child.type === 'parameter_declaration') && declaresVariable(child, name)) {
            return true;
          }
          if (scope.type === 'parameter_list' && child.type === 'identifier' && child.text === name) {
            return true; // K&R parameter
          }
        }
        break;
      case 'for_statement': {
        const init = scope.childForFieldName('initializer');
        if (init?.type === 'declaration' && init.endIndex <= before && declaresVariable(init, name)) {
          return true;
        }
        break;
      }
      case 'function_definition': {
        let declarator = scope.childForFieldName('declarator');
        while (declarator && declarator.type !== 'function_declarator' && DECLARATOR_WRAPPERS.has(declarator.type)) {
          declarator = declarator.childForFieldName('declarator');
        }
        const params = declarator?.childForFieldName('parameters');
        if (params && params.endIndex <= before && params.namedChildren.some((p) => p && (p.type === 'identifier' ? p.text === name : declaresVariable(p, name)))) {
          return true;
        }
        break;
      }
    }
  }
  return false;
}

/** Identifiers in an expression, skipping operands of `sizeof`/`alignof` and called names. */
function identifiersIn(node: Node, out: Node[] = []): Node[] {
  if (node.type === 'identifier') {
    out.push(node);
    return out;
  }
  if (node.type === 'sizeof_expression' || node.type === 'alignof_expression' || node.type === 'offsetof_expression') {
    return out;
  }
  for (const child of node.namedChildren) {
    if (!child) {
      continue;
    }
    // Node objects are created on access: compare ids, not references.
    if (node.type === 'call_expression' && child.id === node.childForFieldName('function')?.id) {
      continue;
    }
    identifiersIn(child, out);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// C++

/** Standard class templates whose arguments can be deduced (C++17 CTAD). */
const CTAD_TEMPLATES = new Set([
  'vector', 'deque', 'list', 'forward_list', 'array', 'set', 'multiset', 'map', 'multimap', 'unordered_set',
  'unordered_multiset', 'unordered_map', 'unordered_multimap', 'stack', 'queue', 'priority_queue', 'pair', 'tuple',
  'optional', 'basic_string', 'basic_string_view', 'function', 'shared_ptr', 'weak_ptr', 'lock_guard', 'unique_lock',
  'shared_lock', 'scoped_lock', 'complex', 'valarray', 'reference_wrapper', 'span', 'move_iterator', 'reverse_iterator',
]);

/** Name of the standard class template a type refers to (`std::vector`, or `vector` after `using namespace std`). */
function stdTemplateName(type: Node, ctx: NameContext): string | undefined {
  if (type.type === 'qualified_identifier') {
    const scope = type.childForFieldName('scope');
    const name = type.childForFieldName('name');
    return scope?.type === 'namespace_identifier' && scope.text === 'std' && name?.type === 'type_identifier' ? name.text : undefined;
  }
  if (type.type === 'type_identifier' && !ctx.declared(type.text)) {
    // Directly in `std` (not in a nested namespace such as std::chrono).
    return ctx.stdCandidates(type.text, type.startIndex).some((path) => path.length === 0) ? type.text : undefined;
  }
  return undefined;
}

const LAMBDA_PARAMS = (capture: string): string =>
  `(lambda_expression declarator: (abstract_function_declarator parameters: (parameter_list [
     (parameter_declaration type: (placeholder_type_specifier) ${capture})
     (optional_parameter_declaration type: (placeholder_type_specifier) ${capture})
     (variadic_parameter_declaration type: (placeholder_type_specifier) ${capture})])))`;

const VA_MACROS = `((identifier) @d (#match? @d "^va_(start|arg|end|copy)$"))
  ((type_identifier) @d (#eq? @d "va_list"))`;

const CPP_DETECTORS: readonly Detector[] = [
  {
    id: 'cpp98.c-style-cast',
    query: '(cast_expression) @d',
    find: (node, ctx) => {
      const type = node.childForFieldName('type');
      if (!type) {
        return undefined;
      }
      const inner = type.childForFieldName('type');
      const abstract = type.childForFieldName('declarator');
      // `(void)x` only discards a value.
      if (!abstract && inner?.type === 'primitive_type' && inner.text === 'void') {
        return undefined;
      }
      // `(a) * b` and `(a) - b` with a variable `a` are arithmetic, not casts.
      if (!abstract && inner?.type === 'type_identifier' && !ctx.types.has(inner.text) && (ctx.variables.has(inner.text) || ctx.fields.has(inner.text))) {
        return undefined;
      }
      const close = childOfType(node, ')');
      return [node.startIndex, close ? close.endIndex : type.endIndex];
    },
  },
  { id: 'cpp11.lambda', query: '(lambda_expression captures: (lambda_capture_specifier) @d)' },
  { id: 'cpp14.generic-lambda', query: LAMBDA_PARAMS('@d'), find: (node) => autoOf(node) },
  {
    id: 'cpp14.lambda-init-capture',
    query: '(lambda_capture_initializer) @d',
    find: (node) => [node.startIndex, (childOfType(node, '=') ?? node.childForFieldName('left') ?? node).endIndex],
  },
  {
    id: 'cpp20.template-lambda',
    query: '(lambda_expression template_parameters: (template_parameter_list) @d)',
    find: (node) => [node.startIndex, node.startIndex + 1],
  },
  { id: 'cpp11.range-for', query: '(for_range_loop) @d', find: firstToken },
  { id: 'cpp20.range-for-init', query: '(for_range_loop initializer: (_)) @d', find: firstToken },
  {
    id: 'cpp17.structured-binding',
    query: '(structured_binding_declarator) @d',
    find: (node) => {
      let owner = node.parent;
      while (owner && DECLARATOR_WRAPPERS.has(owner.type)) {
        owner = owner.parent;
      }
      const type = owner?.childForFieldName('type');
      const start = type && type.endIndex <= node.startIndex ? type.startIndex : node.startIndex;
      return [start, node.startIndex + 1];
    },
  },
  {
    id: 'cpp17.selection-init',
    query: `(if_statement condition: (condition_clause initializer: (_))) @d
            (switch_statement condition: (condition_clause initializer: (_))) @d`,
    find: firstToken,
  },
  {
    id: 'cpp17.inline-variable',
    query: `(declaration (storage_class_specifier) @d)
            (field_declaration (storage_class_specifier) @d)`,
    find: (node) => {
      if (node.text !== 'inline') {
        return undefined;
      }
      const declarators = node.parent?.childrenForFieldName('declarator') ?? [];
      return declarators.length > 0 && !declarators.some((d) => d && declaresFunction(d)) ? range(node) : undefined;
    },
  },
  {
    id: 'cpp14.return-type-deduction',
    query: '(function_definition type: (placeholder_type_specifier (auto))) @d',
    find: (node) => {
      let declarator = node.childForFieldName('declarator');
      while (declarator && declarator.type !== 'function_declarator' && DECLARATOR_WRAPPERS.has(declarator.type)) {
        declarator = declarator.childForFieldName('declarator');
      }
      if (!declarator || declarator.type !== 'function_declarator' || childOfType(declarator, 'trailing_return_type')) {
        return undefined;
      }
      const type = node.childForFieldName('type');
      return type ? autoOf(type) : undefined;
    },
  },
  {
    id: 'cpp11.trailing-return',
    query: '(trailing_return_type) @d',
    find: (node) => {
      // Lambdas are reported as lambdas.
      if (node.parent?.type === 'abstract_function_declarator' && node.parent.parent?.type === 'lambda_expression') {
        return undefined;
      }
      return firstToken(node);
    },
  },
  {
    id: 'cpp20.abbreviated-template',
    query: `(function_declarator parameters: (parameter_list [
              (parameter_declaration type: (placeholder_type_specifier) @d)
              (optional_parameter_declaration type: (placeholder_type_specifier) @d)
              (variadic_parameter_declaration type: (placeholder_type_specifier) @d)]))`,
    find: (node) => autoOf(node),
  },
  {
    id: 'cpp98.variadic-function',
    query: `(parameter_list "..." @d)
            ${VA_MACROS}`,
    find: (node) => (node.type === '...' && node.parent?.parent?.type === 'catch_clause' ? undefined : range(node)),
  },
  {
    id: 'cpp17.ctad',
    query: `(declaration type: [(qualified_identifier) (type_identifier)] @d)
            (compound_literal_expression type: [(qualified_identifier) (type_identifier)] @d)`,
    find: (node, ctx) => {
      const name = stdTemplateName(node, ctx);
      if (!name || !CTAD_TEMPLATES.has(name)) {
        return undefined;
      }
      const owner = node.parent!;
      if (owner.type === 'compound_literal_expression') {
        return range(node);
      }
      for (const declarator of owner.childrenForFieldName('declarator')) {
        if (declarator?.type === 'init_declarator') {
          return range(node);
        }
        // `std::lock_guard lock(m);` at block scope parses like a function declaration.
        if (declarator?.type === 'function_declarator' && owner.parent?.type === 'compound_statement') {
          const params = declarator.childForFieldName('parameters')?.namedChildren ?? [];
          const isVariable = (p: Node | null): boolean => {
            const type = p?.childForFieldName('type');
            return p?.type === 'parameter_declaration' && p.namedChildren.length === 1 && type?.type === 'type_identifier' && (ctx.variables.has(type.text) || ctx.fields.has(type.text));
          };
          if (params.length > 0 && params.every(isVariable)) {
            return range(node);
          }
        }
      }
      return undefined;
    },
  },
  {
    id: 'cpp14.relaxed-constexpr',
    query: '(function_definition (type_qualifier) @d body: (compound_statement))',
    find: (node) => {
      if (node.text !== 'constexpr') {
        return undefined;
      }
      // C++11 allows only static_assert, typedefs, using and exactly one return statement.
      let returns = 0;
      for (const stmt of node.parent?.childForFieldName('body')?.namedChildren ?? []) {
        if (!stmt || stmt.type === 'comment' || (stmt.type === 'expression_statement' && stmt.namedChildCount === 0)) {
          continue;
        }
        if (stmt.type === 'return_statement') {
          returns++;
        } else if (!['static_assert_declaration', 'type_definition', 'alias_declaration', 'using_declaration'].includes(stmt.type)) {
          return range(node);
        }
      }
      return returns > 1 ? range(node) : undefined;
    },
  },
];

// ---------------------------------------------------------------------------------------------
// C

const C_DECLARATIONS = new Set(['declaration', 'type_definition', 'struct_specifier', 'union_specifier', 'enum_specifier', 'static_assert_declaration']);
const NEUTRAL = new Set(['comment', 'preproc_def', 'preproc_function_def', 'preproc_call', 'preproc_include']);
const PREPROC_BRANCHES = new Set(['preproc_if', 'preproc_ifdef', 'preproc_else', 'preproc_elif', 'preproc_elifdef']);

/** Block items in order, with the contents of `#if` branches inlined. */
function blockItems(children: readonly (Node | null)[], out: Node[] = []): Node[] {
  for (const child of children) {
    if (!child) {
      continue;
    }
    if (PREPROC_BRANCHES.has(child.type)) {
      const skip = new Set([child.childForFieldName('condition')?.id, child.childForFieldName('name')?.id]);
      blockItems(child.namedChildren.filter((c) => c && !skip.has(c.id)), out);
    } else {
      out.push(child);
    }
  }
  return out;
}

const C_DETECTORS: readonly Detector[] = [
  {
    id: 'c99.mixed-declarations',
    query: '(compound_statement) @d',
    find: (node) => {
      const found: OffsetRange[] = [];
      let afterStatement = false;
      for (const item of blockItems(node.namedChildren)) {
        if (NEUTRAL.has(item.type)) {
          continue;
        }
        if (C_DECLARATIONS.has(item.type)) {
          if (afterStatement) {
            const type = item.childForFieldName('type');
            found.push(type ? range(type) : firstToken(item));
          }
        } else {
          afterStatement = true;
        }
      }
      return found;
    },
  },
  {
    id: 'c99.vla',
    query: '(array_declarator size: (_) @d)',
    find: (node, ctx) => {
      if (node.type === 'number_literal') {
        return undefined;
      }
      const variable = identifiersIn(node).some(
        (id) => ctx.variables.has(id.text) && !ctx.macros.has(id.text) && !ctx.enumerators.has(id.text) && isVariableInScope(id.text, node),
      );
      return variable ? range(node) : undefined;
    },
  },
  {
    id: 'c23.removed.kr-definition',
    query: '(function_definition declarator: (function_declarator parameters: (parameter_list (identifier)) @d))',
  },
  { id: 'c99.for-declaration', query: '(for_statement initializer: (declaration)) @d', find: firstToken },
  {
    id: 'c99.compound-literal',
    query: '(compound_literal_expression) @d',
    find: (node) => [node.startIndex, (childOfType(node, ')') ?? node).endIndex],
  },
  {
    id: 'c89.variadic-function',
    query: `(variadic_parameter) @d
            ${VA_MACROS}`,
  },
];

export const DETECTORS: Readonly<Record<Lang, readonly Detector[]>> = { cpp: CPP_DETECTORS, c: C_DETECTORS };

// ---------------------------------------------------------------------------------------------
// Facts about names

const COMMON_FACTS = `
  (declaration declarator: (_) @c.declarator)
  (parameter_declaration declarator: (_) @c.declarator)
  (function_definition declarator: (_) @c.declarator)
  (field_declaration declarator: (_) @c.field)
  (type_definition declarator: (_) @c.typedef)
  (preproc_def name: (identifier) @c.macro)
  (preproc_function_def name: (identifier) @c.macro)
  (enumerator name: (identifier) @c.enumerator)
  (struct_specifier name: (type_identifier) @c.type)
  (union_specifier name: (type_identifier) @c.type)
  (enum_specifier name: (type_identifier) @c.type)
  (ERROR) @unparsed
  (MISSING) @unparsed
  (preproc_arg) @unparsed
`;

const CPP_FACTS = `
  (optional_parameter_declaration declarator: (_) @c.declarator)
  (variadic_parameter_declaration declarator: (_) @c.declarator)
  (for_range_loop declarator: (_) @c.declarator)
  (class_specifier name: (type_identifier) @c.type)
  (alias_declaration name: (type_identifier) @c.type)
  (type_parameter_declaration (type_identifier) @c.type)
  (variadic_type_parameter_declaration (type_identifier) @c.type)
  (optional_type_parameter_declaration name: (type_identifier) @c.type)
  (concept_definition name: (identifier) @c.type)
  (namespace_definition name: (namespace_identifier) @c.namespace)
  (namespace_definition name: (nested_namespace_specifier (namespace_identifier) @c.namespace))
  (using_declaration) @c.using
  (namespace_alias_definition) @c.alias
  (type_identifier) @r.type
  (call_expression function: (identifier) @r.call)
  (template_function name: (identifier) @r.call)
  (qualified_identifier) @r.qualified
`;

/** Source of the combined query of a language, and the detector of each `d<N>` capture. */
export function buildQuerySource(lang: Lang): string {
  const detectors = DETECTORS[lang]
    .map((d, i) => d.query.replace(/@d\b/g, `@d${i}`))
    .join('\n');
  return `${detectors}\n${COMMON_FACTS}\n${lang === 'cpp' ? CPP_FACTS : ''}`;
}

const SCOPES = new Set(['translation_unit', 'declaration_list', 'compound_statement', 'field_declaration_list']);

/**
 * Names the C headers also declare globally (`uint32_t` from <stdint.h>, `round` from <math.h>):
 * written without `std::`, they usually mean the global C name, which C++ compilers accept in
 * every mode, so they are not resolved to `std::` after `using namespace std`.
 */
const C_GLOBAL_NAMES = new Set(Object.values(C_FUNCTIONS).flat());
const isCGlobalName = (name: string): boolean => C_GLOBAL_NAMES.has(name) || /^u?int(?:_least|_fast)?\d+_t$|^u?int(?:ptr|max)_t$/.test(name);

interface UsingScope {
  readonly start: number;
  readonly end: number;
  /** Path below `std` the directive opens (empty for `using namespace std`), or the full path of a using-declaration. */
  readonly path: readonly string[];
  /** For using-declarations: the name it introduces. */
  readonly name?: string;
}

/** Segments of a qualified name such as `std::chrono::days` or `fs::path` (template arguments dropped). */
function qualifiedSegments(node: Node): { names: Node[]; global: boolean } {
  const names: Node[] = [];
  let global = false;
  let current: Node | null = node;
  for (let depth = 0; current && depth < 32; depth++) {
    if (current.type === 'qualified_identifier') {
      const scope = current.childForFieldName('scope');
      if (!scope) {
        global = names.length === 0;
      } else if (scope.type === 'namespace_identifier') {
        names.push(scope);
      } else if (scope.type === 'template_type') {
        const name = scope.childForFieldName('name');
        if (name) {
          names.push(name);
        }
      } else {
        return { names: [], global };
      }
      current = current.childForFieldName('name');
    } else if (current.type === 'template_type' || current.type === 'template_function') {
      current = current.childForFieldName('name');
    } else if (current.type === 'identifier' || current.type === 'type_identifier' || current.type === 'namespace_identifier') {
      names.push(current);
      current = null;
    } else {
      return { names: [], global };
    }
  }
  return { names, global };
}

/** True when `node` is the last segment of a qualified name, possibly with template arguments (`std::optional<int>`). */
function isQualifiedSegment(node: Node): boolean {
  let parent = node.parent;
  if (parent && (parent.type === 'template_type' || parent.type === 'template_function')) {
    parent = parent.parent;
  }
  return parent?.type === 'qualified_identifier';
}

function enclosingScope(node: Node): Node | undefined {
  let scope = node.parent;
  while (scope && !SCOPES.has(scope.type)) {
    scope = scope.parent;
  }
  return scope ?? undefined;
}

function pathOf(text: string): string[] {
  return text.replace(/\s+/g, '').replace(/^::/, '').split('::').filter(Boolean);
}

/**
 * Turns the captures of the combined query into facts. Returns undefined when the parse is too
 * broken to be useful (more than half of the text in error).
 */
export function collectFacts(lang: Lang, textLength: number, captures: readonly QueryCapture[]): SyntaxFacts | undefined {
  const detectors = DETECTORS[lang];
  const variables = new Set<string>();
  const fields = new Set<string>();
  const types = new Set<string>();
  const functions = new Set<string>();
  const macros = new Set<string>();
  const enumerators = new Set<string>();
  const namespaces = new Set<string>();
  const usings: UsingScope[] = [];
  const aliases: Array<{ start: number; end: number; name: string; path: string[] }> = [];
  const unparsed: Array<[number, number]> = [];
  const candidates: QueryCapture[] = [];
  const refs: QueryCapture[] = [];

  for (const capture of captures) {
    const { name, node } = capture;
    switch (name) {
      case 'c.declarator':
      case 'c.field': {
        const declared = declaredName(node);
        if (declared) {
          const target = declared.isFunction ? functions : name === 'c.field' ? fields : variables;
          target.add(declared.name.text);
        }
        break;
      }
      case 'c.typedef': {
        const declared = declaredName(node);
        if (declared) {
          types.add(declared.name.text);
        }
        break;
      }
      case 'c.type':
        types.add(node.text);
        break;
      case 'c.macro':
        macros.add(node.text);
        break;
      case 'c.enumerator':
        enumerators.add(node.text);
        break;
      case 'c.namespace':
        namespaces.add(node.text);
        break;
      case 'c.using': {
        const target = node.namedChildren.find((c) => c && (c.type === 'identifier' || c.type === 'qualified_identifier'));
        const scope = enclosingScope(node);
        if (!target || !scope) {
          break;
        }
        const path = pathOf(target.text);
        if (path[0] !== 'std') {
          break;
        }
        const isDirective = node.children.some((c) => c?.type === 'namespace');
        if (isDirective) {
          usings.push({ start: node.endIndex, end: scope.endIndex, path: path.slice(1) });
        } else if (path.length >= 2) {
          usings.push({ start: node.endIndex, end: scope.endIndex, path: path.slice(1), name: path[path.length - 1] });
        }
        break;
      }
      case 'c.alias': {
        const aliasName = node.childForFieldName('name');
        const target = node.namedChildren.find((c) => c && c.id !== aliasName?.id && c.type !== 'comment');
        const scope = enclosingScope(node);
        const path = target ? pathOf(target.text) : [];
        if (aliasName && scope && path[0] === 'std') {
          aliases.push({ start: node.endIndex, end: scope.endIndex, name: aliasName.text, path: path.slice(1) });
        }
        break;
      }
      case 'unparsed': {
        const target = node.isMissing && node.parent ? node.parent : node;
        unparsed.push([target.startIndex, Math.max(target.endIndex, target.startIndex + 1)]);
        break;
      }
      default:
        if (name.startsWith('r.')) {
          refs.push(capture);
        } else if (name.startsWith('d')) {
          candidates.push(capture);
        }
    }
  }

  unparsed.sort((a, b) => a[0] - b[0]);
  let errorLength = 0;
  let reach = 0;
  for (const [start, end] of unparsed) {
    errorLength += Math.max(0, end - Math.max(start, reach));
    reach = Math.max(reach, end);
  }
  if (errorLength * 2 > textLength) {
    return undefined;
  }

  const implied = (path: readonly string[]): NameSegment[] => path.map((name) => ({ name, end: -1 }));
  const ctx: NameContext = {
    variables, fields, types, functions, macros, enumerators, namespaces,
    declared: (name) =>
      types.has(name) || functions.has(name) || variables.has(name) || fields.has(name) || macros.has(name) || namespaces.has(name) || enumerators.has(name),
    stdCandidates: (name, offset) => {
      const result: NameSegment[][] = [];
      for (const u of usings) {
        if (offset < u.start || offset >= u.end) {
          continue;
        }
        if (u.name === undefined) {
          result.push(implied(u.path));
        } else if (u.name === name) {
          result.push(implied(u.path.slice(0, -1)));
        }
      }
      return result;
    },
    stdAlias: (name, offset) => aliases.find((a) => a.name === name && offset >= a.start && offset < a.end)?.path,
  };

  const findings: SyntaxFinding[] = [];
  for (const { name, node } of candidates) {
    const detector = detectors[Number(name.slice(1))];
    if (!detector) {
      continue;
    }
    const found = detector.find ? detector.find(node, ctx) : range(node);
    if (!found) {
      continue;
    }
    const list = (typeof found[0] === 'number' ? [found] : found) as readonly OffsetRange[];
    for (const [start, end] of list) {
      findings.push({ ruleId: detector.id, start, end });
    }
  }

  const stdRefs: StdRef[] = [];
  if (usings.length > 0 || aliases.length > 0) {
    for (const { name, node } of refs) {
      if (name === 'r.qualified') {
        if (node.parent?.type === 'qualified_identifier') {
          continue; // only the outermost name of a chain
        }
        const { names, global } = qualifiedSegments(node);
        if (global || names.length < 2 || names[0].text === 'std') {
          continue;
        }
        const own = names.map((n) => ({ name: n.text, end: n.endIndex }));
        const alias = ctx.stdAlias(names[0].text, node.startIndex);
        if (alias) {
          // `fs::path` with `namespace fs = std::filesystem`: the alias stands for its last segment.
          const target = alias.length > 0 ? [...implied(alias.slice(0, -1)), { name: alias[alias.length - 1], end: own[0].end }] : [];
          stdRefs.push({ start: node.startIndex, segments: [...target, ...own.slice(1)] });
        } else if (!namespaces.has(names[0].text)) {
          for (const prefix of ctx.stdCandidates(names[0].text, node.startIndex)) {
            stdRefs.push({ start: node.startIndex, segments: [...prefix, ...own] });
          }
        }
        continue;
      }
      // An unqualified type or called function (`std::optional<int>` is handled as a qualified name).
      if (isQualifiedSegment(node) || ctx.declared(node.text) || isCGlobalName(node.text)) {
        continue;
      }
      for (const prefix of ctx.stdCandidates(node.text, node.startIndex)) {
        stdRefs.push({ start: node.startIndex, segments: [...prefix, { name: node.text, end: node.endIndex }] });
      }
    }
  }

  return {
    findings,
    covered: new Set(detectors.map((d) => d.id)),
    unparsed,
    declaredFunctions: new Set([...functions, ...macros]),
    stdRefs,
  };
}
