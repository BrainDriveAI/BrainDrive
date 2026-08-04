import { diagnostic } from '../diagnostics.mjs';

const FORBIDDEN_PATHS = [
  /^builds\/typescript\/your-memory[^/]*(?:\/|$)/,
  /^builds\/typescript\/\.paa-secrets[^/]*(?:\/|$)/,
  /^builds\/typescript\/\.reset-backups\//,
  /^builds\/typescript\/\.your-memory\.root-owned\.backup\//,
  /^installer\/docker\/backups\//,
  /(^|\/)node_modules\//,
  /(^|\/)(?:dist|build|target|coverage|vendor|\.cache)\//,
  /^docs\/Security\//,
];

export function validateCandidateScope(candidates = [], forbidden = []) {
  const diagnostics = [];
  for (const path of candidates) if (FORBIDDEN_PATHS.some((pattern) => pattern.test(path)) || forbidden.includes(path)) diagnostics.push(diagnostic('DA-16', path, 'forbidden ignored/generated/vendor path entered documentation candidate scope'));
  return diagnostics;
}

export function validateSecurityText(path, text) {
  const secretShape = /\bsk-[A-Za-z0-9_-]{24,}\b|sk-<synthetic-secret-shaped-value>/;
  const providerPatterns = [
    /BrainDrive Models credits[^.]*required[^.]*(?:Ollama|BYOK OpenRouter)|(?:Ollama|BYOK OpenRouter)[^.]*require[^.]*BrainDrive Models credits/i,
    /BrainDrive-owned provider keys?[^.]*client config(?:uration)?/i,
  ];
  const providerUnsafe = text.split(/\r?\n/).some((line) => providerPatterns.some((pattern) => pattern.test(line)) && !/\b(?:do not|must not|never|no\b[^.]*|prohibit|prevent|without)\b/i.test(line));
  return secretShape.test(text) || providerUnsafe ? [diagnostic('DA-15', path, 'sensitive or provider-unsafe content pattern detected; matched value is redacted', 'Use unmistakably synthetic placeholders and preserve provider independence')] : [];
}
