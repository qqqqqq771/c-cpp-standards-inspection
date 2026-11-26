/**
 * Lookup tables mapping library names, headers, attributes and feature-test macros to the
 * standard that introduced (or removed) them. Keys are standard ids from `standards.ts`.
 */

type Table = Readonly<Record<string, readonly string[]>>;

/** Names in namespace `std` (without the `std::` prefix). Nested names use `::`. */
export const CPP_LIBRARY: Table = {
  'c++11': [
    'unique_ptr', 'shared_ptr', 'weak_ptr', 'make_shared', 'allocate_shared', 'enable_shared_from_this',
    'static_pointer_cast', 'dynamic_pointer_cast', 'const_pointer_cast', 'default_delete',
    'thread', 'this_thread', 'mutex', 'recursive_mutex', 'timed_mutex', 'recursive_timed_mutex',
    'lock_guard', 'unique_lock', 'condition_variable', 'condition_variable_any', 'call_once', 'once_flag',
    'future', 'shared_future', 'promise', 'async', 'packaged_task', 'launch',
    'atomic', 'atomic_flag', 'memory_order',
    'function', 'bind', 'ref', 'cref', 'reference_wrapper', 'mem_fn', 'placeholders',
    'array', 'forward_list', 'unordered_map', 'unordered_set', 'unordered_multimap', 'unordered_multiset',
    'tuple', 'make_tuple', 'tie', 'forward_as_tuple', 'tuple_cat', 'tuple_size', 'tuple_element', 'ignore',
    'move', 'forward', 'move_if_noexcept', 'declval',
    'chrono', 'ratio',
    'regex', 'wregex', 'regex_match', 'regex_search', 'regex_replace', 'smatch', 'cmatch',
    'random_device', 'mt19937', 'mt19937_64', 'minstd_rand', 'default_random_engine',
    'uniform_int_distribution', 'uniform_real_distribution', 'normal_distribution',
    'bernoulli_distribution', 'discrete_distribution',
    'to_string', 'to_wstring', 'stoi', 'stol', 'stoll', 'stoul', 'stoull', 'stof', 'stod', 'stold',
    'u16string', 'u32string', 'initializer_list', 'nullptr_t', 'type_index', 'hash',
    'is_same', 'enable_if', 'conditional', 'decay', 'is_integral', 'is_floating_point', 'is_arithmetic',
    'is_pointer', 'is_reference', 'is_base_of', 'is_convertible', 'is_constructible',
    'is_trivially_copyable', 'is_trivially_constructible', 'is_nothrow_move_constructible',
    'is_enum', 'is_class', 'is_void', 'is_signed', 'is_unsigned',
    'remove_reference', 'remove_const', 'remove_cv', 'remove_pointer', 'add_const', 'add_pointer',
    'add_lvalue_reference', 'add_rvalue_reference', 'integral_constant', 'true_type', 'false_type',
    'underlying_type', 'common_type', 'result_of', 'aligned_storage', 'make_signed', 'make_unsigned',
    'iota', 'all_of', 'any_of', 'none_of', 'find_if_not', 'copy_if', 'copy_n', 'is_sorted',
    'is_sorted_until', 'is_partitioned', 'partition_copy', 'partition_point', 'minmax',
    'minmax_element', 'is_permutation', 'shuffle', 'begin', 'end', 'next', 'prev',
    'exception_ptr', 'current_exception', 'rethrow_exception', 'make_exception_ptr',
    'nested_exception', 'throw_with_nested', 'rethrow_if_nested',
    'system_error', 'error_code', 'error_category', 'errc', 'addressof', 'align',
    'quick_exit', 'at_quick_exit',
    'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t',
    'intptr_t', 'uintptr_t', 'intmax_t', 'uintmax_t',
    'isnan', 'isinf', 'isfinite', 'isnormal', 'signbit', 'fpclassify', 'round', 'trunc', 'lround',
    'llround', 'nextafter', 'fma', 'fmax', 'fmin', 'hypot', 'cbrt', 'log2', 'exp2', 'copysign', 'nan',
  ],
  'c++14': [
    'make_unique', 'exchange', 'integer_sequence', 'index_sequence', 'make_index_sequence',
    'make_integer_sequence', 'index_sequence_for', 'quoted', 'shared_timed_mutex', 'shared_lock',
    'is_final', 'is_null_pointer', 'cbegin', 'cend', 'crbegin', 'crend', 'rbegin', 'rend',
    'literals', 'chrono_literals', 'string_literals', 'complex_literals',
  ],
  'c++17': [
    'optional', 'nullopt', 'nullopt_t', 'make_optional', 'bad_optional_access',
    'variant', 'visit', 'holds_alternative', 'get_if', 'monostate', 'variant_size', 'variant_alternative',
    'bad_variant_access', 'any', 'any_cast', 'make_any', 'bad_any_cast',
    'string_view', 'wstring_view', 'u16string_view', 'u32string_view', 'basic_string_view',
    'filesystem', 'byte', 'to_integer', 'apply', 'invoke', 'invoke_result', 'invoke_result_t',
    'is_invocable', 'is_invocable_r', 'is_nothrow_invocable', 'clamp', 'gcd', 'lcm', 'size', 'data',
    'empty', 'as_const', 'scoped_lock', 'shared_mutex', 'from_chars', 'to_chars', 'chars_format',
    'launder', 'in_place', 'in_place_t', 'in_place_type', 'in_place_index', 'conjunction', 'disjunction',
    'negation', 'void_t', 'bool_constant', 'make_from_tuple', 'not_fn', 'sample', 'reduce',
    'transform_reduce', 'inclusive_scan', 'exclusive_scan', 'transform_inclusive_scan',
    'transform_exclusive_scan', 'for_each_n', 'execution', 'uncaught_exceptions', 'destroy_at',
    'destroy', 'destroy_n', 'uninitialized_move', 'uninitialized_value_construct',
    'uninitialized_default_construct', 'is_aggregate', 'has_unique_object_representations',
    'is_swappable', 'is_nothrow_swappable', 'pmr', 'hardware_destructive_interference_size',
    'hardware_constructive_interference_size', 'aligned_alloc', 'boyer_moore_searcher',
    'boyer_moore_horspool_searcher', 'default_searcher',
    'beta', 'riemann_zeta', 'cyl_bessel_j', 'cyl_neumann', 'legendre', 'hermite', 'laguerre', 'expint',
  ],
  'c++20': [
    'span', 'dynamic_extent', 'format', 'format_to', 'format_to_n', 'formatted_size', 'vformat',
    'vformat_to', 'make_format_args', 'formatter', 'format_error', 'ranges', 'views', 'jthread',
    'stop_token', 'stop_source', 'stop_callback', 'source_location', 'bit_cast', 'numbers',
    'counting_semaphore', 'binary_semaphore', 'latch', 'barrier', 'endian', 'to_array', 'erase',
    'erase_if', 'midpoint', 'lerp', 'ssize', 'is_constant_evaluated', 'remove_cvref', 'remove_cvref_t',
    'type_identity', 'type_identity_t', 'popcount', 'countl_zero', 'countl_one', 'countr_zero',
    'countr_one', 'has_single_bit', 'bit_ceil', 'bit_floor', 'bit_width', 'rotl', 'rotr',
    'make_shared_for_overwrite', 'make_unique_for_overwrite', 'assume_aligned', 'osyncstream',
    'syncbuf', 'basic_osyncstream', 'strong_ordering', 'weak_ordering', 'partial_ordering',
    'compare_three_way', 'three_way_comparable', 'same_as', 'derived_from', 'convertible_to',
    'common_reference_with', 'common_with', 'integral', 'signed_integral', 'unsigned_integral',
    'floating_point', 'assignable_from', 'swappable', 'destructible', 'constructible_from',
    'default_initializable', 'move_constructible', 'copy_constructible', 'equality_comparable',
    'totally_ordered', 'movable', 'copyable', 'semiregular', 'regular', 'invocable',
    'regular_invocable', 'predicate', 'relation', 'equivalence_relation', 'strict_weak_order',
    'coroutine_handle', 'coroutine_traits', 'suspend_always', 'suspend_never', 'noop_coroutine',
    'atomic_ref', 'u8string', 'u8string_view', 'cmp_equal', 'cmp_not_equal', 'cmp_less', 'cmp_greater',
    'cmp_less_equal', 'cmp_greater_equal', 'in_range', 'bind_front', 'identity', 'unwrap_reference',
    'unwrap_ref_decay', 'to_address', 'construct_at', 'is_bounded_array', 'is_unbounded_array',
    'common_reference', 'contiguous_iterator', 'random_access_iterator', 'bidirectional_iterator',
    'forward_iterator', 'input_iterator', 'output_iterator', 'sentinel_for', 'is_nothrow_convertible',
    'destroying_delete', 'default_sentinel', 'unreachable_sentinel', 'counted_iterator',
    'common_iterator', 'move_sentinel',
    'chrono::year', 'chrono::month', 'chrono::day', 'chrono::weekday', 'chrono::year_month_day',
    'chrono::sys_days', 'chrono::local_days', 'chrono::days', 'chrono::weeks', 'chrono::months',
    'chrono::years', 'chrono::zoned_time', 'chrono::time_zone', 'chrono::utc_clock', 'chrono::tai_clock',
    'chrono::gps_clock', 'chrono::file_clock', 'chrono::hh_mm_ss', 'chrono::current_zone',
    'chrono::locate_zone', 'chrono::clock_cast',
  ],
  'c++23': [
    'print', 'println', 'vprint_unicode', 'vprint_nonunicode', 'expected', 'unexpected', 'unexpect',
    'bad_expected_access', 'mdspan', 'extents', 'dextents', 'layout_left', 'layout_right',
    'layout_stride', 'default_accessor', 'flat_map', 'flat_multimap', 'flat_set', 'flat_multiset',
    'generator', 'stacktrace', 'basic_stacktrace', 'stacktrace_entry', 'to_underlying', 'unreachable',
    'byteswap', 'move_only_function', 'spanstream', 'ispanstream', 'ospanstream', 'spanbuf', 'out_ptr',
    'inout_ptr', 'start_lifetime_as', 'start_lifetime_as_array', 'forward_like', 'invoke_r',
    'is_scoped_enum', 'is_implicit_lifetime', 'float16_t', 'float32_t', 'float64_t', 'float128_t',
    'bfloat16_t', 'formattable', 'range_format',
    'ranges::to', 'ranges::fold_left', 'ranges::fold_right', 'ranges::fold_left_first',
    'ranges::contains', 'ranges::contains_subrange', 'ranges::starts_with', 'ranges::ends_with',
    'ranges::find_last', 'ranges::iota', 'ranges::shift_left', 'ranges::shift_right',
    'ranges::zip_view', 'ranges::enumerate_view',
    'views::zip', 'views::zip_transform', 'views::adjacent', 'views::adjacent_transform',
    'views::pairwise', 'views::chunk', 'views::chunk_by', 'views::slide', 'views::stride',
    'views::join_with', 'views::cartesian_product', 'views::enumerate', 'views::as_const',
    'views::as_rvalue', 'views::repeat',
  ],
  'c++26': [
    'inplace_vector', 'hive', 'text_encoding', 'linalg', 'submdspan', 'simd', 'basic_simd',
    'function_ref', 'copyable_function', 'breakpoint', 'breakpoint_if_debugging', 'is_debugger_present',
    'saturate_cast', 'add_sat', 'sub_sat', 'mul_sat', 'div_sat', 'meta', 'rcu_obj_base', 'rcu_domain',
    'rcu_synchronize', 'hazard_pointer', 'hazard_pointer_obj_base', 'make_hazard_pointer', 'contracts',
    'is_within_lifetime', 'define_static_array', 'define_static_string', 'indirect', 'polymorphic',
    'runtime_format', 'is_virtual_base_of', 'constant_wrapper', 'philox_engine', 'philox4x32',
    'philox4x64', 'aligned_accessor', 'layout_left_padded', 'layout_right_padded',
    'execution::sender', 'execution::receiver', 'execution::scheduler', 'execution::just',
    'execution::then', 'execution::sync_wait', 'execution::when_all', 'execution::let_value',
    'execution::schedule', 'execution::run_loop', 'execution::task',
    'views::concat', 'views::cache_latest', 'views::to_input', 'ranges::generate_random',
  ],
};

