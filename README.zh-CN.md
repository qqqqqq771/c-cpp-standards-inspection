# C/C++ 标准管理器（C/C++ Standards）

[English](README.md) | **简体中文**

在 VS Code 中选择目标 C/C++ 语言标准，**启用或禁用**其中的某些标准，并对所选标准不支持（或已移除）的语言/库特性给出诊断。

支持的标准：

| 语言 | 标准 |
| --- | --- |
| C++ | C++98、C++03、C++11、C++14、C++17、C++20、C++23、C++26 |
| C | C89、C99、C11、C17、C23 |

## 功能

### 选择目标标准、启用/禁用标准

- **活动栏视图「C/C++ 标准」**：每个标准前有复选框——勾选即启用、取消勾选即禁用；单击已启用的标准将其设为目标（🎯 图标）。「选项」分组中的复选框可直接切换常用设置。
- **状态栏**：打开 C/C++ 文件时右下角显示当前目标（如 `C++17`），点击即可切换；悬停可查看已启用/已禁用的标准。
- **命令面板**（`C/C++ 标准:` 前缀）：
  - `选择 C++ 目标标准...` / `选择 C 目标标准...`
  - `启用/禁用 C++ 标准...` / `启用/禁用 C 标准...`（多选列表）
  - `检查工作区中的所有 C/C++ 文件`
  - `将目标标准同步到 IntelliSense`
  - `复制编译器选项...`

规则：

- 被禁用的标准不能被选为目标；选择它时会询问是否先启用。
- 禁用当前目标时，目标会自动改为最接近的已启用标准（优先选更旧的）。
- 至少要保留一个已启用的标准。

### 特性诊断

扩展会扫描 C/C++ 文件，找出所检查的标准不支持的特性，例如在目标为 C++14 时使用 `std::optional`、结构化绑定、`if constexpr`，或在目标为 C++17 时使用已移除的 `register`、`std::auto_ptr`。共 1000 多条规则，涵盖：

- 语言特性：`auto`、lambda、`constexpr`、概念、协程、模块、`<=>`、指派初始化器、deducing this、`#embed`、静态反射……
- 字面量：原始字符串、二进制字面量、数字分隔符、`10ms`、`"..."sv`、`10uz`……
- 标准库：`std::` 名称、头文件、属性 `[[nodiscard]]`、容器成员函数等
- C 语言：`//` 注释（C89）、`for (int i...)`、`_Generic`、`nullptr`/`constexpr`/`typeof`（C23）、C99/C11/C23 库函数……
- 已移除的特性：`register`、动态异常规范、`std::auto_ptr`、`gets()`、`<codecvt>`……
- 所有标准共有的基础特性（C++98 / C89 起就有，**只有被禁用时才报告**）：宏常量 `#define NAME value`、函数式宏、`#undef`、`goto`、`union`、C 风格类型转换 `(int)x`、`reinterpret_cast`/`const_cast`、RTTI、异常、`new`/`delete`、`using namespace`、`typedef`、`NULL`、非限定作用域枚举、C 风格可变参数函数、内联汇编、八进制字面量、`malloc`/`free`、`strcpy`/`sprintf`、`atoi`、`setjmp`/`longjmp`、`rand`、`exit`/`abort`/`system`、`signal`、C++ 中的 `<stdio.h>` 类头文件

**两种检查模式**（设置 `cppStandards.diagnostics.mode`，或在视图「选项」中勾选「代码必须能在所有已启用的标准下编译」）：

| 模式 | 含义 |
| --- | --- |
| `target`（默认） | 只按目标标准检查：报告比目标更新的特性和目标已移除的特性。 |
| `allEnabled` | 代码必须能在**所有已启用标准**下编译。例如启用 C++11–C++20 时，使用 `std::make_unique` 会报告（C++11 不支持），使用 `register` 也会报告（C++17 起已移除）。适合需要兼容一段标准范围的库。 |

**理解预处理条件**：扩展会对每个被检查的标准求值 `#if`/`#ifdef`/`#elif`，因此下面这种按版本保护的代码不会被误报：

```cpp
#if __cplusplus >= 201703L
std::optional<int> value;   // 只会用 C++17 及更新的标准检查
#else
int* value;
#endif
```

