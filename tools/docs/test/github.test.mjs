import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { freshnessNoImpactReason, validateGitHubContracts, validateIssueFormStructure, validatePullRequestBody } from '../lib/rules/github.mjs';
import { validateFreshness } from '../lib/rules/freshness.mjs';
import { formatSummary } from '../ci-summary.mjs';

const root = new URL('./fixtures/github/', import.meta.url);

test('GitHub collaboration surfaces avoid branch-pinned Code of Conduct links', async () => {
  const repositoryRoot = new URL('../../../', import.meta.url);
  const pullRequestTemplate = await readFile(new URL('.github/pull_request_template.md', repositoryRoot), 'utf8');
  const bugForm = await readFile(new URL('.github/ISSUE_TEMPLATE/bug_report.yml', repositoryRoot), 'utf8');
  for (const content of [pullRequestTemplate, bugForm]) {
    assert.doesNotMatch(content, /blob\/main\/CODE_OF_CONDUCT\.md/);
    assert.match(content, /CODE_OF_CONDUCT\.md/);
  }
});
const completePullRequestBody = `## Documentation impact

Updated the canonical governance page and catalog mappings.

### No-impact reason

Not applicable because documentation changed.

## Automated verification evidence

\`npm run docs:verify\` passed from \`builds/typescript\`.

## Manual verification evidence

Reviewed rendered headings and public links locally.

### Migration implications

Existing catalog entries receive an explicit migration disposition.

### Configuration implications

None: configuration behavior remains unchanged.

### Provider implications

None: provider behavior and credentials remain unchanged.

### Security implications

Public routing remains sanitized and contains no sensitive evidence.

### Release implications

Public version and tag guidance changed; release execution did not occur.

## Remaining risk

GitHub settings still require maintainer verification.`;

test('valid GitHub collaboration fixture passes', async () => {
  assert.deepEqual(await validateGitHubContracts(new URL('valid/', root)), []);
});

test('repository issue form has valid structure with both required preflight acknowledgments', async () => {
  assert.deepEqual(await validateGitHubContracts(new URL('../../../', import.meta.url)), []);
});

test('issue form structure rejects a checkbox stranded beneath validations', () => {
  const diagnostics = validateIssueFormStructure('body:\n  - type: checkboxes\n    id: preflight\n    attributes:\n      options:\n        - label: I searched existing issues for this documentation problem.\n          required: true\n    validations:\n      required: true\n        - label: I removed credentials from evidence.\n          required: true\n');
  assert.ok(diagnostics.some((item) => item.rule === 'DA-12' && /checkbox label|sanitized-evidence/.test(item.message)));
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

test('GitHub workflow contract requires classified documentation requests and separate impact evidence', async () => {
  const diagnostics = await validateGitHubContracts(new URL('incomplete-governance/', root));
  for (const field of [
    'report-type',
    'automated verification evidence',
    'manual verification evidence',
    'migration implications',
    'configuration implications',
    'provider implications',
    'security implications',
    'release implications',
    'remaining risk',
  ]) {
    assert.ok(diagnostics.some((item) => item.rule === 'DA-12' && item.message.includes(field)), `missing diagnostic for ${field}`);
  }
});

test('pull request body gate requires impact and separate automated/manual evidence fields', () => {
  assert.deepEqual(validatePullRequestBody(completePullRequestBody), []);
  const diagnostics = validatePullRequestBody('## Summary\n\nBehavior changed.');
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('documentation impact')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('automated verification evidence')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('manual verification evidence')));
});

test('pull request body gate requires every implication and remaining-risk section to be substantive', () => {
  const diagnostics = validatePullRequestBody('## Documentation impact\n\nUpdated docs.\n\n### Automated verification evidence\n\n`npm run docs:verify` passed.\n\n### Manual verification evidence\n\nStatic review passed.\n\n### Migration implications\n\nx');
  for (const field of ['migration implications', 'configuration implications', 'provider implications', 'security implications', 'release implications', 'remaining risk']) {
    assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes(field)), `missing diagnostic for ${field}`);
  }
});

test('unchanged or comment-only PR template content fails', async () => {
  const repositoryTemplate = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../../../.github/pull_request_template.md', import.meta.url), 'utf8'));
  for (const body of [repositoryTemplate, '## Documentation impact\n<!-- fill me -->\n### No-impact reason\n<!-- fill me -->\n### Automated verification evidence\n<!-- fill me -->\n### Manual verification evidence\n<!-- fill me -->']) {
    const diagnostics = validatePullRequestBody(body);
    assert.ok(diagnostics.some((item) => item.rule === 'DA-13'));
  }
});

test('no-impact disposition requires a substantive reason', () => {
  const diagnostics = validatePullRequestBody('## Documentation impact\nNo documentation impact\n### No-impact reason\n\n### Automated verification evidence\n`npm test` passed\n### Manual verification evidence\nNone: static-only change.');
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('no-impact reason')));
});

test('substantive no-impact disposition is accepted and exposed to freshness', () => {
  const body = completePullRequestBody
    .replace('Updated the canonical governance page and catalog mappings.', 'No documentation impact.')
    .replace('Not applicable because documentation changed.', 'Only test fixture prose changed; behavior and mapped authority remain unchanged.');
  assert.deepEqual(validatePullRequestBody(body), []);
  assert.match(freshnessNoImpactReason(body), /mapped authority remain unchanged/);
});

test('an unrelated no-impact reason cannot bypass source-to-document freshness', () => {
  const body = `${completePullRequestBody.replace('Updated the canonical governance page and catalog mappings.', 'Updated unrelated docs.').replace('Not applicable because documentation changed.', 'Not applicable for this change.')}`;
  assert.equal(freshnessNoImpactReason(body), '');
  const diagnostics = validateFreshness({
    changedPaths: ['CONTRIBUTING.md'],
    changedDocs: ['CONTRIBUTING.md'],
    sourceMappings: [{ source: 'CONTRIBUTING.md', documentation: 'docs/developers/governance.md' }],
    noImpactReason: freshnessNoImpactReason(body),
  });
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('docs/developers/governance.md')));
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

test('CI summary redacts credential-shaped diagnostic content', () => {
  const sensitive = 'OWNER_API_KEY=synthetic-private-value';
  const summary = formatSummary({
    status: 'fail',
    diagnostics: [{ rule: 'DA-15', path: 'docs/page.md', message: `rejected ${sensitive}`, hint: `remove ${sensitive}` }],
    candidateManifest: { documentationGovernanceCandidates: ['docs/page.md'] },
  });
  assert.doesNotMatch(summary, /synthetic-private-value/);
  assert.match(summary, /REDACTED/);
});