/** Names in namespace `std` that were removed by the given standard. */
export const CPP_LIBRARY_REMOVED: Table = {
  'c++14': ['gets'],
  'c++17': [
    'auto_ptr', 'random_shuffle', 'bind1st', 'bind2nd', 'ptr_fun', 'mem_fun', 'mem_fun_ref',
    'unary_function', 'binary_function', 'pointer_to_unary_function', 'pointer_to_binary_function',
    'set_unexpected', 'get_unexpected', 'unexpected_handler',
  ],
  'c++20': [
    'uncaught_exception', 'result_of', 'result_of_t', 'is_literal_type', 'is_literal_type_v',
    'raw_storage_iterator', 'get_temporary_buffer', 'return_temporary_buffer', 'not1', 'not2',
    'unary_negate', 'binary_negate',
  ],
  'c++23': [
    'declare_reachable', 'undeclare_reachable', 'declare_no_pointers', 'undeclare_no_pointers',
    'get_pointer_safety', 'pointer_safety',
  ],
  'c++26': [
    'wstring_convert', 'wbuffer_convert', 'codecvt_utf8', 'codecvt_utf16', 'codecvt_utf8_utf16',
    'strstream', 'istrstream', 'ostrstream', 'strstreambuf',
  ],
};

export const CPP_HEADERS: Table = {
  'c++11': [
    'array', 'atomic', 'chrono', 'condition_variable', 'forward_list', 'future', 'initializer_list',
    'mutex', 'random', 'ratio', 'regex', 'scoped_allocator', 'system_error', 'thread', 'tuple',
    'typeindex', 'type_traits', 'unordered_map', 'unordered_set', 'cstdint', 'cinttypes', 'cuchar',
    'cfenv', 'codecvt', 'ccomplex', 'cstdalign', 'cstdbool', 'ctgmath',
  ],
  'c++14': ['shared_mutex'],
  'c++17': ['any', 'charconv', 'execution', 'filesystem', 'memory_resource', 'optional', 'string_view', 'variant'],
  'c++20': [
    'barrier', 'bit', 'compare', 'concepts', 'coroutine', 'format', 'latch', 'numbers', 'ranges',
    'semaphore', 'source_location', 'span', 'stop_token', 'syncstream', 'version',
  ],
  'c++23': ['expected', 'flat_map', 'flat_set', 'generator', 'mdspan', 'print', 'spanstream', 'stacktrace', 'stdfloat'],
  'c++26': [
    'debugging', 'hazard_pointer', 'hive', 'inplace_vector', 'linalg', 'rcu', 'text_encoding', 'simd',
    'contracts', 'meta',
  ],
};

