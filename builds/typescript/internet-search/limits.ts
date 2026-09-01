export const INTERNET_SEARCH_LOCAL_V1_LIMITS = Object.freeze({
  profile_id: "is-local-v1.0",
  max_normalized_results_per_search: 10,
  max_search_operations_per_run: 5,
  max_read_operations_per_run: 5,
  max_redirects_per_read: 3,
  max_returned_read_content_bytes: 262_144,
  search_operation_timeout_ms: 10_000,
  read_operation_timeout_ms: 10_000,
  run_wall_clock_limit_ms: 60_000,
  retry_rule: "one_retry_retryable_provider_or_network_failures",
  query_adaptation: "none",
  fallback: "none",
  billing: "none_owner_managed_local",
} as const);

export type InternetSearchLocalV1Limits = typeof INTERNET_SEARCH_LOCAL_V1_LIMITS;
