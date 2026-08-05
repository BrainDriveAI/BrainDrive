import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateDirectEntryStatus, validateOrientationContent, validateStructure } from '../lib/rules/structure.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);
const catalog = async () => JSON.parse(await readFile(new URL('docs/developers/catalog.json', repositoryRoot), 'utf8'));

test('catalog declares every component route with current searchable metadata', async () => {
  const value = await catalog();
  assert.deepEqual(validateStructure(value).filter(({ rule }) => ['DA-01', 'DA-02', 'DA-03', 'DA-09', 'DA-10'].includes(rule)), []);
  assert.deepEqual(value.components.map(({ id }) => id), [
    'web-client',
    'gateway-api',
    'engine-tools',
    'auth-config',
    'memory-secrets',
    'providers-mcp',
    'docker-installer',
    'tauri-desktop',
    'tests-ci',
    'security-release',
  ]);
});

test('current orientation topics have keywords, parent routes, adjacency, and bindings', async () => {
  const value = await catalog();
  const orientationIds = new Set(['developer-documentation-index', 'terminology', 'repository-map', 'architecture-overview', 'runtime-workspace-overview']);
  const bindings = new Map(value.topicBindings.map((entry) => [entry.topicId, entry]));
  for (const topic of value.topics.filter(({ topicId }) => orientationIds.has(topicId))) {
    assert.equal(topic.status, 'current');
    assert.ok(topic.keywords.length >= 2);
    assert.ok(topic.parentPath);
    assert.ok(topic.adjacentTopics.length >= 1);
    assert.ok(bindings.get(topic.topicId)?.sources.length >= 1);
    assert.ok(bindings.get(topic.topicId)?.tests.length >= 1);
  }
});

test('legacy entries cannot be promoted into current persona, journey, component, or parent routes', async () => {
  const value = await catalog();
  const legacy = structuredClone(value);
  legacy.components[0].path = 'builds/typescript/Getting-Started-OpenRouter.md';
  const diagnostics = validateStructure(legacy);
  assert.ok(diagnostics.some(({ rule, message }) => rule === 'DA-09' && message.includes('legacy')));
});

test('plain-source orientation pages expose status, parent, sources, tests, and searchable terms', async () => {
  const value = await catalog();
  const paths = ['docs/developers/README.md', 'docs/developers/terminology.md', 'docs/developers/repository-map.md', 'docs/developers/architecture/README.md'];
  const contents = new Map();
  for (const path of paths) contents.set(path, await readFile(new URL(path, repositoryRoot), 'utf8'));
  assert.deepEqual(validateOrientationContent(value, contents), []);
});

test('plain-source fixture without direct-entry metadata fails closed', async () => {
  const value = await catalog();
  const paths = ['docs/developers/README.md', 'docs/developers/terminology.md', 'docs/developers/repository-map.md', 'docs/developers/architecture/README.md'];
  const contents = new Map();
  for (const path of paths) contents.set(path, await readFile(new URL(path, repositoryRoot), 'utf8'));
  contents.set('docs/developers/terminology.md', await readFile(new URL('./fixtures/orientation/missing-plain-source-metadata.md', import.meta.url), 'utf8'));
  const diagnostics = validateOrientationContent(value, contents);
  assert.ok(diagnostics.some(({ rule, path }) => rule === 'DA-06' && path === 'docs/developers/terminology.md'));
});

test('real legacy and mixed direct-entry pages expose status and canonical routes', async () => {
  const value = await catalog();
  const paths = ['builds/typescript/Getting-Started-OpenRouter.md', 'builds/typescript/New-User-Setup.md', 'builds/typescript/client_web/src/api/CONTRACT.md'];
  const contents = new Map();
  for (const path of paths) contents.set(path, await readFile(new URL(path, repositoryRoot), 'utf8'));
  assert.deepEqual(validateDirectEntryStatus(value, contents), []);
  contents.set(paths[0], await readFile(new URL('./fixtures/orientation/missing-plain-source-metadata.md', import.meta.url), 'utf8'));
  assert.ok(validateDirectEntryStatus(value, contents).some(({ rule, path }) => rule === 'DA-09' && path === paths[0]));
});