export const CPP_HEADERS_REMOVED: Table = {
  'c++20': ['ccomplex', 'cstdalign', 'cstdbool', 'ctgmath', 'ciso646'],
  'c++26': ['codecvt', 'strstream'],
};

export const C_HEADERS: Table = {
  c99: ['stdbool.h', 'stdint.h', 'inttypes.h', 'complex.h', 'tgmath.h', 'fenv.h'],
  c11: ['stdalign.h', 'stdatomic.h', 'stdnoreturn.h', 'threads.h', 'uchar.h'],
  c23: ['stdbit.h', 'stdckdint.h'],
};

/** C library functions and function-like macros. */
export const C_FUNCTIONS: Table = {
  c99: [
    'snprintf', 'vsnprintf', 'vscanf', 'vfscanf', 'vsscanf', 'strtoll', 'strtoull', 'strtof', 'strtold',
    'strtoimax', 'strtoumax', 'llabs', 'lldiv', 'atoll', 'imaxabs', 'imaxdiv', 'isblank', 'iswblank',
    'fmin', 'fmax', 'fma', 'fdim', 'round', 'lround', 'llround', 'trunc', 'cbrt', 'hypot', 'log2', 'exp2',
    'log1p', 'expm1', 'nan', 'nanf', 'isnan', 'isinf', 'isfinite', 'isnormal', 'signbit', 'fpclassify',
    'copysign', 'remainder', 'remquo', 'nearbyint', 'rint', 'lrint', 'llrint', 'tgamma', 'lgamma', 'erf',
    'erfc', 'acosh', 'asinh', 'atanh', 'scalbn', 'scalbln', 'ilogb', 'logb', 'nextafter', 'nexttoward',
    'va_copy', '_Exit', 'wcstoll', 'wcstof', 'feclearexcept', 'fegetround', 'fesetround',
  ],
  c11: [
    'aligned_alloc', 'quick_exit', 'at_quick_exit', 'timespec_get', 'thrd_create', 'thrd_join',
    'thrd_exit', 'thrd_sleep', 'thrd_yield', 'thrd_current', 'thrd_detach', 'mtx_init', 'mtx_lock',
    'mtx_trylock', 'mtx_unlock', 'mtx_destroy', 'mtx_timedlock', 'cnd_init', 'cnd_wait', 'cnd_signal',
    'cnd_broadcast', 'cnd_timedwait', 'cnd_destroy', 'tss_create', 'tss_get', 'tss_set', 'tss_delete',
    'atomic_init', 'atomic_load', 'atomic_store', 'atomic_exchange', 'atomic_fetch_add',
    'atomic_fetch_sub', 'atomic_fetch_or', 'atomic_fetch_and', 'atomic_fetch_xor',
    'atomic_compare_exchange_strong', 'atomic_compare_exchange_weak', 'atomic_thread_fence',
    'atomic_signal_fence', 'atomic_flag_test_and_set', 'atomic_flag_clear', 'atomic_is_lock_free',
    'kill_dependency', 'c16rtomb', 'mbrtoc16', 'c32rtomb', 'mbrtoc32', 'CMPLX',
  ],
  c23: [
    'memset_explicit', 'memalignment', 'strfromd', 'strfromf', 'strfroml', 'ckd_add', 'ckd_sub',
    'ckd_mul', 'stdc_count_ones', 'stdc_count_zeros', 'stdc_leading_zeros', 'stdc_leading_ones',
    'stdc_trailing_zeros', 'stdc_trailing_ones', 'stdc_first_leading_one', 'stdc_first_trailing_one',
    'stdc_has_single_bit', 'stdc_bit_width', 'stdc_bit_floor', 'stdc_bit_ceil', 'timespec_getres',
    'free_sized', 'free_aligned_sized', 'mbrtoc8', 'c8rtomb',
  ],
};

