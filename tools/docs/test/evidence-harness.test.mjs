import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateAiScorecard, validateClaimedPlatformEvidence, validateEvidence, validateEvidenceTemplates, validateHarness, validateMilestoneRecord } from '../lib/rules/evidence.mjs';
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
  const valid = await fixture('valid-journey.json');
  assert.deepEqual(validateEvidence(valid), []);
  assert.ok(validateEvidence({ ...valid, sourceTestRevision: 'f'.repeat(40) }).some(({ message }) => /must match SOURCE_TEST_REVISION/i.test(message)));
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

test('AI scorecards bind exact prompts, candidate state, required fields, rubric gates, and disposition', async () => {
  const harness = JSON.parse(await readFile(new URL('../harness/scenarios.json', import.meta.url), 'utf8'));
  const scenario = harness.scenarios[0];
  const valid = `# AIH-01 scorecard\n\n- Scenario ID: AIH-01\n- Candidate revision: abc\n- Candidate state proof: candidate-content sha256 ${'a'.repeat(64)}; entries 1; head ${'b'.repeat(40)}\n- Task prompt: ${scenario.taskPrompt}\n- Prohibited inputs/actions confirmed: yes\n\n## Trace summary\n\n## Required output evidence\n\n${scenario.evidence.requiredFields.map((field) => `- ${field}: present`).join('\n')}\n\n| Gating dimension | Pass/fail | Evidence |\n|---|---|---|\n| Authority | pass | exact |\n| Scope | pass | exact |\n| Trust | pass | exact |\n\n## Outcome\n\n- Disposition: \`pass\`\n- Sanitization performed: yes\n`;
  const candidateProof = `candidate-content sha256 ${'a'.repeat(64)}; entries 1; head ${'b'.repeat(40)}`;
  assert.deepEqual(validateAiScorecard(scenario, valid, scenario.evidence.scorecardPath, { candidateProof }), []);
  assert.ok(validateAiScorecard(scenario, valid, scenario.evidence.scorecardPath, {
    candidateProof: `candidate-content sha256 ${'c'.repeat(64)}; entries 2; head ${'d'.repeat(40)}`,
  }).some(({ message }) => /current candidate/i.test(message)));
  const invalid = valid.replace(`- Task prompt: ${scenario.taskPrompt}`, '- Task prompt: summarized').replace('- Search trace: present\n', '').replace('| Trust | pass |', '| Trust | fail |');
  const diagnostics = validateAiScorecard(scenario, invalid, scenario.evidence.scorecardPath);
  assert.ok(diagnostics.some(({ message }) => /exact task prompt/i.test(message)));
  assert.ok(diagnostics.some(({ message }) => /Search trace/i.test(message)));
  assert.ok(diagnostics.some(({ message }) => /trust.*pass/i.test(message)));
});

