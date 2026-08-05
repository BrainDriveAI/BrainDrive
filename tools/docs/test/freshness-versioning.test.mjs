import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateFreshness } from '../lib/rules/freshness.mjs';
import { validateVersioning } from '../lib/rules/versioning.mjs';

const fixture = async (path) => JSON.parse(await readFile(new URL(`./fixtures/freshness/${path}`, import.meta.url), 'utf8'));

test('explicit version domains pass', async () => {
  assert.deepEqual(validateVersioning(await fixture('valid-domains.json')), []);
});

test('stale source mapping fails', async () => {
  const diagnostics = validateFreshness(await fixture('stale-source-map.json'));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13'));
});

test('tag guidance cannot point silently to later dev truth', async () => {
  const diagnostics = validateVersioning(await fixture('later-dev-link.json'));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-14'));
});

test('same-day patch changes revision without inventing review date', async () => {
  assert.deepEqual(validateFreshness(await fixture('same-day-patch.json')), []);
});

test('developer-relevant inventory requires exactly one migration disposition', async () => {
  const diagnostics = validateFreshness(await fixture('incomplete-migration.json'));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-13' && item.message.includes('migration disposition')));
});

test('version domains require explicit branch, tag, and compatibility contracts', async () => {
  const diagnostics = validateVersioning(await fixture('incomplete-release-domain.json'));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-14' && item.message.includes('branch/tag contract')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-09' && item.message.includes('deprecation contract')));
});