export const C_FUNCTIONS_REMOVED: Table = {
  c11: ['gets'],
};

export const CPP_FUNCTIONS_REMOVED: Table = {
  'c++14': ['gets'],
};

/** Member functions of standard containers and strings. */
export const CPP_MEMBERS: Table = {
  'c++11': ['emplace', 'emplace_back', 'emplace_front', 'emplace_hint', 'shrink_to_fit', 'cbegin', 'cend', 'crbegin', 'crend'],
  'c++17': ['try_emplace', 'insert_or_assign'],
  'c++20': ['starts_with', 'ends_with'],
  'c++23': ['resize_and_overwrite'],
};

/** Standard attributes (C++). In C every `[[...]]` attribute is C23. */
export const CPP_ATTRIBUTES: Table = {
  'c++11': ['noreturn', 'carries_dependency'],
  'c++14': ['deprecated'],
  'c++17': ['fallthrough', 'nodiscard', 'maybe_unused'],
  'c++20': ['likely', 'unlikely', 'no_unique_address'],
  'c++23': ['assume'],
  'c++26': ['indeterminate'],
};

export const C_ATTRIBUTES: Table = {
  c23: ['deprecated', 'fallthrough', 'maybe_unused', 'nodiscard', 'noreturn', '_Noreturn', 'unsequenced', 'reproducible'],
};

