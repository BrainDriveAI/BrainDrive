import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReleaseEvidence } from '../release-check.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('release evidence precursor fails closed for missing platform reports and stale AI scorecards', async () => {
  const result = await checkReleaseEvidence(repositoryRoot);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(
    result.diagnostics.filter(({ rule }) => rule === 'G-07').map(({ path }) => path),
    ['platform-evidence:J-05:windows', 'platform-evidence:J-05:macos'],
  );
  assert.equal(result.diagnostics.filter(({ rule }) => rule === 'G-10').length, 10);
  assert.ok(result.diagnostics.filter(({ rule }) => rule === 'G-10').every(({ message }) => /current candidate/i.test(message)));
});
