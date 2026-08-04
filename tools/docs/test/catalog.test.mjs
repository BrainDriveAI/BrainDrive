import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateCatalog } from '../lib/catalog.mjs';
import { enumerateCandidates } from '../lib/git-inputs.mjs';
import { validateSchema } from '../lib/schema.mjs';
import { checkRepository, validateVerificationReport, writeReportSafely } from '../check.mjs';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/catalog/${name}`, import.meta.url), 'utf8'));
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

async function copyCandidateTo(temporary) {
  for (const path of enumerateCandidates(repositoryRoot)) {
    const source = resolve(repositoryRoot, path);
    const destination = resolve(temporary, path);
    const info = await lstat(source);
    await mkdir(dirname(destination), { recursive: true });
    if (info.isSymbolicLink()) await symlink(await readlink(source), destination);
    else if (info.isFile()) await copyFile(source, destination);
  }
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: temporary }).status, 0);
  assert.equal(spawnSync('git', ['add', '-f', '.'], { cwd: temporary }).status, 0);
}

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

test('catalog schema rejects undeclared properties at root and nested authority objects', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/catalog.schema.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(await readFile(resolve(repositoryRoot, 'docs/developers/catalog.json'), 'utf8'));
  catalog.typoField = true;
  catalog.topics[0].typoField = true;
  catalog.agentContract.typoField = true;
  const diagnostics = validateSchema(schema, catalog, 'catalog');
  assert.ok(diagnostics.some(({ path, message }) => path === 'catalog' && message.includes('typoField')));
  assert.ok(diagnostics.some(({ path, message }) => path === 'catalog.topics[0]' && message.includes('typoField')));
  assert.ok(diagnostics.some(({ path, message }) => path === 'catalog.agentContract' && message.includes('typoField')));
});

test('dependency-free schema validation enforces the structural keywords used by documentation schemas', () => {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['label', 'precedence'],
    properties: {
      label: { type: 'string', minLength: 3 },
      precedence: { type: 'integer', minimum: 1 },
    },
  };
  const diagnostics = validateSchema(schema, { label: '', precedence: 0, unexpected: true }, 'schema-fixture');
  assert.ok(diagnostics.some(({ message }) => message.includes('at least 3 characters')));
  assert.ok(diagnostics.some(({ message }) => message.includes('at least 1')));
  assert.ok(diagnostics.some(({ message }) => message.includes('unexpected property unexpected')));
});

test('composed report is schema-valid and retains an explicit DA-01 through DA-18 matrix', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/verification-report.schema.json', import.meta.url), 'utf8'));
  const report = await checkRepository(repositoryRoot);
  assert.deepEqual(validateSchema(schema, report, 'documentation-report'), []);
  assert.deepEqual(report.capabilities.map(({ id }) => id), Array.from({ length: 18 }, (_, index) => `DA-${String(index + 1).padStart(2, '0')}`));
  assert.ok(report.capabilities.every(({ status }) => status === 'pass'));
});

test('verification report schema and semantic validation reject duplicate capabilities and contradictory status', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/verification-report.schema.json', import.meta.url), 'utf8'));
  const report = {
    schemaVersion: 1,
    status: 'pass',
    evaluatedAt: '2026-08-03T00:00:00.000Z',
    candidateManifest: { enumeration: 'git ls-files --cached --others --exclude-standard -z', totalCandidates: 1, documentationGovernanceCandidates: ['synthetic.md'], excludedBoundaries: ['synthetic'] },
    capabilities: Array.from({ length: 18 }, () => ({ id: 'DA-01', status: 'fail' })),
    diagnostics: [
      { rule: 'DA-02', path: 'synthetic', message: 'synthetic failure', hint: '' },
      { rule: 'DA-99', path: 'synthetic', message: 'synthetic unknown rule', hint: '' },
    ],
  };
  assert.ok(validateSchema(schema, report, 'documentation-report').length > 0);
  const diagnostics = validateVerificationReport(report);
  assert.ok(diagnostics.some(({ message }) => /exactly once and in order/.test(message)));
  assert.ok(diagnostics.some(({ path }) => path.endsWith('.status')));
  assert.ok(diagnostics.some(({ path }) => path.endsWith('.DA-01')));
  assert.ok(diagnostics.some(({ message }) => /diagnostic rules must be DA-01 through DA-18/.test(message)));
});

test('sanitized reports use exclusive private writes inside an approved temporary root', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-report-'));
  const outside = await mkdtemp(resolve(tmpdir(), 'docs-report-outside-'));
  const path = resolve(temporary, 'report.json');
  try {
    await writeReportSafely(path, { status: 'fail', candidateManifest: { documentationGovernanceCandidates: ['OWNER_API_KEY=synthetic-private-value'] }, diagnostics: [] }, { allowedRoots: [temporary] });
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
    else assert.ok((await stat(path)).isFile());
    assert.doesNotMatch(await readFile(path, 'utf8'), /synthetic-private-value/);
    await assert.rejects(writeReportSafely(path, {}, { allowedRoots: [temporary] }), /already exists/);
    const link = resolve(temporary, 'linked.json');
    try {
      await symlink(path, link);
      await assert.rejects(writeReportSafely(link, {}, { allowedRoots: [temporary] }), /already exists/);
    } catch (error) {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
    }
    await assert.rejects(writeReportSafely(resolve(outside, 'report.json'), {}, { allowedRoots: [temporary] }), /approved temporary root/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
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

test('composed repository validator executes DA-17 instead of relying on unrelated structure failures', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-plain-source-composed-'));
  try {
    for (const path of enumerateCandidates(repositoryRoot)) {
      const source = resolve(repositoryRoot, path);
      const destination = resolve(temporary, path);
      const info = await lstat(source);
      await mkdir(dirname(destination), { recursive: true });
      if (info.isSymbolicLink()) await symlink(await readlink(source), destination);
      else if (info.isFile()) await copyFile(source, destination);
    }
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: temporary }).status, 0);
    assert.equal(spawnSync('git', ['add', '-f', '.'], { cwd: temporary }).status, 0);
    const indexPath = resolve(temporary, 'docs/developers/README.md');
    const index = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, `${index}\n<iframe src="https://example.invalid/required-renderer"></iframe>\n`);
    const report = await checkRepository(temporary);
    assert.ok(report.diagnostics.some(({ rule, path }) => rule === 'DA-17' && path === 'docs/developers/README.md'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('composed repository validator reaches every DA capability with an isolated intended defect', async () => {
  const mutateCatalog = (mutator) => async (temporary) => {
    const path = resolve(temporary, 'docs/developers/catalog.json');
    const catalog = JSON.parse(await readFile(path, 'utf8'));
    mutator(catalog);
    await writeFile(path, `${JSON.stringify(catalog, null, 2)}\n`);
  };
  const cases = [
    ['DA-01', mutateCatalog((catalog) => { catalog.audiences = catalog.audiences.filter(({ id }) => id !== 'first-time-contributors'); })],
    ['DA-02', mutateCatalog((catalog) => { catalog.journeys[0].path = 'docs/developers/missing-route.md'; })],
    ['DA-03', mutateCatalog((catalog) => { catalog.searchVocabulary = catalog.searchVocabulary.filter((term) => term !== 'gateway'); })],
    ['DA-04', async (temporary) => { const path = resolve(temporary, 'docs/developers/README.md'); await writeFile(path, `${await readFile(path, 'utf8')}\n[Broken route](missing-composed-target.md)\n`); }],
    ['DA-05', mutateCatalog((catalog) => { catalog.topics.push(structuredClone(catalog.topics[0])); })],
    ['DA-06', mutateCatalog((catalog) => { delete catalog.topics[0].title; })],
    ['DA-07', async (temporary) => { const path = resolve(temporary, 'CLAUDE.md'); await rm(path); await writeFile(path, 'divergent mirror\n'); }],
    ['DA-08', mutateCatalog((catalog) => { catalog.agentContract.pairedChangeObligations = catalog.agentContract.pairedChangeObligations.filter(({ id }) => id !== 'memory-template-existing-owner'); })],
    ['DA-09', mutateCatalog((catalog) => { catalog.topics[0].status = 'legacy'; })],
    ['DA-10', async (temporary) => { const path = resolve(temporary, 'builds/typescript/package.json'); const value = JSON.parse(await readFile(path, 'utf8')); value.scripts['docs:check'] = 'node wrong.mjs'; await writeFile(path, `${JSON.stringify(value, null, 2)}\n`); }],
    ['DA-11', mutateCatalog((catalog) => { delete catalog.commands[0].cleanup; })],
    ['DA-12', async (temporary) => { const path = resolve(temporary, '.github/workflows/ci.yml'); await writeFile(path, (await readFile(path, 'utf8')).replace(/        run: rm -f -- "\$RUNNER_TEMP\/docs-verification-report\.json"\r?\n/, '')); }],
    ['DA-13', mutateCatalog((catalog) => { catalog.migrationPolicies = []; })],
    ['DA-14', mutateCatalog((catalog) => { delete catalog.versionDomains[0].branchTagContract; })],
    ['DA-15', async (temporary) => { const path = resolve(temporary, 'docs/developers/README.md'); await writeFile(path, `${await readFile(path, 'utf8')}\nsk-<synthetic-secret-shaped-value>\n`); }],
    ['DA-16', async (temporary) => {
      const path = resolve(temporary, 'docs/AGENTS.md');
      await rm(path);
      if (process.platform === 'win32') await mkdir(path);
      else await symlink(dirname(temporary), path, 'dir');
    }],
    ['DA-17', async (temporary) => { const path = resolve(temporary, 'docs/developers/README.md'); await writeFile(path, `${await readFile(path, 'utf8')}\n<iframe src="https://example.invalid/required-renderer"></iframe>\n`); }],
    ['DA-18', async (temporary) => { await writeFile(resolve(temporary, 'tools/docs/harness/scenarios.json'), '{ invalid json\n'); }],
  ];
  for (const [rule, mutate] of cases) {
    const temporary = await mkdtemp(resolve(tmpdir(), `docs-composed-${rule.toLowerCase()}-`));
    try {
      await copyCandidateTo(temporary);
      await mutate(temporary);
      const report = await checkRepository(temporary);
      assert.equal(report.capabilities.find(({ id }) => id === rule)?.status, 'fail', `${rule} mutation did not reach its composed capability`);
      assert.ok(report.diagnostics.some((item) => item.rule === rule), `${rule} mutation lacked its intended diagnostic`);
    } finally {
      if (rule === 'DA-16') await rm(resolve(temporary, 'docs/AGENTS.md'), { recursive: true, force: true });
      await rm(temporary, { recursive: true, force: true });
    }
  }
});
