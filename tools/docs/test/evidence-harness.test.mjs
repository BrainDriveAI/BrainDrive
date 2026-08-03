import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateClaimedPlatformEvidence, validateEvidence, validateEvidenceTemplates, validateHarness, validateMilestoneRecord } from '../lib/rules/evidence.mjs';
import { validateSchema } from '../lib/schema.mjs';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/evidence/${name}`, import.meta.url), 'utf8'));
const repositoryCatalog = async () => JSON.parse(await readFile(new URL('../../../docs/developers/catalog.json', import.meta.url), 'utf8'));
const milestonePath = (number, slug) => `docs/developers/verification/milestones/${String(number).padStart(2, '0')}-${slug}.md`;
const readMilestone = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const terminalResult = (text) => text.trimEnd().split(/\r?\n/).at(-1);
const completionResult = (number) => `MILESTONE ${number} COMPLETE — NEXT LEGAL PROMPT: ${number + 1}`;

async function assertConditionalCascade(predecessor, successor) {
  const predecessorText = await readMilestone(predecessor.path);
  const successorText = await readMilestone(successor.path);
  const predecessorComplete = terminalResult(predecessorText) === completionResult(predecessor.number);

  assert.deepEqual(validateMilestoneRecord(successorText, successor.path), []);
  if (!predecessorComplete) {
    assert.equal(
      terminalResult(successorText),
      'BLOCKED',
      `Milestone ${successor.number} must remain blocked while Milestone ${predecessor.number} is incomplete`,
    );
  }

  return { predecessorComplete, successorText, successorResult: terminalResult(successorText) };
}

test('complete sanitized journey evidence passes', async () => {
  assert.deepEqual(validateEvidence(await fixture('valid-journey.json')), []);
});

test('missing evidence fields fail', async () => {
  const diagnostics = validateEvidence(await fixture('missing-fields.json'));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-18'));
});

test('unsanitized evidence fails without echoing contents', async () => {
  const diagnostics = validateEvidence(await fixture('unsanitized.json'));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-18'));
  assert.ok(diagnostics.every((item) => !item.message.includes('synthetic-sensitive-sample')));
});

test('AI harness defines AIH-01 through AIH-10', async () => {
  const harness = JSON.parse(await readFile(new URL('../harness/scenarios.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateHarness(harness), []);
  assert.deepEqual(harness.scenarios.map(({ id }) => id), Array.from({ length: 10 }, (_, index) => `AIH-${String(index + 1).padStart(2, '0')}`));
});

test('milestone records reject acceptance metadata and require one terminal result', () => {
  const diagnostics = validateMilestoneRecord('# Record\n\naccepted_by: somebody\n\nMILESTONE 0 COMPLETE — NEXT LEGAL PROMPT: 1\n', 'record.md');
  assert.ok(diagnostics.some((item) => item.rule === 'DA-18'));
});

test('milestone records accept the Milestone 1 terminal result and reject a mismatched milestone number', () => {
  const sections = ['## Candidate revision', '## Dependencies', '## Files changed', '## Commands and results', '## Reviews and adjudication', '## Global gates', '## Open items', '## Remaining risks'].join('\n\n');
  assert.deepEqual(validateMilestoneRecord(`# Milestone 1 record\n\n${sections}\n\nMILESTONE 1 COMPLETE — NEXT LEGAL PROMPT: 2\n`, 'docs/developers/verification/milestones/01-information-architecture.md'), []);
  const diagnostics = validateMilestoneRecord(`# Milestone 1 record\n\n${sections}\n\nMILESTONE 0 COMPLETE — NEXT LEGAL PROMPT: 1\n`, 'docs/developers/verification/milestones/01-information-architecture.md');
  assert.ok(diagnostics.some(({ rule }) => rule === 'DA-18'));
});

test('Milestone 2 record preserves its prior blocker and records the completed repository continuation', async () => {
  const path = 'docs/developers/verification/milestones/02-developer-journeys.md';
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  assert.deepEqual(validateMilestoneRecord(text, path), []);
  assert.equal(text.trimEnd().split(/\r?\n/).at(-1), 'MILESTONE 2 COMPLETE — NEXT LEGAL PROMPT: 3');
  assert.match(text, /Prior attempt result: BLOCKED/);
  assert.match(text, /Tauri/i);
  assert.match(text, /OPEN-03/);
  assert.match(text, /OPEN-06/);
});

test('a completed Milestone 2 reopens Prompt 3 without auto-promoting its untouched blocker record', async () => {
  const result = await assertConditionalCascade(
    { number: 2, path: milestonePath(2, 'developer-journeys') },
    { number: 3, path: milestonePath(3, 'technical-boundaries') },
  );
  assert.equal(result.predecessorComplete, true);
  assert.equal(result.successorResult, 'BLOCKED');
  assert.match(result.successorText, /rerun original Prompt 3/i);
  assert.match(result.successorText, /not (?:be )?promoted automatically/i);
});

test('claimed native Tauri platforms fail closed when reports are absent or supplied by WSL', async () => {
  const catalog = await repositoryCatalog();
  const claim = catalog.platformClaims.find(({ id }) => id === 'tauri-development');
  const missing = await fixture('missing-tauri-platform-reports.json');
  const wsl = await fixture('wsl-tauri-platform-reports.json');

  const missingDiagnostics = validateClaimedPlatformEvidence(claim, missing.reports);
  assert.deepEqual(
    missingDiagnostics.map(({ path }) => path),
    ['platform-evidence:J-05:windows', 'platform-evidence:J-05:macos'],
  );

  const wslDiagnostics = validateClaimedPlatformEvidence(claim, wsl.reports);
  assert.equal(wslDiagnostics.length, 2);
  assert.ok(wslDiagnostics.every(({ message }) => /native/i.test(message)));

  assert.deepEqual(validateClaimedPlatformEvidence(claim, [
    { journeyId: 'J-05', platform: 'windows', environment: 'native', disposition: 'pass' },
    { journeyId: 'J-05', platform: 'macos', environment: 'native', disposition: 'pass' },
  ]), []);
});

