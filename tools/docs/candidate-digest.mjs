import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCandidateScope } from './lib/rules/security.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const evidenceOutput = (path) =>
  path.startsWith('docs/developers/verification/ai-agent-scorecards/') ||
  path === 'docs/developers/verification/milestones/05-ai-agent-system.md' ||
  path === 'docs/developers/verification/milestones/07-release-gauntlet.md' ||
  path === 'docs/developers/verification/m7-trace-matrix.md' ||
  path === 'docs/developers/verification/v1-readiness.md';

function git(repositoryRoot, args) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'buffer' });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed while computing candidate digest`);
  return result.stdout;
}

function nulFields(buffer) {
  return buffer.toString('utf8').split('\0').filter(Boolean);
}

export async function candidateDigest(repositoryRoot = root) {
  repositoryRoot = resolve(repositoryRoot);
  const realRoot = await realpath(repositoryRoot);
  const head = git(repositoryRoot, ['rev-parse', 'HEAD']).toString('utf8').trim();
  const trackedFields = nulFields(git(repositoryRoot, ['diff', '--name-status', '--no-renames', '-z', 'HEAD', '--']));
  const entries = [];
  for (let index = 0; index < trackedFields.length; index += 2) entries.push({ state: `tracked:${trackedFields[index]}`, path: trackedFields[index + 1] });
  for (const path of nulFields(git(repositoryRoot, ['ls-files', '--others', '--exclude-standard', '-z']))) entries.push({ state: 'untracked', path });
  const inputs = entries.filter(({ path }) => path && !evidenceOutput(path)).sort((left, right) => `${left.path}\0${left.state}`.localeCompare(`${right.path}\0${right.state}`));
  const scopeDiagnostics = validateCandidateScope(inputs.map(({ path }) => path));
  if (scopeDiagnostics.length) throw new Error('restricted path entered candidate digest scope');

  const digest = createHash('sha256');
  digest.update(`HEAD\0${head}\0`);
  for (const entry of inputs) {
    if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) throw new Error('candidate digest path escaped repository root');
    const absolute = resolve(repositoryRoot, entry.path);
    if (!(absolute === repositoryRoot || absolute.startsWith(`${repositoryRoot}${sep}`))) throw new Error('candidate digest path escaped repository root');
    let contentDigest = 'deleted';
    try {
      const info = await lstat(absolute);
      const resolvedParent = await realpath(dirname(absolute));
      if (!(resolvedParent === realRoot || resolvedParent.startsWith(`${realRoot}${sep}`))) throw new Error('candidate digest path escaped repository root');
      if (!info.isSymbolicLink()) {
        const resolvedFile = await realpath(absolute);
        if (!(resolvedFile === realRoot || resolvedFile.startsWith(`${realRoot}${sep}`))) throw new Error('candidate digest path escaped repository root');
      }
      const content = info.isSymbolicLink() ? Buffer.from(await readlink(absolute)) : await readFile(absolute);
      contentDigest = createHash('sha256').update(content).digest('hex');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    digest.update(`${entry.state}\0${entry.path}\0${contentDigest}\0`);
  }
  return { algorithm: 'sha256', digest: digest.digest('hex'), entries: inputs.length, head };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await candidateDigest(process.cwd());
  process.stdout.write(`candidate-content sha256 ${result.digest}; entries ${result.entries}; head ${result.head}\n`);
}