支持 `__cplusplus`、`__STDC_VERSION__`、`_MSVC_LANG`、特性测试宏（`__cpp_concepts`、`__cpp_lib_optional` 等）、`__has_include(<header>)`、`__has_cpp_attribute`、`#if 0`。

**语法树**（选项「使用语法树 (tree-sitter)」，默认开启）：每个文件还会用 [tree-sitter](https://tree-sitter.github.io/) 解析（以 WebAssembly 形式内置，无需安装），使检查更精确：

| 内容 | 示例 |
| --- | --- |
| 基于语法识别强制转换、lambda、`if`/`switch` 初始化语句、inline 变量、返回类型推导、尾置返回类型、`auto` 参数、结构化绑定、范围 for 和变参函数；C 中的 `for` 声明和复合字面量 | `if (auto it = std::find_if(b, e, [](int x) { return x > 0; }); it != e)` 被识别为 C++17 的 if 初始化语句，`void f(Sortable auto x)` 被识别为简写函数模板，`(Widget)w` 被识别为 C 风格转换，而 `(a) * b` 不会 |
| 经 `using namespace std`、`using std::name` 和命名空间别名可见的名称 | `using namespace std; optional<int> o;` → `std::optional` 需要 C++17；`namespace fs = std::filesystem; fs::path p;` |
| 文件自己声明的函数不会被当作库函数 | 自己定义了 `round()` 的 C89 文件不会被提示 `round()` 需要 C99 |
| 只能基于语法树检查的规则 | C99 的声明与代码混合和变长数组、K&R 风格函数定义（C23 移除）、C++17 类模板实参推导（`std::vector v{1, 2}`、`std::lock_guard lock(m)`）、C++14 放宽的 `constexpr` 函数 |

语法无法解析的行（正在输入的代码、`if consteval` 或模块等很新的语法、宏定义体）以及超过 1 MB 的文件仍使用模式匹配检查。解析 20 KB 的文件约需 15 ms。若引擎无法加载，所有检查都回退到模式匹配。

**快速修复**（灯泡菜单）：

- 将目标标准改为该特性所需的标准（必要时先启用它）
- `allEnabled` 模式下：禁用过旧/过新的标准
- 在此行屏蔽：插入 `// cppstd-ignore-next-line <规则>`（C 文件使用 `/* */`）
- 在此工作区中允许该特性 / 取消禁止该特性
- 配置规则...（打开规则设置面板并定位到这条规则）

**屏蔽注释**：

```cpp
std::optional<int> a;  // cppstd-ignore            （屏蔽本行全部规则）
// cppstd-ignore-next-line cpp17.structured-binding （只屏蔽下一行的指定规则）
auto [x, y] = point;
// cppstd-ignore-next-line cpp20.*                  （前缀匹配）
template <class T> concept Small = sizeof(T) < 8;
```

### 单项规则（Single Rule）视图

活动栏「C/C++ 标准」中「标准」视图下方的 **单项规则** 视图，把所选标准中的每一项特性逐一列出，每项前有复选框：**勾选 = 允许，取消勾选 = 禁用（使用时报告）**。

```
▾ C++                      C++20 · 自定义 1 条
  ▾ ✓ C++98                所有标准均可用 · 允许 25/26
    ▸ 语言特性              允许 14/14
    ▾ 预处理                允许 2/3
        ☑ #undef
        ☑ 函数式宏（#define F(x) ...）
        ☐ 宏常量（#define NAME value）     cpp98.macro-constant · 已自定义
  ▸ ✓ C++11 … C++20        C++20 可用
  ▸ ⊘ C++23、C++26          C++20 不支持
  ▸ 🗑 C++14/17/20 移除      已移除，C++20 不可用
  ▸ ⟲ C++23/26 移除          C++20 仍可用
▾ C                        C17
  …
```

例如目标标准为 C++20，但项目不允许用 `#define` 定义常量：在「C++98 → 预处理」中取消勾选「宏常量（#define NAME value）」，之后每个 `#define MAX_SIZE 100` 都会被报告；重新勾选即恢复。

- 按引入（或移除）特性的标准分组，组内再按类别（语言特性、字面量、标准库、头文件、属性、预处理）分组；分组描述显示与所选标准的关系和「允许 x/y」。
- 对所选标准**支持**的特性，取消勾选会写入 `"forbid"`；对所选标准**不支持或已移除**的特性，勾选会写入 `"allow"`；恢复到标准的默认行为时会删除该条设置。因此以后更换目标标准，没有改动过的规则仍会自动跟随新标准。
- 分组上的按钮：全部允许 / 全部禁用 / 全部恢复默认（超过 20 条时先确认）；规则右键菜单：允许、禁用、恢复默认、设置严重级别、配置规则（在规则设置面板中打开）、复制规则 ID。
- 标题栏：🔍 查找规则（按名称或 ID 搜索，如 `#define`、`goto`，选中后在视图中定位）、筛选按钮（只显示所选标准中可用的特性）、打开规则设置面板。

视图和下面的规则设置面板读写同一个设置 `cppStandards.rules`，两边的修改会互相同步。

### 逐条规则设置

选定标准后，可以把每一条规则与所选标准逐条对照，并单独决定它的处理方式。打开方式：

- 命令面板：`C/C++ 标准: 配置规则...`
- 「C/C++ 标准」视图标题栏或语言分组上的 ⚙ 按钮
- 选择目标标准的列表右上角按钮、状态栏悬停提示、诊断的快速修复

面板顶部选择语言、对照方式（目标标准 / 所有已启用标准）和目标标准；下方按「C++17 引入」「C++17 移除」等分组列出全部规则，每一行显示：

| 列 | 含义 |
| --- | --- |
| 对照 | 该特性在所选标准下是否可用：✓ 支持、✕ 不支持（如「C++14 不支持」）、⚠ 已移除 |
| 设置 | **默认**：跟随所选标准；**允许**：从不报告（例如编译器已作为扩展支持）；**禁止**：即使标准支持也报告每一处使用（例如项目规范不允许使用协程） |
| 严重级别 | 单独设置这条规则的严重级别，默认使用全局设置 |
| 结果 | 按当前设置是否会报告 |

- 可按名称/规则 ID 搜索，按类别（语言特性、字面量、标准库、头文件、属性、预处理）和状态（会报告、对照标准不支持、已自定义……）筛选。
- 每个分组和工具栏都有「全部允许 / 全部禁止 / 全部恢复默认」，只作用于当前筛选出的规则；一次修改超过 20 条时会先确认。
- 默认只展开所选标准不支持的分组；分组标题显示其中已自定义的规则数。

设置保存在 `cppStandards.rules` 中（工作区设置），也可以直接编辑：

```jsonc
"cppStandards.rules": {
  "cpp20.coroutines": "forbid",                                   // 禁止协程
  "cpp17.lib.*": "allow",                                          // 允许所有 C++17 库名称（前缀匹配）
  "cpp17.lib.any": "default",                                      // 但 std::any 仍跟随标准
  "cpp17.removed.register": { "state": "forbid", "severity": "error" }
}
```

精确的规则 ID 优先于前缀，较长的前缀优先于较短的前缀；状态和严重级别分别解析。「禁止」优先于 GNU 扩展和「报告已移除的特性」开关。旧设置 `cppStandards.diagnostics.ignoredRules` 仍然有效（等同于「允许」），但已不推荐使用。

### 同步到工具链

本扩展从不运行编译器，而是把所选标准和规则写入你已在使用的 C/C++ 工具的配置中，由这些工具以完整的编译器语义报告问题。相关选项位于视图中的 **选项 → 同步到工具链**（分组上的 ⟳ 按钮可立即同步）：

| 选项（设置） | 写入内容 | 使用方 |
| --- | --- | --- |
| 同步到 Microsoft C/C++ 扩展（`sync.cpptools`，默认开启） | `C_Cpp.default.cppStandard` / `C_Cpp.default.cStandard`。若 `c_cpp_properties.json` 里显式写了 `cppStandard`，会提示改为 `${default}`。（该扩展暂不支持 C++26，此时同步为 `c++23`。） | IntelliSense |
| 同步到 .clangd（`sync.clangd`） | `.clangd` 中的受管理区块，按文件类型添加 `-std=`；区块之外的内容不受影响 | clangd |
| 同步到 CMake Tools（`sync.cmake`） | `cmake.configureSettings` 中的 `CMAKE_CXX_STANDARD`、`CMAKE_C_STANDARD`、`*_STANDARD_REQUIRED=ON` 和 `*_EXTENSIONS`（取自 GNU 选项）；自行设置了标准的目标保持不变 | CMake 配置，以及所有读取构建信息的工具 |
| 添加标准符合性警告（`sync.conformanceWarnings`） | `-pedantic`（ISO 方言），以及在代码必须兼容所有已启用标准时，针对最旧的已启用标准与目标之间每个标准的 Clang `-Wpre-c++17-compat` 类警告（C：`-Wdeclaration-after-statement`、`-Wvla`、`-Wpre-c11-compat`、`-Wpre-c2x-compat`） | clangd（`.clangd` 区块）、C/C++ 扩展的代码分析（`C_Cpp.codeAnalysis.clangTidy.args`） |
| 将禁止的规则映射为 clang-tidy 检查（`sync.clangTidyChecks`） | 为每条被禁止的核心规则启用最接近的 clang-tidy 检查，如宏常量对应 `cppcoreguidelines-macro-usage`，C 风格转换对应 `google-readability-casting`，`typedef` 对应 `modernize-use-using`，`atoi` 对应 `cert-err34-c` | clangd（`.clangd` 区块）、C/C++ 扩展的代码分析（`C_Cpp.codeAnalysis.clangTidy.checks.enabled`） |

与其他扩展共用的设置采用合并而非覆盖：扩展会记住自己添加的条目，只修改这些条目，并在关闭选项时将其移除；你自己添加的条目不会被改动。每个选项的提示会显示它当前写入的内容。C/C++ 扩展的代码分析需要你自行开启（`C_Cpp.codeAnalysis.clangTidy.enabled`），本扩展不会替你开启。

在这些工具之外构建时，**tasks.json / launch.json** 可以用 `${command:cppStandards.cppFlag}` 或 `${command:cppStandards.cFlag}` 获取当前目标对应的编译选项：

```jsonc
{
  "label": "build",
  "type": "shell",
  "command": "g++",
  "args": ["${command:cppStandards.cppFlag}", "-o", "app", "main.cpp"]
}
```

`cppStandards.compilerFlagStyle` 为 `gcc` 时返回 `-std=c++17`，为 `msvc` 时返回 `/std:c++17`；开启 `cppStandards.gnuExtensions` 时返回 `-std=gnu++17`。

## 设置

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `cppStandards.cpp.target` | `c++17` | C++ 目标标准 |
| `cppStandards.cpp.disabled` | `[]` | 被禁用的 C++ 标准 |
| `cppStandards.c.target` | `c17` | C 目标标准 |
| `cppStandards.c.disabled` | `[]` | 被禁用的 C 标准 |
| `cppStandards.gnuExtensions` | `false` | 使用 GNU 方言，且不报告 GNU 扩展支持的特性 |
| `cppStandards.diagnostics.enabled` | `true` | 是否进行特性诊断 |
| `cppStandards.diagnostics.mode` | `target` | `target` 或 `allEnabled` |
| `cppStandards.diagnostics.severity` | `warning` | `error` / `warning` / `information` / `hint` |
| `cppStandards.diagnostics.checkRemovedFeatures` | `true` | 是否报告已移除的特性 |
| `cppStandards.diagnostics.evaluatePreprocessor` | `true` | 是否求值 `#if` 条件 |
| `cppStandards.diagnostics.syntaxTree` | `true` | 使用语法树（tree-sitter）获得更精确的检查 |
| `cppStandards.rules` | `{}` | 逐条规则设置（默认 / 允许 / 禁止，以及严重级别），见「逐条规则设置」 |
| `cppStandards.diagnostics.ignoredRules` | `[]` | 已弃用，请改用 `cppStandards.rules` 的 `"allow"` |
| `cppStandards.diagnostics.exclude` | `[]` | 不检查的文件 glob，如 `**/third_party/**` |
| `cppStandards.sync.cpptools` | `true` | 同步到 Microsoft C/C++ 扩展 |
| `cppStandards.sync.clangd` | `false` | 同步到 `.clangd` |
| `cppStandards.sync.cmake` | `false` | 同步到 CMake Tools（`cmake.configureSettings`） |
| `cppStandards.sync.conformanceWarnings` | `false` | 向已同步的工具添加 Clang 标准符合性警告 |
| `cppStandards.sync.clangTidyChecks` | `false` | 向已同步的工具添加与被禁止规则对应的 clang-tidy 检查 |
| `cppStandards.compilerFlagStyle` | `gcc` | `${command:...}` 返回的选项格式 |
| `cppStandards.statusBar.enabled` | `true` | 在状态栏显示 |

有工作区时，扩展修改的设置写入工作区设置（`.vscode/settings.json`），否则写入用户设置。仅仅打开项目不会写入任何文件。

规则 ID 的格式为 `<标准>.<特性>`，例如 `cpp17.structured-binding`、`cpp17.lib.optional`、`cpp20.header.format`、`cpp17.removed.register`、`c99.line-comment`。所有标准共有的基础特性使用第一个标准作前缀，如 `cpp98.macro-constant`、`c89.goto`（用 `"cpp98.*": "forbid"` 可一次禁用全部）。悬停诊断即可看到规则 ID。

## 局限

特性检测基于词法分析、正则表达式和每个文件的语法树，但没有编译器语义（类型、重载决议、模板）。需要这些时，请把配置同步到基于编译器的工具（见「同步到工具链」）。

- 名称只在单个文件内解析：被包含的头文件中的 `using namespace std;` 不会被识别。不使用语法树时，只识别带 `std::` 前缀的库名称。
- 宏展开后的代码不会被分析（宏定义体本身会被检查）。
- 「宏常量」只识别替换列表中含字面量的无参宏（`#define MAX 100`、`#define NAME "x"`），不包括头文件保护宏和 `#define EXPORT __declspec(...)` 这类宏；不使用语法树时，「C 风格类型转换」只识别转换为内置类型、`xxx_t` 类型和指针/引用类型的写法。
- tree-sitter 的 C++ 语法暂不支持模块、`if consteval`、显式对象参数（deducing this）和部分 C++26 语法；这些行使用模式匹配检查。
- 极少数写法可能误报或漏报，可用屏蔽注释、规则设置（「允许」）或 `exclude` 处理。

## 开发

```bash
npm install
npm run compile            # 编译到 out/
npm test                   # 单元测试（node:test）
npm run test:integration   # 在下载的 VS Code 中运行集成测试
npm run package            # 打包 .vsix（需要先把 package.json 中的 publisher 改为你自己的）
node scripts/update-grammars.mjs [c-version] [cpp-version]   # 从 npm 更新 grammars/*.wasm
```

在 VS Code 中按 `F5`（“Run Extension”）会打开带有示例文件（`samples/`）的扩展开发窗口；“Run Extension (Chinese UI)” 以中文界面启动。

代码结构：

- `src/analysis/`：与 VS Code 无关的分析引擎（词法器、预处理求值、规则表、分析器），可单独测试
- `src/analysis/syntax/`：tree-sitter 引擎（`engine.ts` 加载 WebAssembly 运行时和 `grammars/`）、语法检测器与名称解析（`detectors.ts`）
- `src/standards.ts`：各标准的元数据（编译选项、宏值、主要特性）
- `src/tree.ts`、`src/statusBar.ts`、`src/commands.ts`：界面
- `src/diagnostics.ts`：诊断与快速修复
- `src/rulesPanel.ts`、`media/rules.js`、`media/rules.css`：规则设置面板；`src/analysis/ruleSettings.ts`：规则设置的解析与更新
- `src/singleRules.ts`：「单项规则」视图；`src/analysis/ruleGroups.ts`：视图的分组与开关逻辑（与 VS Code 无关，可单独测试）
- `src/sync.ts`：同步到 cpptools / clangd / CMake Tools；`src/toolchain.ts`：写入的内容（编译选项、clang-tidy 映射、`.clangd` 区块、共用设置的合并），可单独测试

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 发布。

内置的第三方组件：[web-tree-sitter](https://github.com/tree-sitter/tree-sitter) 运行时以及 [tree-sitter-c](https://github.com/tree-sitter/tree-sitter-c) 和 [tree-sitter-cpp](https://github.com/tree-sitter/tree-sitter-cpp) 语法，均采用 MIT 许可证（见 `grammars/LICENSE` 和 `node_modules/web-tree-sitter/LICENSE`）。