test('incomplete predecessors keep later untouched milestone records blocked until each prompt is rerun', async () => {
  const chain = [
    [{ number: 3, path: milestonePath(3, 'technical-boundaries') }, { number: 4, path: milestonePath(4, 'github-governance') }, [/Milestone 3/i, /Tauri/i]],
    [{ number: 4, path: milestonePath(4, 'github-governance') }, { number: 5, path: milestonePath(5, 'ai-agent-system') }, [/Milestone 4/i, /AIH-01 through AIH-10/i]],
    [{ number: 5, path: milestonePath(5, 'ai-agent-system') }, { number: 6, path: milestonePath(6, 'validation-integration') }, [/Milestone 5/i, /DA-01 through DA-18/i]],
    [{ number: 6, path: milestonePath(6, 'validation-integration') }, { number: 7, path: milestonePath(7, 'release-gauntlet') }, [/Milestone 6/i, /G-01 through G-14/i, /v1-readiness\.md/i]],
  ];

  for (const [predecessor, successor, requiredPatterns] of chain) {
    const result = await assertConditionalCascade(predecessor, successor);
    assert.equal(result.predecessorComplete, false);
    assert.equal(result.successorResult, 'BLOCKED');
    for (const pattern of requiredPatterns) assert.match(result.successorText, pattern);
  }
});

test('evidence and harness schemas reject malformed types and empty scenarios', async () => {
  const evidenceSchema = JSON.parse(await readFile(new URL('../schemas/evidence.schema.json', import.meta.url), 'utf8'));
  const harnessSchema = JSON.parse(await readFile(new URL('../schemas/ai-harness.schema.json', import.meta.url), 'utf8'));
  assert.ok(validateSchema(evidenceSchema, { schemaVersion: 1, kind: 'journey', steps: 'not-an-array' }, 'evidence').length > 0);
  assert.ok(validateSchema(harnessSchema, { schemaVersion: 1, authority: 'test', scenarios: [] }, 'harness').length > 0);
  assert.ok(validateHarness({ schemaVersion: 1, authority: 'test', scenarios: [] }).some((item) => item.rule === 'DA-18'));
});

test('evidence rejects private paths, network identifiers, and credential-shaped output safely', () => {
  const record = { ...{}, schemaVersion: 1, kind: 'journey', id: 'J-X', revision: 'abc', branchOrTag: 'dev', environment: 'host 192.0.2.10', startState: '/home/person/private', steps: ['run'], expected: 'pass', actual: 'Authorization: Bearer synthetic-private-value', interventions: [], confusionPoints: [], disposition: 'fail', sanitization: 'none' };
  const diagnostics = validateEvidence(record);
  assert.ok(diagnostics.some((item) => item.rule === 'DA-18'));
  assert.ok(diagnostics.every((item) => !item.message.includes('synthetic-private-value')));
});

test('evidence rejects Windows owner paths, credential-key assignments, and private hostnames without echoing them', () => {
  const base = { schemaVersion: 1, kind: 'journey', id: 'J-X', revision: 'abc', branchOrTag: 'dev', environment: 'synthetic', startState: 'clean', command: 'synthetic check', workingDirectory: 'fixture root', toolVersions: 'synthetic tool 1', steps: ['run'], expected: 'pass', actual: 'fail', interventions: [], confusionPoints: [], cleanup: 'none', remainingRisk: 'none', disposition: 'fail', sanitization: 'none' };
  for (const actual of ['C:\\Users\\owner\\private.txt', 'OWNER_API_KEY=synthetic-private-value', 'https://owner-workstation.internal/status', 'host owner-workstation.internal']) {
    const diagnostics = validateEvidence({ ...base, actual });
    assert.ok(diagnostics.some((item) => item.rule === 'DA-18'));
    assert.ok(diagnostics.every((item) => !item.message.includes('synthetic-private-value')));
  }
});

test('milestone sanitization rejects raw Windows owner paths and bare private hostnames', () => {
  const sections = ['## Candidate revision', '## Dependencies', '## Files changed', '## Commands and results', '## Reviews and adjudication', '## Global gates', '## Open items', '## Remaining risks'].join('\n\n');
  for (const value of ['C:\\Users\\owner\\private.txt', 'host owner-workstation.internal']) {
    const diagnostics = validateMilestoneRecord(`# Record\n\n${sections}\n\n${value}\n\nBLOCKED\n`, 'docs/developers/verification/milestones/02-synthetic.md');
    assert.ok(diagnostics.some((item) => item.rule === 'DA-18'));
    assert.ok(diagnostics.every((item) => !item.message.includes(value)));
  }
});

test('journey evidence requires execution context, cleanup, and remaining risk', async () => {
  const valid = await fixture('valid-journey.json');
  for (const field of ['command', 'workingDirectory', 'toolVersions', 'cleanup', 'remainingRisk']) {
    const record = { ...valid };
    delete record[field];
    const diagnostics = validateEvidence(record);
    assert.ok(diagnostics.some((item) => item.rule === 'DA-18' && item.message.includes(field)));
  }
});

test('tracked evidence templates expose required public-safe fields', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  assert.deepEqual(await validateEvidenceTemplates(root), []);
});
