import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  adjudicateRevisionCompatibility,
  adjudicatePlatformEvidenceCarryForward,
  classifyEvidenceImpact,
  isApprovedEvidenceOutput,
  readEvidenceJson,
  sourceCandidateIdentity,
  validateHumanReview,
  validatePlatformReport,
} from '../lib/evidence-identity.mjs';
import { validateAiScorecard } from '../lib/rules/evidence.mjs';

const sha = (character) => character.repeat(40);
const proof = (character = 'a', revision = sha('b')) => `source-candidate sha256 ${character.repeat(64)}; entries 1; revision ${revision}`;

test('evidence records do not embed the self-referential EVIDENCE_REVISION', async () => {
  for (const name of ['evidence.schema.json', 'platform-report.schema.json', 'human-review.schema.json']) {
    const schema = JSON.parse(await readFile(new URL(`../schemas/${name}`, import.meta.url), 'utf8'));
    assert.equal(schema.properties.evidenceRevision, undefined, name);
    assert.ok(!schema.required.includes('evidenceRevision'), name);
  }
});

test('only declared evidence IDs enter the approved output allowlist', () => {
  assert.equal(isApprovedEvidenceOutput('docs/developers/verification/ai-agent-scorecards/aih-10.md'), true);
  assert.equal(isApprovedEvidenceOutput('docs/developers/verification/human-reviews/rev-08.json'), true);
  assert.equal(isApprovedEvidenceOutput('docs/developers/verification/ai-agent-scorecards/aih-zz.md'), false);
  assert.equal(isApprovedEvidenceOutput('docs/developers/verification/human-reviews/rev-99.json'), false);
});

async function repositoryFixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'docs-evidence-identity-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'synthetic@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Synthetic Test'], { cwd: root });
  await writeFile(resolve(root, 'source.txt'), 'source\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'source'], { cwd: root });
  return root;
}

