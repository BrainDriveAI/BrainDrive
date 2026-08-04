import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReleaseEvidence } from '../release-check.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('release evidence precursor fails closed for missing platform, human, readiness, and stale AI evidence', async () => {
  const result = await checkReleaseEvidence(repositoryRoot);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(
    result.diagnostics.filter(({ rule }) => rule === 'G-07').map(({ path }) => path),
    ['platform-evidence:J-05:windows'],
  );
  assert.deepEqual(
    result.diagnostics.filter(({ rule, path }) => rule === 'G-05' && path.startsWith('human-evidence:')).map(({ path }) => path),
    Array.from({ length: 8 }, (_, index) => `human-evidence:REV-${String(index + 1).padStart(2, '0')}`),
  );
  assert.equal(new Set(result.diagnostics.filter(({ rule }) => rule === 'G-10').map(({ path }) => path)).size, 10);
  assert.ok(result.diagnostics.some(({ rule, path }) => rule === 'G-13' && path.endsWith('v1-readiness.md')));
  assert.match(result.sourceTestRevision, /^[a-f0-9]{40}$/);
  assert.match(result.sourceCandidateProof, /^source-candidate sha256 [a-f0-9]{64}; entries \d+; revision [a-f0-9]{40}$/);
  assert.match(result.evidenceRevision, /^[a-f0-9]{40}$/);
});
