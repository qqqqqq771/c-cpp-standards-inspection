// Demo file for the C/C++ Standards extension.
// Change the C++ target in the status bar or the "C/C++ Standards" view and watch the warnings change.
#include <map>
#include <memory>
#include <optional>   // C++17
#include <string>
#include <vector>

namespace demo::detail {   // C++17 nested namespace

struct Point {
    int x;
    int y;
};

[[nodiscard]] std::optional<int> find(const std::map<std::string, int>& m, const std::string& key) {
    if (auto it = m.find(key); it != m.end()) {   // C++17 if with initializer
        return it->second;
    }
    return std::nullopt;
}

template <typename T>
concept Integral = std::is_integral_v<T>;   // C++20 concept

}  // namespace demo::detail

int main() {
    auto values = std::make_unique<std::vector<int>>();   // C++14
    values->emplace_back(1'000);                          // C++11 member, C++14 digit separator
    for (const auto& [key, value] : std::map<std::string, int>{{"a", 1}}) {   // C++17 structured binding
        (void)key;
        (void)value;
    }
    demo::detail::Point p{.x = 1, .y = 2};   // C++20 designated initializers
    register int old = p.x;                  // removed in C++17

#if __cplusplus >= 202002L
    auto cmp = p.x <=> p.y;   // only compiled as C++20 or newer, so never reported for older targets
    (void)cmp;
#endif

    // cppstd-ignore-next-line
    auto lambda = [](auto x) { return x; };   // suppressed by the comment above
    return lambda(old);
}
