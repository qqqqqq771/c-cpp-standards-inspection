# Changelog

## Unreleased

- New **Single Rule** view in the activity bar container, below *Standards*: every rule of each language, grouped by the standard that introduced or removed the feature (and by category), with a checkbox per rule — checked is allowed, unchecked is reported. Unchecking a feature the selected standard supports stores `forbid`; checking one it does not support stores `allow`; returning to the standard's behaviour removes the entry. Bulk *Allow All / Disable All / Reset All* per group or category, per-rule severity, *Find Rule...* (reveals the rule in the view) and a filter that shows only the features of the selected standard.
- New core rules for features every standard has (`cpp98.*`, `c89.*`), never reported unless forbidden: macro constants (`#define NAME value`), function-like macros, `#undef`, `goto`, unions, C-style casts, `reinterpret_cast`, `const_cast`, RTTI, exceptions, `new`/`delete`, `using namespace`, `typedef`, `NULL`, unscoped enums, C-style variadic functions, inline assembly, octal literals, `malloc`/`free`, unbounded string functions, `atoi`, `setjmp`/`longjmp`, `rand`, `exit`/`abort`/`system`, `signal`, and C headers in C++.
- The analyzer skips rules that the checked standards cannot report and that are not forbidden (about 3× faster on large files; results are unchanged).
- **Syntax trees** (tree-sitter, bundled as WebAssembly; setting `cppStandards.diagnostics.syntaxTree`, on by default):
  - Syntax-aware detection replaces the regular expressions of 17 rules: C-style casts (now to any type, but not `(a) * b`), lambdas (including generic, template and init-capture forms), if/switch initializers, inline variables, return type deduction, trailing return types, abbreviated templates (including constrained `auto`), structured bindings, range-for (with and without initializer), C-style variadic functions, and C `for` declarations and compound literals.
  - Per-file name resolution: names made visible by `using namespace std`, `using std::name` and namespace aliases are checked against the library tables, and functions the file declares itself are no longer taken for library functions.
  - New rules that need the tree: C99 declarations mixed with code (`c99.mixed-declarations`) and variable-length arrays (`c99.vla`), K&R function definitions removed in C23 (`c23.removed.kr-definition`), C++17 class template argument deduction (`cpp17.ctad`) and C++14 relaxed `constexpr` functions (`cpp14.relaxed-constexpr`).
  - Lines that do not parse, macro bodies and files over 1 MB use the regular expressions; without the engine everything works as before.
- **Sync to Toolchain** group under *Options*. The extension only writes configuration; it never runs a compiler.
  - New `cppStandards.sync.cmake`: `CMAKE_CXX_STANDARD` / `CMAKE_C_STANDARD`, `*_STANDARD_REQUIRED` and `*_EXTENSIONS` in CMake Tools' `cmake.configureSettings`.
  - New `cppStandards.sync.conformanceWarnings`: `-pedantic` and Clang's `-Wpre-c++NN-compat` warnings for the enabled standards, in the `.clangd` block and in `C_Cpp.codeAnalysis.clangTidy.args`.
  - New `cppStandards.sync.clangTidyChecks`: the closest clang-tidy check for each forbidden core rule, in the `.clangd` block and in `C_Cpp.codeAnalysis.clangTidy.checks.enabled`.
  - Settings shared with other extensions are merged: only the entries the extension added are changed or removed.

## 0.2.0

- New **Rule Settings** panel (`C/C++ Standards: Configure Rules...`): every rule is listed next to the selected standard (supported / not available / removed) and can be set to *default* (follow the standard), *allow* (never report) or *forbid* (report even when the standard supports it), with an optional per-rule severity. Search, category and status filters, and bulk actions per group or for the filtered rules.
- New setting `cppStandards.rules` (exact rule ids or `prefix.*` keys). `cppStandards.diagnostics.ignoredRules` is deprecated but still honored.
- Quick fixes: "Allow … in this workspace", "Stop forbidding …", "Configure rules...".
- The tree view shows how many rules are customized per language; the target picker and status bar link to the panel.

## 0.1.0

- Target standard selection for C (C89–C23) and C++ (C++98–C++26) from the activity bar view, status bar and command palette.
- Enable/disable individual standards; disabled standards cannot be targeted.
- Feature diagnostics in `target` and `allEnabled` modes, with preprocessor-aware checking, quick fixes and suppression comments.
- Sync to the Microsoft C/C++ extension and to `.clangd`; `${command:cppStandards.cppFlag}` / `${command:cppStandards.cFlag}` for tasks.
- English and Simplified Chinese UI.
