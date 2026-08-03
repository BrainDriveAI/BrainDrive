import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { validateMarkdownTree } from '../lib/rules/links.mjs';

const root = new URL('./fixtures/links/', import.meta.url);

test('valid relative links and anchors pass', async () => {
  assert.deepEqual(await validateMarkdownTree(new URL('valid/', root)), []);
});

test('broken relative link identifies source and target', async () => {
  const diagnostics = await validateMarkdownTree(new URL('broken-relative/', root));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-04' && item.path.endsWith('index.md') && item.message.includes('missing.md')));
});

test('GitHub anchor edge cases distinguish valid and invalid anchors', async () => {
  const diagnostics = await validateMarkdownTree(new URL('anchor-edge-cases/', root));
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0].message, /redacted-anchor/);
});

test('escaping relative links fail closed without exposing the target', async () => {
  const diagnostics = await validateMarkdownTree(new URL('escape-relative/', root));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-16'));
  assert.ok(diagnostics.every((item) => !item.message.includes('outside-private-marker')));
});

test('symlink targets fail closed before reading outside content', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-links-'));
  try {
    const docs = resolve(temporary, 'docs');
    await mkdir(docs);
    await writeFile(resolve(temporary, 'outside.md'), '# outside-private-marker\n');
    await symlink(resolve(temporary, 'outside.md'), resolve(docs, 'linked.md'));
    await writeFile(resolve(docs, 'index.md'), '# Index\n\n[Linked](linked.md#outside-private-marker)\n');
    const diagnostics = await validateMarkdownTree(new URL(`file://${docs}/`));
    assert.ok(diagnostics.some((item) => item.rule === 'DA-16'));
    assert.ok(diagnostics.every((item) => !item.message.includes('outside-private-marker')));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
