import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { candidateDigest } from '../candidate-digest.mjs';

test('candidate content digest is stable and changes for tracked content, untracked files, and deletions', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-candidate-digest-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temporary });
    execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: temporary });
    execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: temporary });
    await writeFile(resolve(temporary, '.gitignore'), 'ignored*\n');
    await writeFile(resolve(temporary, 'tracked.md'), 'one\n');
    execFileSync('git', ['add', '.gitignore', 'tracked.md'], { cwd: temporary });
    execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: temporary });

    const clean = await candidateDigest(temporary);
    assert.deepEqual(await candidateDigest(temporary), clean);
    await writeFile(resolve(temporary, 'tracked.md'), 'two\n');
    const modified = await candidateDigest(temporary);
    assert.notEqual(modified.digest, clean.digest);
    assert.equal(modified.entries, 1);
    await writeFile(resolve(temporary, 'new.md'), 'new\n');
    const untracked = await candidateDigest(temporary);
    assert.notEqual(untracked.digest, modified.digest);
    assert.equal(untracked.entries, 2);
    await writeFile(resolve(temporary, 'ignored-private'), 'excluded\n');
    assert.deepEqual(await candidateDigest(temporary), untracked);
    await unlink(resolve(temporary, 'tracked.md'));
    const deleted = await candidateDigest(temporary);
    assert.notEqual(deleted.digest, untracked.digest);
    assert.deepEqual(await candidateDigest(temporary), deleted);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('candidate digest rejects a tracked file reached through an outside symlinked ancestor', async () => {
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
    await writeFile(resolve(outside, 'file.md'), 'outside-private-marker\n');
    await rm(resolve(temporary, 'nested'), { recursive: true });
    await symlink(outside, resolve(temporary, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(candidateDigest(temporary), (error) => /escaped repository root/.test(error.message) && !error.message.includes('outside-private-marker'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('candidate digest excludes self-referential Milestone 7 evidence outputs', async () => {
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

    const clean = await candidateDigest(temporary);
    for (const path of [
      'docs/developers/verification/milestones/07-release-gauntlet.md',
      'docs/developers/verification/m7-trace-matrix.md',
      'docs/developers/verification/v1-readiness.md',
    ]) await writeFile(resolve(temporary, path), 'final evidence\n');
    assert.deepEqual(await candidateDigest(temporary), clean);
    await writeFile(resolve(temporary, 'candidate.md'), 'changed candidate\n');
    assert.notEqual((await candidateDigest(temporary)).digest, clean.digest);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
