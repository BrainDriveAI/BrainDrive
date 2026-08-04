import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { validateAuthorityFixture, validateRepositoryAuthority } from '../lib/rules/authority.mjs';
import { validateDuplicationFixture } from '../lib/rules/duplication.mjs';
import { renderContract, synchronizeGenerated } from '../sync-generated.mjs';

const root = new URL('./fixtures/authority/', import.meta.url);

test('declared generated projection passes', async () => {
  assert.deepEqual(await validateAuthorityFixture(new URL('declared-generated/', root)), []);
});

test('divergent declared mirror fails', async () => {
  const diagnostics = await validateAuthorityFixture(new URL('divergent-mirror/', root));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-07'));
});

test('starter-pack AGENT is classified as a product artifact', async () => {
  assert.deepEqual(await validateAuthorityFixture(new URL('product-agent/', root)), []);
});

test('undeclared material copy fails', async () => {
  const diagnostics = await validateDuplicationFixture(new URL('undeclared-copy/', root));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-07'));
});

test('Windows Git symlink placeholder files remain valid agent compatibility aliases', { skip: process.platform !== 'win32' }, async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-agent-pointer-'));
  try {
    await mkdir(resolve(temporary, 'docs'));
    await writeFile(resolve(temporary, 'AGENTS.md'), '# Canonical instructions\r\n');
    await writeFile(resolve(temporary, 'docs/AGENTS.md'), '# Additive docs instructions\r\n');
    await writeFile(resolve(temporary, 'CLAUDE.md'), 'AGENTS.md');
    await writeFile(resolve(temporary, 'GEMINI.md'), 'AGENTS.md');
    const restrictedExclusions = ['builds/typescript/your-memory/**', 'builds/typescript/your-memory*', 'builds/typescript/.paa-secrets/**', 'builds/typescript/.paa-secrets*', 'builds/typescript/.reset-backups/**', 'builds/typescript/.your-memory.root-owned.backup/**', 'installer/docker/backups/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/target/**', '**/coverage/**', '**/vendor/**', '**/.cache/**', 'docs/Security/**'].map((pattern) => ({ pattern }));
    assert.deepEqual(await validateRepositoryAuthority(temporary, {
      documents: [],
      agentContract: {
        governingInstructions: [
          { path: 'AGENTS.md', scope: '**', kind: 'canonical-root', precedence: 1 },
          { path: 'docs/AGENTS.md', scope: 'docs/**', kind: 'additive-scoped', precedence: 2 },
        ],
        compatibilityMirrors: [
          { path: 'CLAUDE.md', canonicalPath: 'AGENTS.md', independentAuthority: false },
          { path: 'GEMINI.md', canonicalPath: 'AGENTS.md', independentAuthority: false },
        ],
        artifactClasses: [{ pattern: 'builds/typescript/memory/starter-pack/**/AGENT.md', classification: 'product-agent-artifact', codingAuthority: false }],
        taskRoutes: [], changeRoutes: [], checkRoutes: [], pairedChangeObligations: [{ id: 'memory-template-existing-owner', existingOwnerDisposition: 'No active starter-pack updater exists', proposedUpdaterRequirements: 'Update an exact recognized prior default, preserve customized content, and remain idempotent' }], restrictedExclusions,
      },
    }), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('repository authority requires the memory existing-owner paired-change obligation', async () => {
  const catalog = JSON.parse(await readFile(new URL('../../../docs/developers/catalog.json', import.meta.url), 'utf8'));
  catalog.agentContract.pairedChangeObligations = catalog.agentContract.pairedChangeObligations.filter(({ id }) => id !== 'memory-template-existing-owner');
  const diagnostics = await validateRepositoryAuthority(new URL('../../../', import.meta.url), catalog);
  assert.ok(diagnostics.some(({ rule, message }) => rule === 'DA-08' && /memory-template-existing-owner/.test(message)));
});

test('generated catalog projections accept native Windows line endings', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-projection-crlf-'));
  const topic = {
    topicId: 'windows-projection',
    title: 'Windows projection',
    path: 'docs/topic.md',
    purpose: 'Test native line endings',
    status: 'current',
    applicability: {},
    audiences: ['developer'],
    ownerRole: 'maintainer',
    expectedOutcome: 'Projection matches',
    prerequisites: ['None'],
    parentPath: null,
    adjacentTopics: [],
    keywords: ['Windows'],
    projection: true,
  };
  const catalog = {
    schemaVersion: 1,
    authority: 'catalog',
    audiences: [{ id: 'developer', label: 'Developer' }],
    topics: [topic],
    topicBindings: [{ topicId: topic.topicId, sources: [], tests: [], commands: [] }],
  };
  try {
    await mkdir(resolve(temporary, 'docs/developers'), { recursive: true });
    await writeFile(resolve(temporary, 'docs/developers/catalog.json'), JSON.stringify(catalog));
    await writeFile(resolve(temporary, topic.path), `${renderContract(topic, catalog).replace(/\n/g, '\r\n')}\r\n`);
    assert.deepEqual(await synchronizeGenerated({ root: temporary }), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('generated catalog projections accept a platform-aliased validation root', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-projection-root-alias-'));
  const actualRoot = resolve(temporary, 'actual');
  const aliasRoot = resolve(temporary, 'alias');
  try {
    await mkdir(resolve(actualRoot, 'docs/developers'), { recursive: true });
    await writeFile(
      resolve(actualRoot, 'docs/developers/catalog.json'),
      JSON.stringify({
        schemaVersion: 1,
        authority: 'catalog',
        audiences: [],
        topics: [],
        topicBindings: [],
      }),
    );
    await symlink(actualRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
    assert.deepEqual(await synchronizeGenerated({ root: aliasRoot }), []);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('projection write mode cannot escape its declared root', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-projection-'));
  const outside = `${temporary}-outside.md`;
  try {
    await mkdir(resolve(temporary, 'docs/developers'), { recursive: true });
    await writeFile(outside, 'outside-private-marker\n');
    await writeFile(resolve(temporary, 'docs/developers/catalog.json'), JSON.stringify({ schemaVersion: 1, authority: 'catalog', audiences: [], topics: [{ topicId: 'escape', path: `../${outside.split('/').at(-1)}`, status: 'current', applicability: {}, audiences: [], prerequisites: [], projection: true }] }));
    const diagnostics = await synchronizeGenerated({ root: temporary, write: true });
    assert.ok(diagnostics.some((item) => item.rule === 'DA-16'));
    assert.equal(await readFile(outside, 'utf8'), 'outside-private-marker\n');
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});
