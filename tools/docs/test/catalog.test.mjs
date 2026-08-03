import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateCatalog } from '../lib/catalog.mjs';
import { enumerateCandidates } from '../lib/git-inputs.mjs';
import { validateSchema } from '../lib/schema.mjs';
import { checkRepository } from '../check.mjs';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/catalog/${name}`, import.meta.url), 'utf8'));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('minimal catalog with complete metadata passes', async () => {
  assert.deepEqual(validateCatalog(await fixture('valid-minimal.json'), { checkPaths: false }), []);
});

test('duplicate current authorities fail with both paths', async () => {
  const diagnostics = validateCatalog(await fixture('duplicate-topic.json'), { checkPaths: false });
  assert.ok(diagnostics.some((item) => item.rule === 'DA-05' && item.message.includes('a.md') && item.message.includes('b.md')));
});

test('missing canonical metadata fails', async () => {
  const diagnostics = validateCatalog(await fixture('missing-metadata.json'), { checkPaths: false });
  assert.ok(diagnostics.some((item) => item.rule === 'DA-06'));
});

test('catalog schema is executed and rejects malformed catalog types', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/catalog.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateSchema(schema, await fixture('valid-minimal.json'), 'catalog'), []);
  assert.ok(validateSchema(schema, { schemaVersion: 1, authority: 'catalog', topics: 'wrong' }, 'catalog').length > 0);
});

test('catalog paths cannot escape the repository root', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-catalog-'));
  try {
    await mkdir(resolve(temporary, 'docs'));
    await writeFile(resolve(temporary, 'docs/in.md'), '# in\n');
    const catalog = await fixture('valid-minimal.json');
    catalog.topics[0].path = '../outside.md';
    assert.ok(validateCatalog(catalog, { root: temporary }).some((item) => item.rule === 'DA-16'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('catalog lifecycle, aliases, mappings, and identifiers fail closed', async () => {
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, 'docs/developers/catalog.json'), 'utf8'));
  catalog.documents[0].status = 'typo';
  catalog.governanceSurfaces[0].status = 'typo';
  catalog.ownerRoles.push({ ...catalog.ownerRoles[0] });
  catalog.topicBindings.push(structuredClone(catalog.topicBindings[0]));
  catalog.aliases[0].canonicalPath = 'docs/developers/not-present.md';
  catalog.sourceMappings[0].documentation = 'docs/developers/not-present.md';
  const diagnostics = validateCatalog(catalog, { root: repositoryRoot });
  assert.ok(diagnostics.some((item) => item.rule === 'DA-09' && item.message.includes('document status')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-09' && item.message.includes('governance status')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-05' && item.message.includes('owner role')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-05' && item.message.includes('topic binding')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-10' && item.message.includes('alias canonical')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-10' && item.message.includes('source mapping documentation')));
});

test('composed repository validator never reads a symlinked current authority', async () => {
  const sourceRoot = repositoryRoot;
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-composed-'));
  const outside = await mkdtemp(resolve(tmpdir(), 'docs-outside-'));
  try {
    for (const path of enumerateCandidates(sourceRoot)) {
      const source = resolve(sourceRoot, path);
      const destination = resolve(temporary, path);
      const info = await lstat(source);
      await mkdir(dirname(destination), { recursive: true });
      if (info.isSymbolicLink()) await symlink(await readlink(source), destination);
      else if (info.isFile()) await copyFile(source, destination);
    }
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: temporary }).status, 0);
    assert.equal(spawnSync('git', ['add', '-f', '.'], { cwd: temporary }).status, 0);
    await rm(resolve(temporary, 'docs/AGENTS.md'));
    await symlink(outside, resolve(temporary, 'docs/AGENTS.md'), process.platform === 'win32' ? 'junction' : 'dir');
    const report = await checkRepository(temporary);
    assert.equal(report.status, 'fail');
    assert.ok(report.diagnostics.some((item) => item.rule === 'DA-16' && item.path === 'docs/AGENTS.md'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('composed repository validator preserves all rule results', async () => {
  const report = await checkRepository(repositoryRoot);
  assert.equal(report.status, 'pass');
  assert.deepEqual(report.diagnostics, []);
});
