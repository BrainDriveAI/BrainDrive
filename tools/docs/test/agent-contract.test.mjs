import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { enumerateCandidates } from '../lib/git-inputs.mjs';
import { validateSchema } from '../lib/schema.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const repositoryText = (path) => readFile(new URL(path, repositoryRoot), 'utf8');
const repositoryJson = async (path) => JSON.parse(await repositoryText(path));

test('root instructions expose concise catalog, documentation-impact, and verification routes', async () => {
  const text = await repositoryText('AGENTS.md');
  for (const expected of [
    'Machine-readable task routes',
    'docs/developers/catalog.json',
    'sourceMappings',
    'docs/developers/verification.md',
    'same pull request',
  ]) assert.match(text, new RegExp(expected, 'i'));
});

test('documentation instructions remain additive and route AI harness evidence without duplicating root authority', async () => {
  const text = await repositoryText('docs/AGENTS.md');
  assert.match(text, /supplements.*only/i);
  assert.match(text, /verification\/ai-agent-harness\.md/i);
  assert.doesNotMatch(text, /^# BrainDrive Agent Instructions$/m);
});

test('catalog defines a complete machine-readable coding-agent contract', async () => {
  const catalog = await repositoryJson('docs/developers/catalog.json');
  const contract = catalog.agentContract;
  assert.ok(contract);
  for (const key of ['governingInstructions', 'compatibilityMirrors', 'artifactClasses', 'taskRoutes', 'changeRoutes', 'checkRoutes', 'pairedChangeObligations', 'restrictedExclusions']) {
    assert.ok(Array.isArray(contract[key]) && contract[key].length > 0, `agentContract.${key} must be non-empty`);
  }
  assert.deepEqual(contract.governingInstructions, [
    { path: 'AGENTS.md', scope: '**', kind: 'canonical-root', precedence: 1 },
    { path: 'docs/AGENTS.md', scope: 'docs/**', kind: 'additive-scoped', precedence: 2 },
  ]);
  assert.deepEqual(contract.compatibilityMirrors.map(({ path }) => path).sort(), ['CLAUDE.md', 'GEMINI.md']);
  assert.ok(contract.artifactClasses.some(({ pattern, classification, codingAuthority }) => pattern === 'builds/typescript/memory/starter-pack/**/AGENT.md' && classification === 'product-agent-artifact' && codingAuthority === false));
  assert.ok(contract.restrictedExclusions.some(({ pattern }) => pattern === 'builds/typescript/your-memory/**'));
  for (const pattern of ['builds/typescript/your-memory*', 'builds/typescript/.paa-secrets/**', 'builds/typescript/.paa-secrets*', 'builds/typescript/.reset-backups/**', 'builds/typescript/.your-memory.root-owned.backup/**', 'installer/docker/backups/**', '**/build/**', '**/coverage/**', '**/vendor/**', '**/.cache/**']) assert.ok(contract.restrictedExclusions.some((entry) => entry.pattern === pattern));
  assert.ok(contract.pairedChangeObligations.some(({ id }) => id === 'memory-template-existing-owner'));
});

test('agent change routes enumerate the live adapters, executors, configuration, and focused tests', async () => {
  const { agentContract } = await repositoryJson('docs/developers/catalog.json');
  const routes = new Map(agentContract.changeRoutes.map((route) => [route.id, route]));
  const expectMembers = (routeId, field, expected) => {
    const values = routes.get(routeId)?.[field] || [];
    for (const path of expected) assert.ok(values.includes(path), `${routeId}.${field} must include ${path}`);
  };

  expectMembers('web-to-tool-change', 'sourcePaths', [
    'builds/typescript/client_web/src/api/gateway-adapter.ts',
    'builds/typescript/engine/tool-executor.ts',
  ]);
  expectMembers('web-to-tool-change', 'testPaths', [
    'builds/typescript/client_web/src/api/gateway-adapter.test.ts',
    'builds/typescript/client_web/src/components/chat/ChatPanel.test.tsx',
  ]);
  expectMembers('web-to-tool-change', 'configurationPaths', [
    'builds/typescript/config.json',
    'builds/typescript/mcp/servers.full-mcp.json',
  ]);

  expectMembers('first-party-mcp-change', 'sourcePaths', ['builds/typescript/mcp/client.ts']);
  expectMembers('first-party-mcp-change', 'configurationPaths', [
    'builds/typescript/mcp/servers.full-mcp.json',
    'builds/typescript/mcp/servers.full-mcp.docker.json',
  ]);
  expectMembers('provider-change', 'testPaths', ['builds/typescript/gateway/provider-activation.test.ts']);
  expectMembers('provider-ui-change', 'sourcePaths', ['builds/typescript/client_web/src/components/settings/SettingsModal.tsx']);
  expectMembers('provider-ui-change', 'testPaths', ['builds/typescript/client_web/src/components/settings/SettingsModal.test.tsx']);
  expectMembers('memory-template-change', 'testPaths', [
    'builds/typescript/memory/starter-pack-draft3-layout.test.ts',
    'builds/typescript/gateway/auth-routes.integration.test.ts',
  ]);

  const memoryObligation = agentContract.pairedChangeObligations.find(({ id }) => id === 'memory-template-existing-owner');
  assert.match(memoryObligation.existingOwnerDisposition, /no active starter-pack updater/i);
  assert.match(memoryObligation.proposedUpdaterRequirements, /exact recognized prior default.*customized.*idempotent/i);

  const checks = new Map(agentContract.checkRoutes.map((route) => [route.id, route]));
  assert.deepEqual(checks.get('mcp-release')?.broaderCommandIds, ['mcp-release-verify']);
  assert.equal(checks.get('runtime-and-mcp')?.additionalCommands, undefined);
  const catalog = await repositoryJson('docs/developers/catalog.json');
  const mcpVerify = catalog.commands.find(({ id }) => id === 'mcp-release-verify');
  assert.equal(mcpVerify?.command, 'npm run test && npm run build');
  assert.equal(mcpVerify?.workingDirectory, 'builds/mcp_release');
  assert.ok(mcpVerify?.prerequisites.includes('Node.js 22'));
  const candidateDigest = catalog.commands.find(({ id }) => id === 'candidate-digest');
  assert.equal(candidateDigest?.command, 'node tools/docs/candidate-digest.mjs');
  assert.equal(candidateDigest?.workingDirectory, 'repository root');
  for (const routeId of ['provider-change', 'provider-ui-change']) {
    const guarantees = routes.get(routeId)?.negativeGuarantees || [];
    assert.ok(guarantees.some((value) => /owned provider keys.*client configuration/i.test(value)));
    assert.ok(guarantees.some((value) => /Ollama.*BYOK OpenRouter.*independent.*credits/i.test(value)));
  }
});

test('AIH manifest and schema enforce executable prompts, binary rubrics, and evidence paths', async () => {
  const harness = await repositoryJson('tools/docs/harness/scenarios.json');
  const schema = await repositoryJson('tools/docs/schemas/ai-harness.schema.json');
  const invalid = await repositoryJson('tools/docs/test/fixtures/evidence/invalid-ai-harness-types.json');
  assert.ok(validateSchema(schema, invalid, 'invalid-ai-harness-types.json').length > 0);
  assert.equal(harness.scenarios.length, 10);
  for (const scenario of harness.scenarios) {
    assert.match(scenario.taskPrompt, /\S/);
    assert.ok(Array.isArray(scenario.rubric) && scenario.rubric.length > 0);
    assert.ok(scenario.rubric.every(({ dimension, passingStandard, gate }) => dimension && passingStandard && gate === 'must-pass'));
    assert.match(scenario.evidence.traceSummaryPath, new RegExp(`${scenario.id.toLowerCase()}.*\\.md$`));
    assert.match(scenario.evidence.scorecardPath, new RegExp(`${scenario.id.toLowerCase()}.*\\.md$`));
    assert.ok(Array.isArray(scenario.evidence.requiredFields) && scenario.evidence.requiredFields.length > 0);
  }
});

test('canonical harness procedure defines fresh-context, zero-change, scoring, and rerun rules', async () => {
  const text = await repositoryText('docs/developers/verification/ai-agent-harness.md');
  for (const expected of ['fresh context', 'provider-independent', 'read-only', 'zero-change', 'binary', 'no aggregate', 'rerun', 'sanit']) {
    assert.match(text, new RegExp(expected, 'i'));
  }
});

test('all ten sanitized scorecards use the exact template contract and pass every applicable dimension', async () => {
  for (let index = 1; index <= 10; index += 1) {
    const id = `AIH-${String(index).padStart(2, '0')}`;
    const path = `docs/developers/verification/ai-agent-scorecards/${id.toLowerCase()}.md`;
    const text = await repositoryText(path);
    const scenario = (await repositoryJson('tools/docs/harness/scenarios.json')).scenarios[index - 1];
    for (const field of ['Scenario ID:', 'Candidate revision:', 'Candidate state proof:', 'Starting path and allowed context:', 'Prohibited inputs/actions confirmed:', 'Evaluator role:', '## Trace summary', '## Required output evidence', '## Outcome', 'Sanitization performed:', ...scenario.evidence.requiredFields.map((field) => `${field}:`)]) assert.match(text, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, new RegExp(`Scenario ID:\\s*${id}`));
    assert.ok(text.includes(`- Task prompt: ${scenario.taskPrompt}`));
    assert.doesNotMatch(text, /\|\s*(?:Authority|Repository accuracy|Scope|Trust|Verification|Conflict behavior|Documentation impact|Handoff)\s*\|\s*fail\s*\|/i);
    assert.match(text, /Disposition:\s*`pass`/i);
  }
});

test('Git-derived candidate enumeration includes tracked product agents and excludes ignored owner agents', () => {
  const candidates = enumerateCandidates(new URL('../../../', import.meta.url));
  assert.ok(candidates.includes('builds/typescript/memory/starter-pack/base/AGENT.md'));
  assert.ok(!candidates.some((path) => path.startsWith('builds/typescript/your-memory/')));
});