/** Language feature-test macros (`__cpp_*`). */
export const CPP_LANGUAGE_FEATURE_MACROS: Table = {
  'c++98': ['__cpp_rtti', '__cpp_exceptions'],
  'c++11': [
    '__cpp_unicode_characters', '__cpp_raw_strings', '__cpp_unicode_literals',
    '__cpp_user_defined_literals', '__cpp_lambdas', '__cpp_constexpr', '__cpp_range_based_for',
    '__cpp_static_assert', '__cpp_decltype', '__cpp_attributes', '__cpp_rvalue_references',
    '__cpp_variadic_templates', '__cpp_initializer_lists', '__cpp_delegating_constructors',
    '__cpp_nsdmi', '__cpp_inheriting_constructors', '__cpp_ref_qualifiers', '__cpp_alias_templates',
    '__cpp_threadsafe_static_init',
  ],
  'c++14': [
    '__cpp_binary_literals', '__cpp_init_captures', '__cpp_generic_lambdas', '__cpp_sized_deallocation',
    '__cpp_decltype_auto', '__cpp_return_type_deduction', '__cpp_aggregate_nsdmi',
    '__cpp_variable_templates', '__cpp_digit_separators',
  ],
  'c++17': [
    '__cpp_hex_float', '__cpp_inline_variables', '__cpp_aligned_new', '__cpp_guaranteed_copy_elision',
    '__cpp_noexcept_function_type', '__cpp_fold_expressions', '__cpp_capture_star_this',
    '__cpp_if_constexpr', '__cpp_nontype_template_args', '__cpp_template_auto',
    '__cpp_namespace_attributes', '__cpp_enumerator_attributes', '__cpp_structured_bindings',
    '__cpp_deduction_guides', '__cpp_nontype_template_parameter_auto', '__cpp_variadic_using',
    '__cpp_aggregate_bases', '__cpp_constexpr_lambda',
  ],
  'c++20': [
    '__cpp_concepts', '__cpp_conditional_explicit', '__cpp_consteval', '__cpp_constinit',
    '__cpp_impl_coroutine', '__cpp_impl_three_way_comparison', '__cpp_char8_t',
    '__cpp_designated_initializers', '__cpp_modules', '__cpp_using_enum', '__cpp_aggregate_paren_init',
    '__cpp_impl_destroying_delete', '__cpp_constexpr_dynamic_alloc', '__cpp_constexpr_in_decltype',
  ],
  'c++23': [
    '__cpp_if_consteval', '__cpp_explicit_this_parameter', '__cpp_multidimensional_subscript',
    '__cpp_size_t_suffix', '__cpp_static_call_operator', '__cpp_auto_cast',
    '__cpp_named_character_escapes', '__cpp_implicit_move',
  ],
  'c++26': [
    '__cpp_pack_indexing', '__cpp_deleted_function', '__cpp_placeholder_variables',
    '__cpp_variadic_friend', '__cpp_constexpr_exceptions', '__cpp_contracts', '__cpp_impl_reflection',
    '__cpp_pp_embed', '__cpp_trivial_relocatability',
  ],
};