function commit(root, message) {
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', message], { cwd: root });
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

test('platform and human evidence outputs cannot change the recorded source candidate proof', async () => {
  const root = await repositoryFixture();
  try {
    const sourceTestRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const before = await sourceCandidateIdentity(root, sourceTestRevision);
    assert.match(before.sourceCandidateProof, /^source-candidate sha256 [a-f0-9]{64}; entries \d+; revision [a-f0-9]{40}$/);
    await mkdir(resolve(root, 'docs/developers/verification/platform-reports'), { recursive: true });
    await mkdir(resolve(root, 'docs/developers/verification/human-reviews'), { recursive: true });
    await writeFile(resolve(root, 'docs/developers/verification/platform-reports/windows-j05.json'), '{"synthetic":true}\n');
    await writeFile(resolve(root, 'docs/developers/verification/human-reviews/rev-01.json'), '{"synthetic":true}\n');
    commit(root, 'evidence');
    assert.deepEqual(await sourceCandidateIdentity(root, sourceTestRevision), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a clean immutable source revision can carry forward to an evidence-only revision', async () => {
  const root = await repositoryFixture();
  try {
    const sourceTestRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    await mkdir(resolve(root, 'docs/developers/verification/platform-reports'), { recursive: true });
    await writeFile(resolve(root, 'docs/developers/verification/platform-reports/windows-j05.json'), '{"synthetic":true}\n');
    const evidenceRevision = commit(root, 'evidence only');
    const result = await adjudicateRevisionCompatibility(root, { sourceTestRevision, evidenceRevision });
    assert.equal(result.compatible, true);
    assert.deepEqual(result.disallowedPaths, []);
    assert.deepEqual(result.changedPaths, ['docs/developers/verification/platform-reports/windows-j05.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('evidence-revision carry-forward rejects paths outside the evidence allowlist and maps affected AI/human evidence', async () => {
  const root = await repositoryFixture();
  try {
    const sourceTestRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    await mkdir(resolve(root, 'docs/developers'), { recursive: true });
    await mkdir(resolve(root, 'tools/docs/lib/rules'), { recursive: true });
    await writeFile(resolve(root, 'arbitrary.txt'), 'not evidence\n');
    await writeFile(resolve(root, 'docs/developers/verification.md'), 'guidance change\n');
    await writeFile(resolve(root, 'tools/docs/lib/rules/evidence.mjs'), 'validator change\n');
    const evidenceRevision = commit(root, 'invalid evidence revision');
    const result = await adjudicateRevisionCompatibility(root, { sourceTestRevision, evidenceRevision });
    assert.equal(result.compatible, false);
    assert.deepEqual(result.disallowedPaths, ['arbitrary.txt', 'docs/developers/verification.md', 'tools/docs/lib/rules/evidence.mjs']);
    assert.deepEqual(result.rerun.platform, []);
    assert.ok(result.rerun.aih.includes('AIH-01'));
    assert.ok(result.rerun.human.includes('REV-08'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Tauri runtime, API-base, desktop command, configuration, and package changes stale platform reports', () => {
  for (const path of [
    'builds/typescript/src-tauri/src/main.rs',
    'builds/typescript/client_web/src/api/runtime-api-base.ts',
    'builds/typescript/client_web/vite.config.ts',
    'builds/typescript/scripts/desktop-prepare-dev.mjs',
    'builds/typescript/package.json',
  ]) {
    const impact = classifyEvidenceImpact([path]);
    assert.deepEqual(impact.platform, ['macos-j05', 'windows-j05'], path);
  }
});

test('platform evidence carries across policy-only changes but not desktop-runtime changes', async () => {
  const root = await repositoryFixture();
  try {
    const testedRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    await mkdir(resolve(root, 'docs/developers'), { recursive: true });
    await mkdir(resolve(root, 'tools/docs/lib/rules'), { recursive: true });
    await writeFile(resolve(root, 'docs/developers/catalog.json'), '{"claimedPlatforms":["windows"]}\n');
    await writeFile(resolve(root, 'tools/docs/lib/rules/evidence.mjs'), 'policy validator\n');
    const policyRevision = commit(root, 'policy only');
    const carried = await adjudicatePlatformEvidenceCarryForward(root, { testedRevision, targetRevision: policyRevision, platform: 'windows' });
    assert.equal(carried.compatible, true);
    assert.deepEqual(carried.changedPaths, ['docs/developers/catalog.json', 'tools/docs/lib/rules/evidence.mjs']);

    await mkdir(resolve(root, 'builds/typescript/src-tauri/src'), { recursive: true });
    await writeFile(resolve(root, 'builds/typescript/src-tauri/src/main.rs'), 'runtime change\n');
    const runtimeRevision = commit(root, 'runtime change');
    const stale = await adjudicatePlatformEvidenceCarryForward(root, { testedRevision, targetRevision: runtimeRevision, platform: 'windows' });
    assert.equal(stale.compatible, false);
    assert.ok(stale.diagnostics.some(({ message }) => /runtime-relevant/i.test(message)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent instructions, catalog routes, scenario contracts, sources, and checks stale affected AIH evidence', () => {
  const cases = [
    ['AGENTS.md', 'AIH-01'],
    ['docs/developers/catalog.json', 'AIH-04'],
    ['tools/docs/harness/scenarios.json', 'AIH-05'],
    ['builds/typescript/adapters/openai-compatible.json', 'AIH-05'],
    ['builds/typescript/package.json', 'AIH-08'],
    ['tools/docs/test/commands.test.mjs', 'AIH-08'],
    ['tools/docs/lib/rules/evidence.mjs', 'AIH-10'],
  ];
  for (const [path, scenario] of cases) assert.ok(classifyEvidenceImpact([path]).aih.includes(scenario), `${path} must stale ${scenario}`);
});

test('reviewed source, security, release, and governance changes stale affected human evidence', () => {
  const cases = [
    ['builds/typescript/gateway/server.ts', 'REV-02'],
    ['tools/security/scan-secrets.sh', 'REV-04'],
    ['installer/docker/scripts/release-production.sh', 'REV-06'],
    ['.github/workflows/release.yml', 'REV-06'],
    ['docs/developers/verification.md', 'REV-07'],
    ['docs/developers/governance.md', 'REV-08'],
  ];
  for (const [path, review] of cases) assert.ok(classifyEvidenceImpact([path]).human.includes(review), `${path} must stale ${review}`);
});

function validPlatformReport() {
  const sourceTestRevision = sha('b');
  return {
    schemaVersion: 1,
    journeyId: 'J-05',
    platform: 'windows',
    environment: { kind: 'native', osName: 'Synthetic Windows', osVersion: '1', architecture: 'x64' },
    sourceTestRevision,
    sourceCandidateProof: proof('a', sourceTestRevision),
    cleanBefore: true,
    cleanAfter: true,
    toolVersions: { node: '22.0.0', rustc: '1.80.0', tauri: '2.0.0' },
    commands: [{ command: 'synthetic desktop check', workingDirectory: 'repository root', exitCode: 0, result: 'pass', summary: 'Synthetic native shell reached.' }],
    dynamicGatewayObservation: { result: 'pass', summary: 'Dynamic gateway selected.' },
    providerIndependentUsableShellBaseline: { result: 'pass', summary: 'Usable shell reached without provider configuration.' },
    cleanup: 'Synthetic state removed.',
    sanitization: 'pass',
    operatorRole: 'native-platform operator',
    reviewerRole: 'platform reviewer',
    remainingRisk: 'Synthetic fixture only.',
    disposition: 'pass',
  };
}

function validHumanReview() {
  const sourceTestRevision = sha('b');
  return {
    schemaVersion: 1,
    reviewId: 'REV-04',
    reviewerRole: 'security-aware reviewer',
    operatorRole: 'review recorder',
    sourceTestRevision,
    sourceCandidateProof: proof('a', sourceTestRevision),
    scope: ['Synthetic security surface'],
    reviewedSources: ['SECURITY.md'],
    findings: [],
    independence: 'Independent review of public-safe repository evidence.',
    sanitization: 'pass',
    remainingRisk: 'Synthetic fixture only.',
    disposition: 'pass',
  };
}

test('missing, malformed, unsanitized, failed, unattributable, non-native, and stale records fail closed', () => {
  const platform = validPlatformReport();
  const human = validHumanReview();
  const identity = { sourceTestRevision: sha('b'), sourceCandidateProof: proof() };
  const mutations = [
    (record) => { delete record.commands; },
    (record) => { record.commands = 'malformed'; },
    (record) => { record.commands[0].exitCode = 1; },
    (record) => { record.remainingRisk = 'OWNER_API_KEY=synthetic-private-value'; },
    (record) => { record.disposition = 'fail'; },
    (record) => { delete record.operatorRole; },
    (record) => { record.environment.kind = 'wsl'; },
    (record) => { record.environment.osName = 'Synthetic Linux'; },
    (record) => { record.sourceTestRevision = sha('d'); },
  ];
  for (const mutate of mutations) {
    const record = structuredClone(platform);
    mutate(record);
    const diagnostics = validatePlatformReport(record, { expectedPlatform: 'windows', ...identity });
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(({ message }) => !message.includes('synthetic-private-value')));
  }
  for (const mutate of [
    (record) => { delete record.reviewedSources; },
    (record) => { record.scope = 'malformed'; },
    (record) => { record.remainingRisk = 'token=synthetic-private-value'; },
    (record) => { record.disposition = 'blocked'; },
    (record) => { delete record.reviewerRole; },
    (record) => { record.findings = [{ disposition: 'open' }]; },
    (record) => { record.sourceCandidateProof = proof('d'); },
  ]) {
    const record = structuredClone(human);
    mutate(record);
    const diagnostics = validateHumanReview(record, { expectedReviewId: 'REV-04', expectedReviewerRole: 'security-aware reviewer', ...identity });
    assert.ok(diagnostics.length > 0);
    assert.ok(diagnostics.every(({ message }) => !message.includes('synthetic-private-value')));
  }
});

test('evidence reads reject escapes and symlinks without echoing sensitive values', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'docs-evidence-contained-'));
  const outside = await mkdtemp(resolve(tmpdir(), 'docs-evidence-outside-'));
  try {
    const sensitive = 'OWNER_API_KEY=synthetic-private-value';
    await writeFile(resolve(outside, 'report.json'), JSON.stringify({ value: sensitive }));
    await mkdir(resolve(root, 'reports'));
    try {
      await symlink(resolve(outside, 'report.json'), resolve(root, 'reports/report.json'));
    } catch (error) {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
      await rm(resolve(root, 'reports'), { recursive: true, force: true });
      await symlink(outside, resolve(root, 'reports'), 'junction');
    }
    for (const path of ['../outside/report.json', 'reports/report.json']) {
      const result = await readEvidenceJson(root, path, { rule: 'G-07' });
      assert.equal(result.value, undefined);
      assert.ok(result.diagnostics.length > 0);
      assert.ok(result.diagnostics.every(({ message }) => !message.includes(sensitive)));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('AI maps, matrices, worksheets, comparisons, and handoffs require retained substance', () => {
  const scenario = {
    id: 'AIH-02',
    taskPrompt: 'Synthetic map task.',
    rubric: [{ dimension: 'repository accuracy' }],
    evidence: { requiredFields: ['Component map', 'Source comparison', 'Impact worksheet', 'Handoff artifact'] },
  };
  const sourceTestRevision = sha('b');
  const sourceCandidateProof = proof('a', sourceTestRevision);
  const base = `# Scorecard\n\n- Scenario ID: AIH-02\n- SOURCE_TEST_REVISION: ${sourceTestRevision}\n- SOURCE_CANDIDATE_PROOF: ${sourceCandidateProof}\n- Task prompt: Synthetic map task.\n\n## Required output evidence\n\n- Component map: retained\n- Source comparison: retained\n- Impact worksheet: retained\n- Handoff artifact: retained\n\n| Gating dimension | Pass/fail | Evidence |\n|---|---|---|\n| Repository accuracy | pass | synthetic |\n\n- Disposition: \`pass\`\n- Sanitization performed: yes\n`;
  const diagnostics = validateAiScorecard(scenario, base, 'synthetic.md', {
    sourceTestRevision,
    sourceCandidateProof,
    requireSubstantiveArtifacts: true,
  });
  assert.ok(diagnostics.some(({ message }) => /substantive/i.test(message)));
});
