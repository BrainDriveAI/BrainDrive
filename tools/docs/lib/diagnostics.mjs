export function diagnostic(rule, path, message, hint = '') {
  return { rule, path, message, hint };
}

export function formatDiagnostic(item) {
  const suffix = item.hint ? ` Hint: ${item.hint}` : '';
  return `[${item.rule}] ${item.path}: ${item.message}.${suffix}`;
}
