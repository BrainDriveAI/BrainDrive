import { spawnSync } from 'node:child_process';

const ALLOWED_GOVERNANCE = ['.github/ISSUE_TEMPLATE/', '.github/pull_request_template.md', '.github/workflows/ci.yml', '.github/CODEOWNERS', 'builds/typescript/package.json', 'tools/docs/'];

export function enumerateCandidates(root = process.cwd()) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Unable to enumerate Git candidates');
  return result.stdout.split('\0').filter(Boolean).sort();
}

export function documentationCandidates(paths) {
  return paths.filter((path) => path.endsWith('.md') || ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'].includes(path) || ALLOWED_GOVERNANCE.some((prefix) => path === prefix || path.startsWith(prefix)));
}
