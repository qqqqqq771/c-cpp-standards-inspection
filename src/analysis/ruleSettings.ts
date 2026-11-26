/**
 * Per-rule overrides from the `cppStandards.rules` setting.
 *
 * Each key is a rule id (`cpp20.coroutines`) or a prefix ending in `*` (`cpp20.*`). A value is
 * either a state string or an object with a state and/or a severity:
 *
 *   "cpp20.coroutines": "forbid"
 *   "cpp17.lib.*": "allow"
 *   "cpp17.removed.register": { "state": "forbid", "severity": "error" }
 *
 * States: `default` follows the selected standard, `allow` never reports the rule, `forbid`
 * reports it even when the standard supports the feature. The state and the severity are resolved
 * independently, from the most specific key (exact id, then the longest prefix) to the least.
 */

export type RuleState = 'default' | 'allow' | 'forbid';
export const RULE_STATES: readonly RuleState[] = ['default', 'allow', 'forbid'];

export type SeverityName = 'error' | 'warning' | 'information' | 'hint';
export const SEVERITIES: readonly SeverityName[] = ['error', 'warning', 'information', 'hint'];

/** A severity setting; `default` means "use the global severity". */
export type SeveritySetting = SeverityName | 'default';

export interface RuleEntry {
  readonly state?: RuleState;
  readonly severity?: SeveritySetting;
}

export interface ResolvedRule {
  readonly state: RuleState;
  /** Setting key the state came from; undefined when no key sets it. */
  readonly stateKey?: string;
  /** Severity override; undefined means the global severity applies. */
  readonly severity?: SeverityName;
  readonly severityKey?: string;
}

/** Key reported for entries coming from the deprecated `diagnostics.ignoredRules` setting. */
export const LEGACY_KEY = 'diagnostics.ignoredRules';

export function normalizeEntry(value: unknown): RuleEntry | undefined {
  if (typeof value === 'string') {
    return (RULE_STATES as readonly string[]).includes(value) ? { state: value as RuleState } : undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const state = (RULE_STATES as readonly unknown[]).includes(raw.state) ? (raw.state as RuleState) : undefined;
  const severity = ([...SEVERITIES, 'default'] as readonly unknown[]).includes(raw.severity) ? (raw.severity as SeveritySetting) : undefined;
  if (state === undefined && severity === undefined) {
    return undefined;
  }
  return { ...(state !== undefined && { state }), ...(severity !== undefined && { severity }) };
}

/** Compact JSON form of an entry: a plain string when only the state is set. */
export function serializeEntry(entry: RuleEntry): unknown {
  if (entry.severity === undefined) {
    return entry.state;
  }
  return { ...(entry.state !== undefined && { state: entry.state }), severity: entry.severity };
}

interface Layer {
  readonly exact: ReadonlyMap<string, RuleEntry>;
  /** Prefix entries, longest prefix first. */
  readonly prefixes: ReadonlyArray<{ readonly prefix: string; readonly key: string; readonly entry: RuleEntry }>;
  readonly keyLabel?: string;
}

function buildLayer(entries: Iterable<[string, RuleEntry]>, keyLabel?: string): Layer {
  const exact = new Map<string, RuleEntry>();
  const prefixes: Array<{ prefix: string; key: string; entry: RuleEntry }> = [];
  for (const [key, entry] of entries) {
    if (key.endsWith('*')) {
      prefixes.push({ prefix: key.slice(0, -1), key, entry });
    } else {
      exact.set(key, entry);
    }
  }
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length);
  return { exact, prefixes, keyLabel };
}

export class RuleSettings {
  private constructor(private readonly layers: readonly Layer[]) {}

  static readonly empty = new RuleSettings([]);

  /**
   * @param raw value of `cppStandards.rules`
   * @param legacyAllowed entries of the deprecated `diagnostics.ignoredRules` (treated as `allow`,
   *        with lower priority than any `cppStandards.rules` entry)
   */
  static parse(raw: unknown, legacyAllowed: readonly string[] = []): RuleSettings {
    const entries: Array<[string, RuleEntry]> = [];
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        const entry = normalizeEntry(value);
        if (entry && key.trim() !== '') {
          entries.push([key.trim(), entry]);
        }
      }
    }
    const layers = [buildLayer(entries)];
    if (legacyAllowed.length > 0) {
      layers.push(buildLayer(legacyAllowed.map((id): [string, RuleEntry] => [id, { state: 'allow' }]), LEGACY_KEY));
    }
    return new RuleSettings(layers);
  }

  get isEmpty(): boolean {
    return this.layers.every((l) => l.exact.size === 0 && l.prefixes.length === 0);
  }

  resolve(id: string): ResolvedRule {
    let state: RuleState | undefined;
    let stateKey: string | undefined;
    let severity: SeveritySetting | undefined;
    let severityKey: string | undefined;
    const consider = (entry: RuleEntry, key: string): void => {
      if (state === undefined && entry.state !== undefined) {
        state = entry.state;
        stateKey = key;
      }
      if (severity === undefined && entry.severity !== undefined) {
        severity = entry.severity;
        severityKey = key;
      }
    };
    for (const layer of this.layers) {
      const exact = layer.exact.get(id);
      if (exact) {
        consider(exact, layer.keyLabel ?? id);
      }
      for (const p of layer.prefixes) {
        if (id.startsWith(p.prefix)) {
          consider(p.entry, layer.keyLabel ?? p.key);
        }
      }
      if (state !== undefined && severity !== undefined) {
        break;
      }
    }
    return {
      state: state ?? 'default',
      stateKey,
      severity: severity === 'default' ? undefined : severity,
      severityKey: severity === undefined ? undefined : severityKey,
    };
  }
}

export interface RuleChange {
  readonly state?: RuleState;
  readonly severity?: SeveritySetting;
}

export interface UpdateOptions {
  /** Entries of the deprecated `diagnostics.ignoredRules` setting. */
  readonly legacyAllowed?: readonly string[];
  /**
   * Entries a rule inherits when it has no entry of its own in `raw`: prefix keys, and exact keys
   * set at other settings levels. Defaults to the prefix keys of `raw`.
   */
  readonly inherited?: Readonly<Record<string, unknown>>;
}

/**
 * Returns a new `cppStandards.rules` object with `change` applied to each exact rule id.
 * Values equal to what the id would inherit anyway are not stored, so resetting a rule removes
 * its entry unless an entry is needed to override an inherited one.
 */
export function updateRuleSettings(
  raw: unknown,
  ids: readonly string[],
  change: RuleChange,
  options: UpdateOptions = {},
): Record<string, unknown> {
  const result: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
  const inherited = RuleSettings.parse(
    options.inherited ?? Object.fromEntries(Object.entries(result).filter(([key]) => key.endsWith('*'))),
    options.legacyAllowed,
  );
  for (const id of ids) {
    const current = normalizeEntry(result[id]) ?? {};
    let state = current.state;
    let severity = current.severity;
    const base = inherited.resolve(id);
    if (change.state !== undefined) {
      state = change.state === base.state ? undefined : change.state;
    }
    if (change.severity !== undefined) {
      severity = change.severity === (base.severity ?? 'default') ? undefined : change.severity;
    }
    if (state === undefined && severity === undefined) {
      delete result[id];
    } else {
      result[id] = serializeEntry({ ...(state !== undefined && { state }), ...(severity !== undefined && { severity }) });
    }
  }
  return result;
}
