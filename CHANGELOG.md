# Changelog

## Unreleased

- New **Single Rule** view in the activity bar container, below *Standards*: every rule of each language, grouped by the standard that introduced or removed the feature (and by category), with a checkbox per rule — checked is allowed, unchecked is reported. Unchecking a feature the selected standard supports stores `forbid`; checking one it does not support stores `allow`; returning to the standard's behaviour removes the entry. Bulk *Allow All / Disable All / Reset All* per group or category, per-rule severity, *Find Rule...* (reveals the rule in the view) and a filter that shows only the features of the selected standard.
- New core rules for features every standard has (`cpp98.*`, `c89.*`), never reported unless forbidden: macro constants (`#define NAME value`), function-like macros, `#undef`, `goto`, unions, C-style casts, `reinterpret_cast`, `const_cast`, RTTI, exceptions, `new`/`delete`, `using namespace`, `typedef`, `NULL`, unscoped enums, C-style variadic functions, inline assembly, octal literals, `malloc`/`free`, unbounded string functions, `atoi`, `setjmp`/`longjmp`, `rand`, `exit`/`abort`/`system`, `signal`, and C headers in C++.
- The analyzer skips rules that the checked standards cannot report and that are not forbidden (about 3× faster on large files; results are unchanged).

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
