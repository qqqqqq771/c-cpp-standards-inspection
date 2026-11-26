/**
 * Configuration this extension writes into C/C++ toolchains (clangd, the Microsoft C/C++
 * extension's clang-tidy, CMake Tools). The extension never runs a compiler itself: it keeps the
 * tools' own configuration in step with the selected standards and rules, and the tools report.
 *
 * Pure functions, no dependency on the VS Code API.
 */

import type { Lang, StandardInfo } from './standards';
import { compilerFlag } from './standards';

// ---------------------------------------------------------------------------------------------
// Conformance warnings

/**
 * Clang warning groups that report features newer than a standard, by the standard that
 * introduced the features. Only groups that exist in current Clang releases are listed.
 */
const COMPAT_WARNINGS: Readonly<Record<Lang, ReadonlyArray<readonly [std: string, flags: readonly string[]]>>> = {
  cpp: [
    ['c++11', ['-Wc++98-compat']],
    ['c++14', ['-Wpre-c++14-compat']],
    ['c++17', ['-Wpre-c++17-compat']],
    ['c++20', ['-Wpre-c++20-compat']],
    ['c++23', ['-Wpre-c++23-compat']],
    ['c++26', ['-Wpre-c++26-compat']],
  ],
  c: [
    ['c99', ['-Wdeclaration-after-statement', '-Wvla']],
    ['c11', ['-Wpre-c11-compat']],
    ['c23', ['-Wpre-c2x-compat']],
  ],
};

/**
 * Compiler flags that make Clang report code the selected standards do not accept:
 * `-pedantic` (ISO mode only, GNU dialects accept extensions on purpose) and, when the code must
 * also compile with older standards (`oldest` before `target`), the compatibility warnings for
 * every standard in between.
 */
export function conformanceFlags(lang: Lang, target: StandardInfo, oldest: StandardInfo, gnu: boolean, rankOf: (id: string) => number): string[] {
  const flags = gnu ? [] : ['-pedantic'];
  for (const [std, groupFlags] of COMPAT_WARNINGS[lang]) {
    const rank = rankOf(std);
    if (rank > oldest.rank && rank <= target.rank) {
      flags.push(...groupFlags);
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------------------------
// clang-tidy

/**
 * Closest clang-tidy checks for the core rules (features of every standard that a project may
 * forbid). Old and new names are both listed where clang-tidy renamed a check.
 */
export const CLANG_TIDY_CHECKS: Readonly<Record<string, readonly string[]>> = {
  'cpp98.macro-constant': ['cppcoreguidelines-macro-usage'],
  'cpp98.function-like-macro': ['cppcoreguidelines-macro-usage'],
  'cpp98.goto': ['cppcoreguidelines-avoid-goto'],
  'cpp98.union': ['cppcoreguidelines-pro-type-union-access'],
  'cpp98.variadic-function': ['cert-dcl50-cpp', 'cppcoreguidelines-pro-type-vararg'],
  'cpp98.asm': ['portability-no-assembler', 'hicpp-no-assembler'],
  'cpp98.dynamic-memory': ['cppcoreguidelines-no-malloc'],
  'cpp98.unbounded-string': ['clang-analyzer-security.insecureAPI.strcpy'],
  'cpp98.ato-conversion': ['cert-err34-c'],
  'cpp98.setjmp': ['cert-err52-cpp'],
  'cpp98.rand': ['cert-msc50-cpp'],
  'cpp98.process-control': ['cert-env33-c'],
  'cpp98.c-style-cast': ['google-readability-casting', 'cppcoreguidelines-pro-type-cstyle-cast'],
  'cpp98.reinterpret-cast': ['cppcoreguidelines-pro-type-reinterpret-cast'],
  'cpp98.const-cast': ['cppcoreguidelines-pro-type-const-cast'],
  'cpp98.using-namespace': ['google-build-using-namespace'],
  'cpp98.typedef': ['modernize-use-using'],
  'cpp98.null-macro': ['modernize-use-nullptr'],
  'cpp98.unscoped-enum': ['cppcoreguidelines-use-enum-class'],
  'cpp98.c-header': ['modernize-deprecated-headers'],
  'c89.asm': ['portability-no-assembler', 'hicpp-no-assembler'],
  'c89.unbounded-string': ['clang-analyzer-security.insecureAPI.strcpy'],
  'c89.ato-conversion': ['cert-err34-c'],
  'c89.rand': ['cert-msc30-c'],
  'c89.process-control': ['cert-env33-c'],
};

/** clang-tidy checks for the forbidden rules of `lang`, sorted and without duplicates. */
export function clangTidyChecks(lang: Lang, isForbidden: (ruleId: string) => boolean): string[] {
  const prefix = lang === 'cpp' ? 'cpp98.' : 'c89.';
  const checks = new Set<string>();
  for (const [ruleId, ruleChecks] of Object.entries(CLANG_TIDY_CHECKS)) {
    if (ruleId.startsWith(prefix) && isForbidden(ruleId)) {
      ruleChecks.forEach((c) => checks.add(c));
    }
  }
  return [...checks].sort();
}

// ---------------------------------------------------------------------------------------------
// clangd

export const CLANGD_BEGIN = '# >>> cpp-standards: managed by the C/C++ Standards extension, changes inside this block are overwritten >>>';
export const CLANGD_END = '# <<< cpp-standards <<<';
export const CLANGD_BLOCK_RE = /^# >>> cpp-standards:.*\r?\n[\s\S]*?^# <<< cpp-standards <<<[^\n]*(?:\r?\n|$)/m;

const PATH_MATCH: Readonly<Record<Lang, string>> = {
  c: String.raw`.*\.(c|i)`,
  cpp: String.raw`.*\.(cc|cp|cpp|cxx|c\+\+|ii|cppm|ixx|hh|hpp|hxx|h\+\+|ipp|tpp|txx|inl)`,
};

export interface ClangdLanguage {
  readonly lang: Lang;
  readonly target: StandardInfo;
  /** Extra compiler flags (conformance warnings). */
  readonly flags?: readonly string[];
  /** clang-tidy checks to add. */
  readonly checks?: readonly string[];
}

const yamlList = (items: readonly string[]): string => `[${items.map((i) => `'${i.replace(/'/g, "''")}'`).join(', ')}]`;

/** The managed `.clangd` block: one fragment per language with its `-std=` flag, warnings and checks. */
export function clangdBlock(languages: readonly ClangdLanguage[], gnu: boolean): string {
  const lines = [CLANGD_BEGIN];
  for (const lang of ['c', 'cpp'] as const) {
    const entry = languages.find((l) => l.lang === lang);
    if (!entry) {
      continue;
    }
    lines.push('---', 'If:', `  PathMatch: '${PATH_MATCH[lang]}'`, 'CompileFlags:', "  Remove: ['-std=*']");
    lines.push(`  Add: ${yamlList([compilerFlag(entry.target, 'gcc', gnu)!, ...(entry.flags ?? [])])}`);
    if (entry.checks && entry.checks.length > 0) {
      lines.push('Diagnostics:', '  ClangTidy:', `    Add: ${yamlList(entry.checks)}`);
    }
  }
  lines.push(CLANGD_END);
  return lines.join('\n') + '\n';
}

/** Replaces the managed block in a `.clangd` file, or appends it. */
export function upsertClangdBlock(existing: string, block: string): string {
  if (CLANGD_BLOCK_RE.test(existing)) {
    return existing.replace(CLANGD_BLOCK_RE, () => block);
  }
  if (existing.length === 0) {
    return block;
  }
  return existing + (existing.endsWith('\n') ? '' : '\n') + block;
}

export function removeClangdBlock(existing: string): string {
  return existing.replace(CLANGD_BLOCK_RE, '').replace(/\n{3,}$/, '\n\n');
}

// ---------------------------------------------------------------------------------------------
// CMake

/** Value of `CMAKE_CXX_STANDARD` / `CMAKE_C_STANDARD` for a standard (CMake has no 03 or 89). */
export function cmakeStandard(std: StandardInfo): string {
  if (std.lang === 'cpp') {
    return std.id === 'c++03' ? '98' : std.id.slice(3);
  }
  return std.id === 'c89' ? '90' : std.id.slice(1);
}

/** Cache variables for CMake Tools' `cmake.configureSettings`. */
export function cmakeSettings(cpp: StandardInfo | undefined, c: StandardInfo | undefined, gnu: boolean): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const [prefix, std] of [['CMAKE_CXX', cpp], ['CMAKE_C', c]] as const) {
    if (std) {
      settings[`${prefix}_STANDARD`] = cmakeStandard(std);
      settings[`${prefix}_STANDARD_REQUIRED`] = 'ON';
      settings[`${prefix}_EXTENSIONS`] = gnu ? 'ON' : 'OFF';
    }
  }
  return settings;
}

