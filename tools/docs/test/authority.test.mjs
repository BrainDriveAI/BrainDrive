import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { validateAuthorityFixture } from '../lib/rules/authority.mjs';
import { validateDuplicationFixture } from '../lib/rules/duplication.mjs';
import { synchronizeGenerated } from '../sync-generated.mjs';

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
