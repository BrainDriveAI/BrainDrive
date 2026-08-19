import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkReleaseEvidence } from '../release-check.mjs';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('release evidence precursor reports the current evidence phase and fails closed on diagnostics', async () => {
  const result = await checkReleaseEvidence(repositoryRoot);
  assert.equal(result.status, result.diagnostics.length === 0 ? 'pass' : 'blocked');
  const missingPlatformReports = ['windows', 'macos'].filter((platform) => !existsSync(new URL(
    `../../../docs/developers/verification/platform-reports/${platform}-j05.json`,
    import.meta.url,
  )));
  const platformDiagnostics = result.diagnostics.filter(({ rule }) => rule === 'G-07').map(({ path }) => path);
  for (const platform of missingPlatformReports) assert.ok(platformDiagnostics.includes(`platform-evidence:J-05:${platform}`));
  assert.ok(platformDiagnostics.every((path) => [
    'platform-evidence:J-05:windows',
    'platform-evidence:J-05:macos',
    'docs/developers/verification/platform-reports/windows-j05.json',
    'docs/developers/verification/platform-reports/macos-j05.json',
  ].includes(path)));
  const humanDiagnostics = result.diagnostics.filter(({ rule, path }) => rule === 'G-05' && path.startsWith('human-evidence:')).map(({ path }) => path);
  for (let index = 1; index <= 8; index += 1) {
    const number = String(index).padStart(2, '0');
    const reportExists = existsSync(new URL(`../../../docs/developers/verification/human-reviews/rev-${number}.json`, import.meta.url));
    if (!reportExists) assert.ok(humanDiagnostics.includes(`human-evidence:REV-${number}`));
  }
  assert.ok(humanDiagnostics.every((path) => /^human-evidence:REV-0[1-8]$/.test(path)));
  const expectedAiPaths = Array.from(
    { length: 10 },
    (_, index) => `docs/developers/verification/ai-agent-scorecards/aih-${String(index + 1).padStart(2, '0')}.md`,
  );
  const staleAiPaths = [...new Set(
    result.diagnostics.filter(({ rule }) => rule === 'G-10').map(({ path }) => path),
  )];
  if (staleAiPaths.length > 0) assert.deepEqual(staleAiPaths, expectedAiPaths);
  const readinessExists = existsSync(new URL(
    '../../../docs/developers/verification/v1-readiness.md',
    import.meta.url,
  ));
  if (!readinessExists) assert.ok(result.diagnostics.some(({ rule, path }) => rule === 'G-13' && path.endsWith('v1-readiness.md')));
  assert.match(result.sourceTestRevision, /^[a-f0-9]{40}$/);
  assert.match(result.sourceCandidateProof, /^source-candidate sha256 [a-f0-9]{64}; entries \d+; revision [a-f0-9]{40}$/);
  assert.match(result.evidenceRevision, /^[a-f0-9]{40}$/);
});
