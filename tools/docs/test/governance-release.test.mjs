import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

const repositoryFile = (path) => readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
const execFileAsync = promisify(execFile);
const repositoryRoot = new URL('../../../', import.meta.url);

test('contribution policy defines the complete issue-to-PR and evidence workflow', async () => {
  const text = await repositoryFile('CONTRIBUTING.md');
  for (const expected of [
    'Documentation defect',
    'Accepted implementation work',
    'applicable `AGENTS.md`',
    'callers',
    'smallest',
    'documentation impact',
    'remaining risk',
  ]) assert.match(text, new RegExp(expected, 'i'));
});

test('governance page defines catalog, review, freshness, versioning, deprecation, history, and correction contracts', async () => {
  const text = await repositoryFile('docs/developers/governance.md');
  for (const expected of ['Catalog authority', 'Required review', 'Same-PR', 'Generated projections', 'Branch truth', 'Tag truth', 'Deprecation', 'Historical', 'Correction workflow', 'OPEN-01', 'OPEN-08']) assert.match(text, new RegExp(expected, 'i'));
});

test('release page separates public trust contracts from restricted release operations', async () => {
  const text = await repositoryFile('docs/developers/releases.md');
  for (const expected of ['app/web/Tauri', 'MCP release', 'installer release', 'YY.M.D', 'YY.M.D.N', 'digest', 'signature', 'restricted', 'release-maintainers', 'bash ./installer/docker/scripts/preflight-production-build.sh --help', 'OPEN-04']) assert.match(text, new RegExp(expected, 'i'));
  assert.doesNotMatch(text, /private key location|secret manager location|production host/i);
});

test('release-helper help contract remains non-direct, read-only, and tied to mode-100644 sources', async () => {
  const catalog = JSON.parse(await repositoryFile('docs/developers/catalog.json'));
  const contract = catalog.commands.find(({ id }) => id === 'release-helper-help');
  assert.equal(contract.command, 'bash ./installer/docker/scripts/preflight-production-build.sh --help && bash ./installer/docker/scripts/release-production.sh --help');
  assert.equal(contract.riskTier, 'A');
  assert.equal(contract.credentialNeed, 'none');
  assert.match(contract.sideEffects, /exits before.*Git mutation.*Docker login.*signing.*publication/i);
  assert.match(contract.cleanup, /does not write/i);
  assert.doesNotMatch(contract.command, /(?:^|&&\s*)\.\/installer\/docker\/scripts\/(?:preflight-production-build|release-production)\.sh/);

  const { stdout } = await execFileAsync('git', ['ls-files', '--stage', 'installer/docker/scripts/preflight-production-build.sh', 'installer/docker/scripts/release-production.sh'], { cwd: repositoryRoot });
  const entries = stdout.trim().split(/\r?\n/);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.startsWith('100644 ')));
});

test('catalog exposes governance/release authority, honest enforcement, and migration coverage', async () => {
  const catalog = JSON.parse(await repositoryFile('docs/developers/catalog.json'));
  assert.equal(catalog.journeys.find(({ id }) => id === 'maintain')?.path, 'docs/developers/governance.md');
  assert.equal(catalog.journeys.find(({ id }) => id === 'release')?.path, 'docs/developers/releases.md');
  assert.ok(catalog.ownerRoles.some(({ id }) => id === 'release-maintainers'));
  assert.ok(catalog.openItems.some(({ id, state, summary }) => id === 'OPEN-01' && state === 'open' && /unconfirmed/i.test(summary)));
  assert.ok(catalog.openItems.some(({ id, state, summary }) => id === 'OPEN-08' && state === 'open' && /unconfirmed/i.test(summary)));
  assert.ok(Array.isArray(catalog.migrationPolicies) && catalog.migrationPolicies.length > 0);
});