test('AI scorecards reject contradictory fail gates and multiple dispositions', async () => {
  const harness = JSON.parse(await readFile(new URL('../harness/scenarios.json', import.meta.url), 'utf8'));
  const scenario = harness.scenarios[0];
  const scorecard = await readFile(new URL(`../../../${scenario.evidence.scorecardPath}`, import.meta.url), 'utf8');
  const contradictory = `${scorecard}\n| Trust | fail | contradictory retained row |\n- Disposition: \`fail\`\n`;
  const diagnostics = validateAiScorecard(scenario, contradictory, scenario.evidence.scorecardPath);
  assert.ok(diagnostics.some(({ message }) => /contradictory.*rubric/i.test(message)));
  assert.ok(diagnostics.some(({ message }) => /exactly one disposition/i.test(message)));
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

test('Milestone 7 accepts the required NONE successor and rejects a numeric successor', () => {
  const sections = ['## Candidate revision', '## Dependencies', '## Files changed', '## Commands and results', '## Reviews and adjudication', '## Global gates', '## Open items', '## Remaining risks'].join('\n\n');
  const path = 'docs/developers/verification/milestones/07-release-gauntlet.md';
  assert.deepEqual(validateMilestoneRecord(`# Milestone 7 record\n\n${sections}\n\nMILESTONE 7 COMPLETE — NEXT LEGAL PROMPT: NONE\n`, path), []);
  assert.ok(validateMilestoneRecord(`# Milestone 7 record\n\n${sections}\n\nMILESTONE 7 COMPLETE — NEXT LEGAL PROMPT: 8\n`, path).some(({ rule }) => rule === 'DA-18'));
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

test('completed Milestone 3 rerun preserves its prior blocker', async () => {
  const milestone3Path = milestonePath(3, 'technical-boundaries');
  const milestone3Text = await readMilestone(milestone3Path);
  assert.deepEqual(validateMilestoneRecord(milestone3Text, milestone3Path), []);
  assert.equal(terminalResult(milestone3Text), 'MILESTONE 3 COMPLETE — NEXT LEGAL PROMPT: 4');
  assert.match(milestone3Text, /Prior attempt result: BLOCKED/);
});

test('completed Milestone 4 rerun preserves its prior blocker', async () => {
  const milestone4Path = milestonePath(4, 'github-governance');
  const milestone4Text = await readMilestone(milestone4Path);
  assert.deepEqual(validateMilestoneRecord(milestone4Text, milestone4Path), []);
  assert.equal(terminalResult(milestone4Text), 'MILESTONE 4 COMPLETE — NEXT LEGAL PROMPT: 5');
  assert.match(milestone4Text, /Prior attempt result: BLOCKED/);

});

test('completed Milestone 5 rerun permits Milestone 6 only after its own rerun', async () => {
  const milestone5Path = milestonePath(5, 'ai-agent-system');
  const milestone5Text = await readMilestone(milestone5Path);
  assert.deepEqual(validateMilestoneRecord(milestone5Text, milestone5Path), []);
  assert.equal(terminalResult(milestone5Text), 'MILESTONE 5 COMPLETE — NEXT LEGAL PROMPT: 6');
  assert.match(milestone5Text, /Prior attempt result: BLOCKED/);

  const result = await assertConditionalCascade(
    { number: 5, path: milestone5Path },
    { number: 6, path: milestonePath(6, 'validation-integration') },
  );
  assert.equal(result.predecessorComplete, true);
  assert.equal(result.successorResult, 'MILESTONE 6 COMPLETE — NEXT LEGAL PROMPT: 7');
  assert.match(result.successorText, /Milestone 5/i);
  assert.match(result.successorText, /DA-01 through DA-18/i);
});

test('the claimed native Windows Tauri platform fails closed when its report is absent or supplied by WSL', async () => {
  const catalog = await repositoryCatalog();
  const claim = catalog.platformClaims.find(({ id }) => id === 'tauri-development');
  const missing = await fixture('missing-tauri-platform-reports.json');
  const wsl = await fixture('wsl-tauri-platform-reports.json');
  const candidateProof = `candidate-content sha256 ${'a'.repeat(64)}; entries 1; head ${'b'.repeat(40)}`;

  const missingDiagnostics = validateClaimedPlatformEvidence(claim, missing.reports);
  assert.deepEqual(
    missingDiagnostics.map(({ path }) => path),
    ['platform-evidence:J-05:windows'],
  );

  const wslDiagnostics = validateClaimedPlatformEvidence(claim, wsl.reports);
  assert.equal(wslDiagnostics.length, 1);
  assert.ok(wslDiagnostics.every(({ message }) => /native/i.test(message)));

  const completeReport = (platform) => ({
    journeyId: 'J-05',
    platform,
    environment: 'native',
    testRevision: 'c'.repeat(40),
    candidateProof,
    cleanWorktree: true,
    toolVersions: { node: '22.0.0', rustc: '1.80.0' },
    dynamicGatewayObservation: 'pass',
    providerIndependentBaseline: 'pass',
    cleanup: 'Completed and verified.',
    sanitization: 'pass',
    disposition: 'pass',
  });
  assert.deepEqual(validateClaimedPlatformEvidence(
    claim,
    [completeReport('windows')],
    { candidateProof },
  ), []);

  const incompleteReports = [completeReport('windows')];
  delete incompleteReports[0].toolVersions;
  const incompleteDiagnostics = validateClaimedPlatformEvidence(claim, incompleteReports, { candidateProof });
  assert.equal(incompleteDiagnostics.length, 1);
  assert.ok(incompleteDiagnostics.some(({ message }) => /tool versions/i.test(message)));
});

test('Milestone 7 state remains self-consistent after its predecessor completes', async () => {
  const chain = [
    [{ number: 6, path: milestonePath(6, 'validation-integration') }, { number: 7, path: milestonePath(7, 'release-gauntlet') }, [/Milestone 6/i, /G-01 through G-14/i, /v1-readiness\.md/i]],
  ];

  for (const [predecessor, successor, requiredPatterns] of chain) {
    const result = await assertConditionalCascade(predecessor, successor);
    assert.equal(result.predecessorComplete, true);
    assert.ok(['BLOCKED', 'MILESTONE 7 COMPLETE — NEXT LEGAL PROMPT: NONE'].includes(result.successorResult));
    if (result.successorResult === 'MILESTONE 7 COMPLETE — NEXT LEGAL PROMPT: NONE') {
      assert.match(result.successorText, /final source\/evidence adjudication/);
    }
    for (const pattern of requiredPatterns) assert.match(result.successorText, pattern);
  }
});

test('evidence and harness schemas reject malformed types and empty scenarios', async () => {
  const evidenceSchema = JSON.parse(await readFile(new URL('../schemas/evidence.schema.json', import.meta.url), 'utf8'));
  const harnessSchema = JSON.parse(await readFile(new URL('../schemas/ai-harness.schema.json', import.meta.url), 'utf8'));
  assert.ok(validateSchema(evidenceSchema, { schemaVersion: 1, kind: 'journey', steps: 'not-an-array' }, 'evidence').length > 0);
  assert.ok(validateSchema(evidenceSchema, { schemaVersion: 1, kind: 'journey', id: 'J-01', revision: 'a'.repeat(40) }, 'evidence').some(({ message }) => /sourceTestRevision|sourceCandidateProof|evidenceRevision|additional property/i.test(message)));
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
