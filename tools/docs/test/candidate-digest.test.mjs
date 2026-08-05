import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { sourceCandidateIdentity } from '../candidate-digest.mjs';

test('source candidate proof is stable for an immutable commit and changes only after a new source commit', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-candidate-digest-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temporary });
    execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: temporary });
    execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: temporary });
    await writeFile(resolve(temporary, '.gitignore'), 'ignored*\n');
    await writeFile(resolve(temporary, 'tracked.md'), 'one\n');
    execFileSync('git', ['add', '.gitignore', 'tracked.md'], { cwd: temporary });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: temporary });

    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: temporary, encoding: 'utf8' }).trim();
    const clean = await sourceCandidateIdentity(temporary, sourceRevision);
    assert.deepEqual(await sourceCandidateIdentity(temporary, sourceRevision), clean);
    await writeFile(resolve(temporary, 'tracked.md'), 'two\n');
    await writeFile(resolve(temporary, 'new.md'), 'new\n');
    await writeFile(resolve(temporary, 'ignored-private'), 'excluded\n');
    assert.deepEqual(await sourceCandidateIdentity(temporary, sourceRevision), clean);
    execFileSync('git', ['add', 'tracked.md', 'new.md'], { cwd: temporary });
    execFileSync('git', ['commit', '-qm', 'next source'], { cwd: temporary });
    const next = await sourceCandidateIdentity(temporary, 'HEAD');
    assert.notEqual(next.digest, clean.digest);
    assert.equal(next.entries, clean.entries + 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('source candidate proof reads the commit tree without following a worktree symlink escape', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-candidate-digest-root-'));
  const outside = await mkdtemp(resolve(tmpdir(), 'docs-candidate-digest-outside-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temporary });
    execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: temporary });
    execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: temporary });
    await mkdir(resolve(temporary, 'nested'));
    await writeFile(resolve(temporary, 'nested/file.md'), 'inside\n');
    execFileSync('git', ['add', 'nested/file.md'], { cwd: temporary });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: temporary });
    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: temporary, encoding: 'utf8' }).trim();
    const clean = await sourceCandidateIdentity(temporary, sourceRevision);
    await writeFile(resolve(outside, 'file.md'), 'outside-private-marker\n');
    await rm(resolve(temporary, 'nested'), { recursive: true });
    await symlink(outside, resolve(temporary, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.deepEqual(await sourceCandidateIdentity(temporary, sourceRevision), clean);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('source candidate proof excludes declared release evidence outputs', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-candidate-digest-release-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temporary });
    execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: temporary });
    execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: temporary });
    await mkdir(resolve(temporary, 'docs/developers/verification/milestones'), { recursive: true });
    for (const path of [
      'docs/developers/verification/milestones/07-release-gauntlet.md',
      'docs/developers/verification/m7-trace-matrix.md',
      'docs/developers/verification/v1-readiness.md',
    ]) await writeFile(resolve(temporary, path), 'initial\n');
    await writeFile(resolve(temporary, 'candidate.md'), 'initial\n');
    execFileSync('git', ['add', '.'], { cwd: temporary });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: temporary });

    const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: temporary, encoding: 'utf8' }).trim();
    const clean = await sourceCandidateIdentity(temporary, sourceRevision);
    for (const path of [
      'docs/developers/verification/milestones/07-release-gauntlet.md',
      'docs/developers/verification/m7-trace-matrix.md',
      'docs/developers/verification/v1-readiness.md',
    ]) await writeFile(resolve(temporary, path), 'final evidence\n');
    assert.deepEqual(await sourceCandidateIdentity(temporary, sourceRevision), clean);
    await writeFile(resolve(temporary, 'candidate.md'), 'changed candidate\n');
    execFileSync('git', ['add', '.'], { cwd: temporary });
    execFileSync('git', ['commit', '-qm', 'evidence and source change'], { cwd: temporary });
    assert.notEqual((await sourceCandidateIdentity(temporary, 'HEAD')).digest, clean.digest);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
