# C/C++ Standards Manager

**English** | [简体中文](README.zh-CN.md)

Choose the target C/C++ language standard in VS Code, **enable or disable** individual standards, and get diagnostics for language and library features that the selected standards do not support (or have removed).

Supported standards:

| Language | Standards |
| --- | --- |
| C++ | C++98, C++03, C++11, C++14, C++17, C++20, C++23, C++26 |
| C | C89, C99, C11, C17, C23 |

## Features

### Choose the target standard, enable/disable standards

- **Activity bar view "C/C++ Standards"**: every standard has a checkbox — checked means enabled, unchecked means disabled. Click an enabled standard to make it the target (🎯 icon). The checkboxes in the **Options** group toggle common settings directly.
- **Status bar**: when a C/C++ file is open, the current target (e.g. `C++17`) is shown at the bottom right; click it to switch. Hover to see the enabled and disabled standards.
- **Command palette** (prefix `C/C++ Standards:`):
  - `Select C++ Target Standard...` / `Select C Target Standard...`
  - `Enable/Disable C++ Standards...` / `Enable/Disable C Standards...` (multi-select list)
  - `Check All C/C++ Files in Workspace`
  - `Sync Target Standards to IntelliSense`
  - `Copy Compiler Flag...`

Rules:

- A disabled standard cannot be the target; selecting one asks whether to enable it first.
- When the current target is disabled, the target moves to the nearest enabled standard (older ones preferred).
- At least one standard must stay enabled.

### Feature diagnostics

The extension scans C/C++ files for features that the checked standards do not support — for example `std::optional`, structured bindings or `if constexpr` with a C++14 target, or the removed `register` and `std::auto_ptr` with a C++17 target. More than 1000 rules cover:

- Language features: `auto`, lambdas, `constexpr`, concepts, coroutines, modules, `<=>`, designated initializers, deducing this, `#embed`, static reflection, ...
- Literals: raw strings, binary literals, digit separators, `10ms`, `"..."sv`, `10uz`, ...
- Standard library: `std::` names, headers, attributes such as `[[nodiscard]]`, container member functions, ...
- C: `//` comments (C89), `for (int i...)`, `_Generic`, `nullptr`/`constexpr`/`typeof` (C23), C99/C11/C23 library functions, ...
- Removed features: `register`, dynamic exception specifications, `std::auto_ptr`, `gets()`, `<codecvt>`, ...
- Core features that every standard has (since C++98 / C89; **reported only when you disable them**): macro constants `#define NAME value`, function-like macros, `#undef`, `goto`, `union`, C-style casts `(int)x`, `reinterpret_cast`/`const_cast`, RTTI, exceptions, `new`/`delete`, `using namespace`, `typedef`, `NULL`, unscoped enums, C-style variadic functions, inline assembly, octal literals, `malloc`/`free`, `strcpy`/`sprintf`, `atoi`, `setjmp`/`longjmp`, `rand`, `exit`/`abort`/`system`, `signal`, and `<stdio.h>`-style headers in C++

**Two checking modes** (setting `cppStandards.diagnostics.mode`, or the option "Code must compile with every enabled standard" in the view):

| Mode | Meaning |
| --- | --- |
| `target` (default) | Check against the target standard only: report features newer than the target and features the target removed. |
| `allEnabled` | The code must compile with **every enabled standard**. For example, with C++11–C++20 enabled, `std::make_unique` is reported (C++11 lacks it) and so is `register` (removed in C++17). Useful for libraries that support a range of standards. |

**Preprocessor-aware**: `#if`/`#ifdef`/`#elif` are evaluated for each checked standard, so version-guarded code like this is not reported:

```cpp
#if __cplusplus >= 201703L
std::optional<int> value;   // only checked against C++17 and newer
#else
int* value;
#endif
```

Supported: `__cplusplus`, `__STDC_VERSION__`, `_MSVC_LANG`, feature-test macros (`__cpp_concepts`, `__cpp_lib_optional`, ...), `__has_include(<header>)`, `__has_cpp_attribute`, `#if 0`.

**Quick fixes** (light bulb):

- Change the target to the standard the feature needs (enabling it first if necessary)
- In `allEnabled` mode: disable standards that are too old or too new
- Suppress on this line: inserts `// cppstd-ignore-next-line <rule>` (`/* */` in C files)
- Allow the feature in this workspace / stop forbidding it
- Configure rules... (opens the rule settings panel at this rule)

**Suppression comments**:

```cpp
std::optional<int> a;  // cppstd-ignore            (suppresses every rule on this line)
// cppstd-ignore-next-line cpp17.structured-binding (suppresses one rule on the next line)
auto [x, y] = point;
// cppstd-ignore-next-line cpp20.*                  (prefix match)
template <class T> concept Small = sizeof(T) < 8;
```

