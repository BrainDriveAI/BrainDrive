import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGitHubContracts, validatePullRequestBody } from '../lib/rules/github.mjs';
import { formatSummary } from '../ci-summary.mjs';

const root = new URL('./fixtures/github/', import.meta.url);

test('valid GitHub collaboration fixture passes', async () => {
  assert.deepEqual(await validateGitHubContracts(new URL('valid/', root)), []);
});

test('missing docs impact fails', async () => {
  const diagnostics = await validateGitHubContracts(new URL('missing-docs-impact/', root));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-12' && item.message.includes('documentation impact')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-12' && item.message.includes('community forum')));
});

test('unsafe public security route fails without echoing sample evidence', async () => {
  const diagnostics = await validateGitHubContracts(new URL('unsafe-security-route/', root));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-12' && item.message.includes('Private Vulnerability Reporting')));
  assert.ok(diagnostics.every((item) => !item.message.includes('synthetic-sensitive-sample')));
});

test('missing owner role fails', async () => {
  const diagnostics = await validateGitHubContracts(new URL('missing-owner/', root));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-12' && item.message.includes('owner role')));
});

test('pull request body gate requires impact and exact evidence fields', () => {
  assert.deepEqual(validatePullRequestBody('## Documentation impact\n\nUpdated docs.\n\n### Exact verification evidence\n\n`npm run docs:verify` passed.'), []);
  const diagnostics = validatePullRequestBody('## Summary\n\nBehavior changed.');
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('documentation impact')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('exact verification evidence')));
});

test('unchanged or comment-only PR template content fails', async () => {
  const repositoryTemplate = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../../.github/pull_request_template.md', import.meta.url), 'utf8'));
  for (const body of [repositoryTemplate, '## Documentation impact\n<!-- fill me -->\n### No-impact reason\n<!-- fill me -->\n### Exact verification evidence\n<!-- fill me -->']) {
    const diagnostics = validatePullRequestBody(body);
    assert.ok(diagnostics.some((item) => item.rule === 'DA-13'));
  }
});

test('no-impact disposition requires a substantive reason', () => {
  const diagnostics = validatePullRequestBody('## Documentation impact\nNo documentation impact\n### No-impact reason\n\n### Exact verification evidence\n`npm test` passed');
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('no-impact reason')));
});

test('CI summary includes actionable sanitized diagnostics', () => {
  const summary = formatSummary({ status: 'fail', diagnostics: [{ rule: 'DA-04', path: 'docs/page.md', message: 'broken link', hint: 'correct the target' }], candidateManifest: { documentationGovernanceCandidates: ['docs/page.md'] } });
  assert.match(summary, /DA-04/);
  assert.match(summary, /docs\/page\.md/);
  assert.match(summary, /correct the target/);
});

test('CI summary cannot report pass when docs verification failed', () => {
  const summary = formatSummary({ status: 'pass', diagnostics: [], candidateManifest: { documentationGovernanceCandidates: ['docs/page.md'] } }, { verificationOutcome: 'failure' });
  assert.match(summary, /Status: \*\*FAIL\*\*/);
  assert.match(summary, /docs:verify step outcome: failure/);
});
