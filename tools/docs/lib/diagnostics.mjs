export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/\b((?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET(?:[_-]?KEY)?|PASSWORD|AUTHORIZATION))\s*[:=]\s*[^\s|]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_SECRET]')
    .replace(/\/(?:home|Users)\/[^/\s|]+/g, '/[REDACTED_OWNER]')
    .replace(/[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\\\s|]+/gi, '[REDACTED_OWNER_PATH]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[REDACTED_NETWORK]')
    .replace(/\b[A-Za-z0-9][A-Za-z0-9.-]*\.(?:local|internal|lan|home|corp)\b/gi, '[REDACTED_HOST]');
}

export function diagnostic(rule, path, message, hint = '') {
  return {
    rule: redactDiagnosticText(rule),
    path: redactDiagnosticText(path),
    message: redactDiagnosticText(message),
    hint: redactDiagnosticText(hint),
  };
}

export function formatDiagnostic(item) {
  const rule = redactDiagnosticText(item.rule);
  const path = redactDiagnosticText(item.path);
  const message = redactDiagnosticText(item.message);
  const hint = redactDiagnosticText(item.hint);
  const suffix = hint ? ` Hint: ${hint}` : '';
  return `[${rule}] ${path}: ${message}.${suffix}`;
}
