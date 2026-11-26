/* Demo file for the C/C++ Standards extension. Try the C89, C99, C17 and C23 targets. */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

struct point {
    int x;
    int y;
};

static inline int square(int v) { return v * v; }   // C99: inline and // comments

int main(void) {
    struct point p = { .x = 1, .y = 2 };   /* C99 designated initializers */
    bool ok = true;                        /* C99 <stdbool.h> */
    uint32_t mask = 0b1010;                /* C23 binary literal */
    for (int i = 0; i < 3; i++) {          /* C99 declaration in for */
        mask |= (uint32_t)square(i);
    }
    _Static_assert(sizeof(int) >= 2, "int too small");   /* C11 */
    int *none = nullptr;                                  /* C23 */
#if __STDC_VERSION__ >= 202311L
    constexpr int limit = 10;   /* only compiled for C23, never reported for older targets */
    (void)limit;
#endif
    printf("%d %d %u %d\n", p.x, ok, mask, none == 0);
    return 0;
}
