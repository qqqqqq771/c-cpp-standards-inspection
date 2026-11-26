/**
 * Static metadata about the C and C++ language standards known to the extension.
 * This module has no dependency on the VS Code API so it can be unit tested.
 */

export type Lang = 'c' | 'cpp';
export type FlagStyle = 'gcc' | 'msvc';

export interface StandardInfo {
  /** Identifier used in settings, e.g. `c++17` or `c11`. */
  readonly id: string;
  readonly lang: Lang;
  /** Display name, e.g. `C++17`. */
  readonly label: string;
  /** Year the standard was published. */
  readonly year: number;
  /** Position in chronological order within its language (0 = oldest). */
  readonly rank: number;
  /** Value of `__cplusplus` (C++) or `__STDC_VERSION__` (C); undefined when the macro is not defined. */
  readonly versionMacro?: number;
  /** Value for GCC/Clang `-std=` in ISO mode. */
  readonly gccFlag: string;
  /** Value for GCC/Clang `-std=` with GNU extensions. */
  readonly gnuFlag: string;
  /** MSVC `/std:` switch, when MSVC supports this standard explicitly. */
  readonly msvcFlag?: string;
  /** Value for the Microsoft C/C++ extension (`C_Cpp.default.cppStandard` / `C_Cpp.default.cStandard`). */
  readonly cpptools: string;
  readonly cpptoolsGnu: string;
  /** Headline features (English source strings, translated at runtime). */
  readonly highlights: readonly string[];
}

type StandardDef = Omit<StandardInfo, 'rank' | 'lang'>;

function build(lang: Lang, defs: readonly StandardDef[]): readonly StandardInfo[] {
  return Object.freeze(defs.map((def, rank) => Object.freeze({ ...def, lang, rank })));
}

export const C_STANDARDS = build('c', [
  {
    id: 'c89', label: 'C89', year: 1989,
    gccFlag: 'c89', gnuFlag: 'gnu89', cpptools: 'c89', cpptoolsGnu: 'gnu89',
    highlights: ['Function prototypes', 'const and volatile', 'void and void pointers'],
  },
  {
    id: 'c99', label: 'C99', year: 1999, versionMacro: 199901,
    gccFlag: 'c99', gnuFlag: 'gnu99', cpptools: 'c99', cpptoolsGnu: 'gnu99',
    highlights: [
      '// comments, inline, restrict',
      'long long, _Bool, <stdint.h>',
      'Designated initializers and compound literals',
      'Variable-length arrays',
      'Declarations mixed with code',
    ],
  },
  {
    id: 'c11', label: 'C11', year: 2011, versionMacro: 201112,
    gccFlag: 'c11', gnuFlag: 'gnu11', msvcFlag: '/std:c11', cpptools: 'c11', cpptoolsGnu: 'gnu11',
    highlights: [
      '_Generic and _Static_assert',
      '_Atomic and <stdatomic.h>',
      '<threads.h>',
      '_Alignas, _Alignof, _Noreturn',
      'Anonymous structs and unions',
    ],
  },
  {
    id: 'c17', label: 'C17', year: 2018, versionMacro: 201710,
    gccFlag: 'c17', gnuFlag: 'gnu17', msvcFlag: '/std:c17', cpptools: 'c17', cpptoolsGnu: 'gnu17',
    highlights: ['Defect fixes only, no new features'],
  },
  {
    id: 'c23', label: 'C23', year: 2024, versionMacro: 202311,
    gccFlag: 'c23', gnuFlag: 'gnu23', msvcFlag: '/std:clatest', cpptools: 'c23', cpptoolsGnu: 'gnu23',
    highlights: [
      'nullptr, constexpr, typeof, auto',
      'bool, true and false as keywords',
      '[[attributes]]',
      '#embed, #elifdef, #warning',
      'Binary literals and digit separators',
      '_BitInt(N)',
    ],
  },
]);

