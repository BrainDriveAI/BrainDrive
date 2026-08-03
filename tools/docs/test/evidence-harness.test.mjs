import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateEvidence, validateEvidenceTemplates, validateHarness, validateMilestoneRecord } from '../lib/rules/evidence.mjs';
import { validateSchema } from '../lib/schema.mjs';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/evidence/${name}`, import.meta.url), 'utf8'));

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

test('Milestone 2 record is present, structurally valid, and ends blocked when a required claimed journey fails', async () => {
  const path = 'docs/developers/verification/milestones/02-developer-journeys.md';
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  assert.deepEqual(validateMilestoneRecord(text, path), []);
  assert.equal(text.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');
  assert.match(text, /Tauri/i);
  assert.match(text, /OPEN-03/);
  assert.match(text, /OPEN-06/);
});

test('Milestone 3 remains blocked while the Milestone 2 dependency is blocked', async () => {
  const dependencyPath = 'docs/developers/verification/milestones/02-developer-journeys.md';
  const dependency = await readFile(new URL(`../../../${dependencyPath}`, import.meta.url), 'utf8');
  assert.equal(dependency.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');

  const path = 'docs/developers/verification/milestones/03-technical-boundaries.md';
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  assert.deepEqual(validateMilestoneRecord(text, path), []);
  assert.equal(text.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');
  assert.match(text, /Milestone 2/i);
  assert.match(text, /Tauri/i);
});

test('Milestone 4 remains blocked while the Milestone 3 dependency is blocked', async () => {
  const dependencyPath = 'docs/developers/verification/milestones/03-technical-boundaries.md';
  const dependency = await readFile(new URL(`../../../${dependencyPath}`, import.meta.url), 'utf8');
  assert.equal(dependency.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');

  const path = 'docs/developers/verification/milestones/04-github-governance.md';
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  assert.deepEqual(validateMilestoneRecord(text, path), []);
  assert.equal(text.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');
  assert.match(text, /Milestone 3/i);
  assert.match(text, /Tauri/i);
});

test('Milestone 5 remains blocked while the Milestone 4 dependency is blocked', async () => {
  const dependencyPath = 'docs/developers/verification/milestones/04-github-governance.md';
  const dependency = await readFile(new URL(`../../../${dependencyPath}`, import.meta.url), 'utf8');
  assert.equal(dependency.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');

  const path = 'docs/developers/verification/milestones/05-ai-agent-system.md';
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  assert.deepEqual(validateMilestoneRecord(text, path), []);
  assert.equal(text.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');
  assert.match(text, /Milestone 4/i);
  assert.match(text, /AIH-01 through AIH-10/i);
});

test('Milestone 6 remains blocked while the Milestone 5 dependency is blocked', async () => {
  const dependencyPath = 'docs/developers/verification/milestones/05-ai-agent-system.md';
  const dependency = await readFile(new URL(`../../../${dependencyPath}`, import.meta.url), 'utf8');
  assert.equal(dependency.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');

  const path = 'docs/developers/verification/milestones/06-validation-integration.md';
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  assert.deepEqual(validateMilestoneRecord(text, path), []);
  assert.equal(text.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');
  assert.match(text, /Milestone 5/i);
  assert.match(text, /DA-01 through DA-18/i);
});

test('Milestone 7 blocks release while the Milestone 6 dependency is blocked', async () => {
  const dependencyPath = 'docs/developers/verification/milestones/06-validation-integration.md';
  const dependency = await readFile(new URL(`../../../${dependencyPath}`, import.meta.url), 'utf8');
  assert.equal(dependency.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');

  const path = 'docs/developers/verification/milestones/07-release-gauntlet.md';
  const text = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
  assert.deepEqual(validateMilestoneRecord(text, path), []);
  assert.equal(text.trimEnd().split(/\r?\n/).at(-1), 'BLOCKED');
  assert.match(text, /Milestone 6/i);
  assert.match(text, /G-01 through G-14/i);
  assert.match(text, /v1-readiness\.md/i);
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
  const root = new URL('../../../', import.meta.url).pathname;
  assert.deepEqual(await validateEvidenceTemplates(root), []);
});