// ---------------------------------------------------------------------------------------------
// Settings shared with other extensions

/**
 * New value of a list setting the extension shares with the user: entries the extension added
 * before (`managed`) and no longer wants are removed, wanted entries are appended, and the
 * user's own entries are kept in place. `managed` is what the extension owns afterwards: entries
 * the user already had are never claimed, so turning the sync off does not remove them.
 */
export function mergeManagedList(
  current: readonly string[],
  managed: readonly string[],
  desired: readonly string[],
): { value: string[]; managed: string[] } {
  const wanted = new Set(desired);
  const previouslyOurs = new Set(managed);
  const kept = current.filter((entry) => !previouslyOurs.has(entry) || wanted.has(entry));
  const users = new Set(current.filter((entry) => !previouslyOurs.has(entry)));
  const value = [...kept];
  for (const entry of desired) {
    if (!value.includes(entry)) {
      value.push(entry);
    }
  }
  return { value, managed: desired.filter((entry) => !users.has(entry)) };
}

/**
 * Same as `mergeManagedList` for an object setting: owned keys the extension no longer wants are
 * removed unless the user changed their value since.
 */
export function mergeManagedObject(
  current: Readonly<Record<string, unknown>>,
  managed: Readonly<Record<string, unknown>>,
  desired: Readonly<Record<string, string>>,
): { value: Record<string, unknown>; managed: Record<string, string> } {
  const value: Record<string, unknown> = { ...current };
  for (const [key, ours] of Object.entries(managed)) {
    if (!(key in desired) && value[key] === ours) {
      delete value[key];
    }
  }
  const owned: Record<string, string> = {};
  for (const [key, wanted] of Object.entries(desired)) {
    // A key that already had the wanted value and was not ours stays the user's.
    if (!(key in managed) && current[key] === wanted) {
      continue;
    }
    value[key] = wanted;
    owned[key] = wanted;
  }
  return { value, managed: owned };
}
