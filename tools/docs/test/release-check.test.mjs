import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReleaseEvidence } from '../release-check.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('release evidence precursor fails closed across pre- and post-AIH evidence phases', async () => {
  const result = await checkReleaseEvidence(repositoryRoot);
  assert.equal(result.status, 'blocked');
  const platformReportExists = existsSync(new URL(
    '../../../docs/developers/verification/platform-reports/windows-j05.json',
    import.meta.url,
  ));
  assert.deepEqual(
    result.diagnostics.filter(({ rule }) => rule === 'G-07').map(({ path }) => path),
    platformReportExists ? [] : ['platform-evidence:J-05:windows'],
  );
  assert.deepEqual(
    result.diagnostics.filter(({ rule, path }) => rule === 'G-05' && path.startsWith('human-evidence:')).map(({ path }) => path),
    Array.from({ length: 8 }, (_, index) => {
      const number = String(index + 1).padStart(2, '0');
      return {
        diagnosticPath: `human-evidence:REV-${number}`,
        reportExists: existsSync(new URL(
          `../../../docs/developers/verification/human-reviews/rev-${number}.json`,
          import.meta.url,
        )),
      };
    }).filter(({ reportExists }) => !reportExists).map(({ diagnosticPath }) => diagnosticPath),
  );
  const expectedAiPaths = Array.from(
    { length: 10 },
    (_, index) => `docs/developers/verification/ai-agent-scorecards/aih-${String(index + 1).padStart(2, '0')}.md`,
  );
  const staleAiPaths = [...new Set(
    result.diagnostics.filter(({ rule }) => rule === 'G-10').map(({ path }) => path),
  )];
  if (staleAiPaths.length > 0) assert.deepEqual(staleAiPaths, expectedAiPaths);
  assert.ok(result.diagnostics.some(({ rule, path }) => rule === 'G-13' && path.endsWith('v1-readiness.md')));
  assert.match(result.sourceTestRevision, /^[a-f0-9]{40}$/);
  assert.match(result.sourceCandidateProof, /^source-candidate sha256 [a-f0-9]{64}; entries \d+; revision [a-f0-9]{40}$/);
  assert.match(result.evidenceRevision, /^[a-f0-9]{40}$/);
});
