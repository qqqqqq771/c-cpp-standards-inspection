/**
 * Results of the syntax-tree pass (tree-sitter), consumed by the analyzer. Plain data: the tree
 * itself never leaves the syntax engine, so the analyzer stays a pure, synchronous function.
 */

export type OffsetRange = readonly [start: number, end: number];

export interface SyntaxFinding {
  readonly ruleId: string;
  readonly start: number;
  readonly end: number;
}

/** One segment of a resolved name; `end` is -1 for segments implied by a using-directive or alias. */
export interface NameSegment {
  readonly name: string;
  readonly end: number;
}

/**
 * A name that refers to the standard library without being spelled `std::...`, e.g. `optional<int>`
 * after `using namespace std;` or `fs::path` after `namespace fs = std::filesystem;`.
 */
export interface StdRef {
  readonly start: number;
  /** Path below `std`, e.g. `chrono`, `days`. */
  readonly segments: readonly NameSegment[];
}

export interface SyntaxFacts {
  /** Findings of the syntax detectors (not yet filtered by rule state or standard). */
  readonly findings: readonly SyntaxFinding[];
  /**
   * Rules whose regular expression is replaced by a syntax detector. Their regex still runs in
   * `unparsed` regions, where the tree cannot be trusted.
   */
  readonly covered: ReadonlySet<string>;
  /** Parse errors and text the parser keeps opaque (macro bodies), sorted by start. */
  readonly unparsed: readonly OffsetRange[];
  /** Functions and macros declared in the file; calls to them are not library calls. */
  readonly declaredFunctions: ReadonlySet<string>;
  readonly stdRefs: readonly StdRef[];
}