export const CPP_STANDARDS = build('cpp', [
  {
    id: 'c++98', label: 'C++98', year: 1998, versionMacro: 199711,
    gccFlag: 'c++98', gnuFlag: 'gnu++98', cpptools: 'c++98', cpptoolsGnu: 'gnu++98',
    highlights: ['Templates and the STL', 'Exceptions, namespaces, RTTI'],
  },
  {
    id: 'c++03', label: 'C++03', year: 2003, versionMacro: 199711,
    gccFlag: 'c++03', gnuFlag: 'gnu++03', cpptools: 'c++03', cpptoolsGnu: 'gnu++03',
    highlights: ['Defect fixes (value-initialization)'],
  },
  {
    id: 'c++11', label: 'C++11', year: 2011, versionMacro: 201103,
    gccFlag: 'c++11', gnuFlag: 'gnu++11', cpptools: 'c++11', cpptoolsGnu: 'gnu++11',
    highlights: [
      'auto, decltype, nullptr',
      'Lambdas and range-based for',
      'Move semantics and rvalue references',
      'constexpr, static_assert, variadic templates',
      'Smart pointers, <thread>, <atomic>, <chrono>',
    ],
  },
  {
    id: 'c++14', label: 'C++14', year: 2014, versionMacro: 201402,
    gccFlag: 'c++14', gnuFlag: 'gnu++14', msvcFlag: '/std:c++14', cpptools: 'c++14', cpptoolsGnu: 'gnu++14',
    highlights: [
      'Generic lambdas',
      'Return type deduction',
      'std::make_unique',
      'Binary literals and digit separators',
    ],
  },
  {
    id: 'c++17', label: 'C++17', year: 2017, versionMacro: 201703,
    gccFlag: 'c++17', gnuFlag: 'gnu++17', msvcFlag: '/std:c++17', cpptools: 'c++17', cpptoolsGnu: 'gnu++17',
    highlights: [
      'Structured bindings',
      'if constexpr, if/switch initializers',
      'std::optional, std::variant, std::any',
      'std::string_view, std::filesystem',
      'Fold expressions, inline variables, nested namespaces',
    ],
  },
  {
    id: 'c++20', label: 'C++20', year: 2020, versionMacro: 202002,
    gccFlag: 'c++20', gnuFlag: 'gnu++20', msvcFlag: '/std:c++20', cpptools: 'c++20', cpptoolsGnu: 'gnu++20',
    highlights: [
      'Concepts and requires',
      'Coroutines',
      'Modules',
      'Ranges, std::span, std::format',
      'Three-way comparison <=>',
      'Designated initializers, consteval',
    ],
  },
  {
    id: 'c++23', label: 'C++23', year: 2023, versionMacro: 202302,
    gccFlag: 'c++23', gnuFlag: 'gnu++23', msvcFlag: '/std:c++latest', cpptools: 'c++23', cpptoolsGnu: 'gnu++23',
    highlights: [
      'std::print, std::expected',
      'Deducing this',
      'if consteval',
      'std::mdspan, std::flat_map',
      'import std;',
    ],
  },
  {
    // The Microsoft C/C++ extension does not know C++26 yet; C++23 is the closest IntelliSense mode.
    id: 'c++26', label: 'C++26', year: 2026, versionMacro: 202400,
    gccFlag: 'c++2c', gnuFlag: 'gnu++2c', msvcFlag: '/std:c++latest', cpptools: 'c++23', cpptoolsGnu: 'gnu++23',
    highlights: [
      'Static reflection',
      'Contracts',
      '#embed and pack indexing',
      '= delete("reason")',
      'std::inplace_vector, std::execution',
    ],
  },
]);

export const LANGS: readonly Lang[] = ['cpp', 'c'];

export const DEFAULT_TARGET: Readonly<Record<Lang, string>> = { cpp: 'c++17', c: 'c17' };

const BY_ID = new Map<string, StandardInfo>([...C_STANDARDS, ...CPP_STANDARDS].map((s) => [s.id, s]));

export function standardsFor(lang: Lang): readonly StandardInfo[] {
  return lang === 'c' ? C_STANDARDS : CPP_STANDARDS;
}

export function findStandard(id: string | undefined): StandardInfo | undefined {
  return id === undefined ? undefined : BY_ID.get(id.toLowerCase());
}

/** "C++17", "C++11 – C++20" or "C++11, C++17" for the given standards (oldest first). */
export function rangeLabel(stds: readonly StandardInfo[]): string {
  if (stds.length === 0) {
    return '—';
  }
  if (stds.length === 1) {
    return stds[0].label;
  }
  const contiguous = stds[stds.length - 1].rank - stds[0].rank === stds.length - 1;
  return contiguous ? `${stds[0].label} – ${stds[stds.length - 1].label}` : stds.map((s) => s.label).join(', ');
}

export function langLabel(lang: Lang): string {
  return lang === 'c' ? 'C' : 'C++';
}

/** Maps a VS Code language identifier to the language family handled by the extension. */
export function languageIdToLang(languageId: string): Lang | undefined {
  switch (languageId) {
    case 'c':
      return 'c';
    case 'cpp':
    case 'cuda-cpp':
      return 'cpp';
    default:
      return undefined;
  }
}

/**
 * Picks the enabled standard closest to `rank`: the newest one not newer than `rank`,
 * or else the oldest enabled one.
 */
export function nearestEnabled(enabled: readonly StandardInfo[], rank: number): StandardInfo | undefined {
  let below: StandardInfo | undefined;
  let above: StandardInfo | undefined;
  for (const std of enabled) {
    if (std.rank <= rank) {
      if (!below || std.rank > below.rank) {
        below = std;
      }
    } else if (!above || std.rank < above.rank) {
      above = std;
    }
  }
  return below ?? above;
}

/** Returns the compiler switch selecting `std`, or undefined when the compiler has no such switch. */
export function compilerFlag(std: StandardInfo, style: FlagStyle, gnu: boolean): string | undefined {
  if (style === 'msvc') {
    return std.msvcFlag;
  }
  return `-std=${gnu ? std.gnuFlag : std.gccFlag}`;
}

/** Value written to the Microsoft C/C++ extension settings for `std`. */
export function cpptoolsValue(std: StandardInfo, gnu: boolean): string {
  return gnu ? std.cpptoolsGnu : std.cpptools;
}
