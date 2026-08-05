import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, repositoryRoot), 'utf8');
const catalog = async () => JSON.parse(await read('docs/developers/catalog.json'));

const canonicalPages = [
  ['request-flows', 'docs/developers/architecture/request-flows.md'],
  ['modes-data-and-trust', 'docs/developers/architecture/modes-data-and-trust.md'],
  ['memory-and-secrets', 'docs/developers/architecture/memory-and-secrets.md'],
  ['integration-index', 'docs/developers/integrations/README.md'],
  ['gateway-integration', 'docs/developers/integrations/gateway.md'],
  ['provider-integration', 'docs/developers/integrations/providers.md'],
  ['mcp-and-tools-integration', 'docs/developers/integrations/mcp-and-tools.md'],
  ['deployment-integration', 'docs/developers/integrations/deployment.md'],
  ['developer-security-router', 'docs/developers/security.md'],
];

test('catalog registers every Milestone 3 canonical page with source and test bindings', async () => {
  const value = await catalog();
  const topics = new Map(value.topics.map((topic) => [topic.topicId, topic]));
  const bindings = new Map(value.topicBindings.map((binding) => [binding.topicId, binding]));
  for (const [topicId, path] of canonicalPages) {
    assert.equal(topics.get(topicId)?.path, path);
    assert.equal(topics.get(topicId)?.status, 'current');
    assert.ok(bindings.get(topicId)?.sources.length >= 1);
    assert.ok(bindings.get(topicId)?.tests.includes('tools/docs/test/technical-boundaries.test.mjs'));
  }
});

test('request-flow documentation contains two source-backed end-to-end traces', async () => {
  const text = await read('docs/developers/architecture/request-flows.md');
  for (const term of [
    'Trace A', 'Trace B', 'Participants', 'Non-participants', 'Trust boundary',
    'Persistence', 'Source evidence', 'Focused checks', 'POST /message',
    'runAgentLoop', 'approval-request', 'text-delta',
  ]) assert.match(text, new RegExp(term, 'i'), `request flow is missing ${term}`);
});

test('mode and lifecycle pages separate memory, secrets, auth, deployment, and backup state', async () => {
  const modes = await read('docs/developers/architecture/modes-data-and-trust.md');
  for (const term of ['local-owner', 'local JWT', 'managed', 'desktop transport', 'Docker', 'does not bypass']) {
    assert.match(modes, new RegExp(term, 'i'), `mode page is missing ${term}`);
  }
  for (const term of ['PAA_MANAGED_PUBLIC_ACCOUNT_PROXY_ROUTES', 'defaults to enabled', 'upstream session', 'transport token']) {
    assert.match(modes, new RegExp(term, 'i'), `mode page is missing managed proxy boundary: ${term}`);
  }

  const lifecycle = await read('docs/developers/architecture/memory-and-secrets.md');
  for (const term of [
    'memory root', 'secrets home', 'master key', 'vault', 'Git history',
    'export', 'backup', 'restore', 'migration', 'not included', 'destructive',
    'excludes `.git`', 'starter-pack', 'non-overwriting',
  ]) assert.match(lifecycle, new RegExp(term, 'i'), `lifecycle page is missing ${term}`);
  assert.doesNotMatch(lifecycle, /memory root is initialized as its own Git repository/i);
  assert.match(lifecycle, /gateway startup[^\n]+ensureGitReady[^\n]+memory:init[^\n]+does not/i);
});

test('integration documentation makes maturity and provider independence explicit', async () => {
  const gateway = await read('docs/developers/integrations/gateway.md');
  assert.match(gateway, /Maturity[^\n]+internal beta/i);
  assert.match(gateway, /same tagged release/i);
  assert.match(gateway, /no public third-party API|not a public third-party API/i);

  const providers = await read('docs/developers/integrations/providers.md');
  for (const term of ['beta-supported built-in', 'BrainDrive Models', 'BYOK OpenRouter', 'Ollama', 'independent', 'secret_ref', 'does not cover every model', 'generic OpenAI-compatible']) {
    assert.match(providers, new RegExp(term, 'i'));
  }
  assert.match(providers, /BrainDrive Models credits[^\n]+not required[^\n]+Ollama|Ollama[^\n]+not require[^\n]+BrainDrive Models credits/i);

  const mcp = await read('docs/developers/integrations/mcp-and-tools.md');
  assert.match(mcp, /Maturity[^\n]+internal beta/i);
  assert.match(mcp, /custom[^\n]+experimental/i);
  assert.match(mcp, /streamable HTTP/i);
  assert.match(mcp, /system_shipped/i);
  assert.match(mcp, /not an SDK/i);

  const mcpReadme = await read('builds/mcp_release/README.md');
  assert.match(mcpReadme, /internal beta/i);
  assert.match(mcpReadme, /same-release orchestration/i);
  for (const term of ['Risk tier', 'Prerequisites', 'Target', 'Side effects', 'Authority', 'Recovery']) {
    assert.match(mcpReadme, new RegExp(term, 'i'), `MCP command contracts are missing ${term}`);
  }

  const resolvedBoundarySurfaces = [
    'docs/developers/README.md',
    'docs/developers/repository-map.md',
    'docs/developers/terminology.md',
    'docs/developers/architecture/README.md',
    'docs/developers/catalog.json',
  ];
  for (const path of resolvedBoundarySurfaces) {
    const text = await read(path);
    assert.doesNotMatch(text, /OPEN-02[^\n]*(?:remain|is)[^\n]*unresolved|unresolved[^\n]*OPEN-02/i, `${path} must not contradict the resolved OPEN-02 decision`);
  }
});

test('legacy gateway contract is preserved in history and the old path is only a pointer', async () => {
  const historyPath = 'docs/developers/history/gateway-contract-original-client.md';
  const history = await read(historyPath);
  const pointer = await read('builds/typescript/client_web/src/api/CONTRACT.md');
  for (const marker of ['POST /api/message', '## SSE Events', 'GatewayNotFoundError']) {
    assert.match(history, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(pointer, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(pointer, /docs\/developers\/integrations\/gateway\.md/);
  assert.match(pointer, /docs\/developers\/history\/gateway-contract-original-client\.md/);
});

test('developer security page routes policy without duplicating restricted procedures', async () => {
  const text = await read('docs/developers/security.md');
  assert.match(text, /\.\.\/\.\.\/SECURITY\.md|\/SECURITY\.md/);
  assert.match(text, /\.\.\/repository-security\.md|docs\/repository-security\.md/);
  assert.match(text, /vulnerabilit/i);
  assert.match(text, /secret/i);
  assert.match(text, /restricted/i);
  assert.doesNotMatch(text, /docs\/Security\//);
});