### Single Rule view

The **Single Rule** view, below **Standards** in the "C/C++ Standards" activity bar container, lists every feature against the selected standard, each with a checkbox: **checked = allowed, unchecked = disabled (its uses are reported)**.

```
▾ C++                      C++20 · 1 customized
  ▾ ✓ C++98                Available in every standard · 25/26 allowed
    ▸ Language features    14/14 allowed
    ▾ Preprocessor         2/3 allowed
        ☑ #undef
        ☑ function-like macros (#define F(x) ...)
        ☐ macro constants (#define NAME value)   cpp98.macro-constant · customized
  ▸ ✓ C++11 … C++20        Available in C++20
  ▸ ⊘ C++23, C++26          Not available in C++20
  ▸ 🗑 Removed in C++14/17/20  Removed; not available in C++20
  ▸ ⟲ Removed in C++23/26   Still available in C++20
▾ C                        C17
  …
```

For example, if the target is C++20 but your project does not allow `#define` for constants: under **C++98 → Preprocessor**, uncheck **macro constants (#define NAME value)**. From then on every `#define MAX_SIZE 100` is reported; check it again to undo.

- Rules are grouped by the standard that introduced (or removed) the feature, then by category (language features, literals, standard library, headers, attributes, preprocessor). Each group shows how it relates to the selected standard and how many of its rules are allowed.
- Unchecking a feature the selected standard **supports** stores `"forbid"`; checking a feature it **does not support or has removed** stores `"allow"`; returning to the standard's behaviour deletes the entry. Rules you never changed therefore keep following the standard when you change the target later.
- Group buttons: Allow All / Disable All / Reset All to Default (asks for confirmation above 20 rules). Rule context menu: Allow, Disable, Reset to Default, Set Severity..., Configure Rules... (opens the rule in the rule settings panel), Copy Rule ID.
- Title bar: 🔍 Find Rule... (search by name or id, such as `#define` or `goto`, and jump to the rule in the view), a filter that shows only the features of the selected standard, and a button that opens the rule settings panel.

The view and the rule settings panel below read and write the same setting, `cppStandards.rules`, so changes in one show up in the other.

### Rule settings panel

After choosing a standard, you can compare every rule with it and decide how each one is handled. Open the panel from:

- Command palette: `C/C++ Standards: Configure Rules...`
- The ⚙ button in the title bar of the "C/C++ Standards" views or on a language group
- The button at the top right of the target standard picker, the status bar tooltip, or a diagnostic's quick fixes

At the top, choose the language, what to compare against (the target standard / every enabled standard) and the target standard. Below, all rules are listed in groups such as "Introduced in C++17" and "Removed in C++17". Each row shows:

| Column | Meaning |
| --- | --- |
| Compared with | Whether the feature is available in the selected standard: ✓ supported, ✕ not available (e.g. "Not available in C++14"), ⚠ removed |
| Setting | **Default**: follow the selected standard; **Allow**: never report (e.g. your compiler supports it as an extension); **Forbid**: report every use even if the standard supports it (e.g. your coding guidelines ban coroutines) |
| Severity | Severity for this rule only; defaults to the global setting |
| Result | Whether the rule is reported with the current settings |

- Search by name or rule id; filter by category (language features, literals, standard library, headers, attributes, preprocessor) and status (reported, not supported by the standard, customized, ...).
- Every group and the toolbar have "Allow all / Forbid all / Reset all", which apply to the rules currently shown; changes to more than 20 rules ask for confirmation.
- By default only the groups the selected standard does not support are expanded; group headers show how many of their rules are customized.

Rule settings are stored in `cppStandards.rules` (workspace settings) and can also be edited directly:

```jsonc
"cppStandards.rules": {
  "cpp20.coroutines": "forbid",                                   // forbid coroutines
  "cpp17.lib.*": "allow",                                          // allow every C++17 library name (prefix match)
  "cpp17.lib.any": "default",                                      // but std::any still follows the standard
  "cpp17.removed.register": { "state": "forbid", "severity": "error" }
}
```

Exact rule ids take precedence over prefixes, and longer prefixes over shorter ones; state and severity are resolved independently. "Forbid" wins over GNU extensions and the "Report removed features" switch. The old setting `cppStandards.diagnostics.ignoredRules` still works (it means "allow") but is deprecated.

### Sync to IntelliSense and builds

- **Microsoft C/C++ extension** (on by default): writes `C_Cpp.default.cppStandard` / `C_Cpp.default.cStandard` when the target changes. If `c_cpp_properties.json` sets `cppStandard` explicitly, you are offered to change it to `${default}`. (That extension does not know C++26 yet; `c++23` is synced instead.)
- **clangd** (enable `cppStandards.sync.clangd`): maintains a managed block in `.clangd` that adds `-std=` per file type. Turning the setting off removes the block; content outside it is left alone.
- **tasks.json / launch.json**: use `${command:cppStandards.cppFlag}` or `${command:cppStandards.cFlag}` to get the compiler flag for the current target:

```jsonc
{
  "label": "build",
  "type": "shell",
  "command": "g++",
  "args": ["${command:cppStandards.cppFlag}", "-o", "app", "main.cpp"]
}
```

With `cppStandards.compilerFlagStyle` set to `gcc` this returns `-std=c++17`, with `msvc` it returns `/std:c++17`; with `cppStandards.gnuExtensions` on it returns `-std=gnu++17`.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `cppStandards.cpp.target` | `c++17` | C++ target standard |
| `cppStandards.cpp.disabled` | `[]` | Disabled C++ standards |
| `cppStandards.c.target` | `c17` | C target standard |
| `cppStandards.c.disabled` | `[]` | Disabled C standards |
| `cppStandards.gnuExtensions` | `false` | Use GNU dialects and do not report features GNU extensions accept |
| `cppStandards.diagnostics.enabled` | `true` | Report feature diagnostics |
| `cppStandards.diagnostics.mode` | `target` | `target` or `allEnabled` |
| `cppStandards.diagnostics.severity` | `warning` | `error` / `warning` / `information` / `hint` |
| `cppStandards.diagnostics.checkRemovedFeatures` | `true` | Report removed features |
| `cppStandards.diagnostics.evaluatePreprocessor` | `true` | Evaluate `#if` conditions |
| `cppStandards.rules` | `{}` | Per-rule settings (default / allow / forbid, plus severity); see "Rule settings panel" |
| `cppStandards.diagnostics.ignoredRules` | `[]` | Deprecated; use `"allow"` in `cppStandards.rules` instead |
| `cppStandards.diagnostics.exclude` | `[]` | Glob patterns of files that are not checked, e.g. `**/third_party/**` |
| `cppStandards.sync.cpptools` | `true` | Sync to the Microsoft C/C++ extension |
| `cppStandards.sync.clangd` | `false` | Sync to `.clangd` |
| `cppStandards.compilerFlagStyle` | `gcc` | Flag syntax returned by `${command:...}` |
| `cppStandards.statusBar.enabled` | `true` | Show the target in the status bar |

When a workspace is open, settings changed by the extension are written to the workspace settings (`.vscode/settings.json`); otherwise to the user settings. Merely opening a project writes nothing.

Rule ids have the form `<standard>.<feature>`, e.g. `cpp17.structured-binding`, `cpp17.lib.optional`, `cpp20.header.format`, `cpp17.removed.register`, `c99.line-comment`. Core features that every standard has use the first standard as prefix, e.g. `cpp98.macro-constant` and `c89.goto` (`"cpp98.*": "forbid"` disables all of them at once). Hover a diagnostic to see its rule id.

## Limitations

Feature detection is based on a lexer and regular expressions, without full C++ semantic analysis:

- Only library names with the `std::` prefix are recognized; `optional` written after `using namespace std;` is not.
- Code produced by macro expansion is not analyzed (macro definitions themselves are checked).
- "Macro constants" only matches object-like macros whose replacement contains a literal (`#define MAX 100`, `#define NAME "x"`), not include guards or macros such as `#define EXPORT __declspec(...)`. "C-style casts" only matches casts to built-in types, `xxx_t` types and pointer/reference types.
- A few constructs may be reported wrongly or missed; use suppression comments, rule settings ("Allow") or `exclude`.

## Development

```bash
npm install
npm run compile            # compile to out/
npm test                   # unit tests (node:test)
npm run test:integration   # integration tests in a downloaded VS Code
npm run package            # build a .vsix (change the publisher in package.json to your own first)
```

Press `F5` ("Run Extension") in VS Code to open an Extension Development Host with the sample files (`samples/`); "Run Extension (Chinese UI)" starts it with the Chinese UI.

Code layout:

- `src/analysis/`: analysis engine independent of VS Code (lexer, preprocessor evaluation, rule tables, analyzer), testable on its own
- `src/standards.ts`: metadata of each standard (compiler flags, macro values, headline features)
- `src/tree.ts`, `src/statusBar.ts`, `src/commands.ts`: user interface
- `src/diagnostics.ts`: diagnostics and quick fixes
- `src/rulesPanel.ts`, `media/rules.js`, `media/rules.css`: rule settings panel; `src/analysis/ruleSettings.ts`: parsing and updating rule settings
- `src/singleRules.ts`: Single Rule view; `src/analysis/ruleGroups.ts`: grouping and on/off logic of the view (independent of VS Code, testable on its own)
- `src/sync.ts`: sync to cpptools / clangd

## License

Licensed under the [Apache License 2.0](LICENSE).