/** Library feature-test macro suffixes (`__cpp_lib_<name>`) that are not plain library names. */
export const CPP_LIBRARY_FEATURE_MACROS: Table = {
  'c++14': [
    'exchange_function', 'transparent_operators', 'integral_constant_callable', 'tuples_by_type',
    'quoted_string_io', 'string_udls', 'complex_udls', 'chrono_udls', 'robust_nonmodifying_seq_ops',
    'null_iterators', 'result_of_sfinae', 'is_null_pointer',
  ],
  'c++17': [
    'nonmember_container_access', 'parallel_algorithm', 'math_special_functions', 'hardware_interference_size',
    'logical_traits', 'type_trait_variable_templates', 'gcd_lcm', 'map_try_emplace', 'node_extract',
    'unordered_map_try_emplace', 'boyer_moore_searcher', 'raw_memory_algorithms', 'array_constexpr',
    'addressof_constexpr', 'enable_shared_from_this', 'has_unique_object_representations',
    'incomplete_container_elements', 'shared_ptr_arrays', 'shared_ptr_weak_type', 'allocator_traits_is_always_equal',
  ],
  'c++20': [
    'concepts', 'three_way_comparison', 'math_constants', 'coroutine', 'char8_t', 'starts_ends_with',
    'bitops', 'int_pow2', 'semaphore', 'syncbuf', 'interpolate', 'unwrap_ref', 'integer_comparison_functions',
    'constexpr_string', 'constexpr_vector', 'constexpr_algorithms', 'constexpr_dynamic_alloc',
    'atomic_wait', 'atomic_flag_test', 'list_remove_return_type', 'polymorphic_allocator',
    'smart_ptr_for_overwrite', 'shift', 'string_view', 'generic_unordered_lookup', 'span',
  ],
  'c++23': [
    'ranges_zip', 'ranges_to_container', 'ranges_fold', 'ranges_contains', 'ranges_chunk',
    'ranges_chunk_by', 'ranges_slide', 'ranges_stride', 'ranges_join_with', 'ranges_cartesian_product',
    'ranges_enumerate', 'ranges_as_const', 'ranges_as_rvalue', 'ranges_repeat', 'ranges_iota',
    'ranges_find_last', 'ranges_starts_ends_with', 'string_contains', 'string_resize_and_overwrite',
    'format_ranges', 'print', 'stdatomic_h', 'move_only_function', 'expected', 'mdspan',
  ],
  'c++26': [
    'reflection', 'senders', 'saturation_arithmetic', 'linalg', 'simd', 'text_encoding', 'debugging',
    'function_ref', 'copyable_function', 'inplace_vector', 'hive', 'rcu', 'hazard_pointer',
    'ranges_concat', 'ranges_cache_latest', 'ranges_to_input', 'constant_wrapper', 'philox_engine',
  ],
};
