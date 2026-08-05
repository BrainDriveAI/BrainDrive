import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { validateMarkdownTree } from '../lib/rules/links.mjs';
import { validatePlainSourceText } from '../lib/rules/structure.mjs';

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
    const outside = resolve(temporary, 'outside');
    await mkdir(docs);
    await mkdir(outside);
    await writeFile(resolve(outside, 'linked.md'), '# outside-private-marker\n');
    await symlink(outside, resolve(docs, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    await writeFile(resolve(docs, 'index.md'), '# Index\n\n[Linked](external/linked.md#outside-private-marker)\n');
    const diagnostics = await validateMarkdownTree(new URL(`file://${docs}/`));
    assert.ok(diagnostics.some((item) => item.rule === 'DA-16'));
    assert.ok(diagnostics.every((item) => !item.message.includes('outside-private-marker')));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('plain-source fixture with descriptive Markdown and a diagram alternative passes', async () => {
  const content = await readFile(new URL('./fixtures/plain-source/valid.md', import.meta.url), 'utf8');
  assert.deepEqual(validatePlainSourceText('valid.md', content), []);
});

test('plain-source H1 accepts a BOM and rejects a missing visible title', () => {
  assert.deepEqual(validatePlainSourceText('bom.md', '\uFEFF# Visible title\n'), []);
  assert.ok(validatePlainSourceText('missing-title.md', 'Body only.\n').some(({ message }) => /level-one heading/.test(message)));
  assert.ok(validatePlainSourceText('fenced-title.md', '```markdown\n# Hidden title\n```\n').some(({ message }) => /level-one heading/.test(message)));
});

test('website-only and inaccessible plain-source constructs fail actionably', async () => {
  const content = await readFile(new URL('./fixtures/plain-source/website-only.md', import.meta.url), 'utf8');
  const diagnostics = validatePlainSourceText('website-only.md', content);
  assert.ok(diagnostics.length >= 4);
  assert.ok(diagnostics.every(({ rule, path }) => rule === 'DA-17' && path === 'website-only.md'));
  for (const expected of ['embedded renderer', 'descriptive link text', 'text alternative', 'image alternative']) {
    assert.ok(diagnostics.some(({ message }) => message.includes(expected)), `missing DA-17 diagnostic for ${expected}`);
  }
});

test('reference links, HTML images, and each Mermaid diagram receive independent DA-17 checks', () => {
  const content = '# Fixture\n\n[Click here][route]\n\n![][asset]\n\n<img src="asset.svg">\n\n```mermaid\nA-->B\n```\n\n```mermaid\nB-->C\n```\n\nText alternative: B leads to C.\n\n[route]: destination.md\n[asset]: asset.svg\n';
  const diagnostics = validatePlainSourceText('fixture.md', content);
  assert.ok(diagnostics.some(({ message }) => /descriptive link text/.test(message)));
  assert.ok(diagnostics.filter(({ message }) => /image alternative/.test(message)).length >= 2);
  assert.equal(diagnostics.filter(({ message }) => /diagram requires an adjacent text alternative/.test(message)).length, 1);
});

test('Markdown examples inside code fences do not trigger rendered-link or image diagnostics', () => {
  const content = '# Fixture\n\n```markdown\n[Click here](destination.md)\n![](asset.svg)\n```\n';
  assert.deepEqual(validatePlainSourceText('fixture.md', content), []);
});

test('reference-style links are resolved and headings inside fences are not anchors', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-reference-links-'));
  try {
    await writeFile(resolve(temporary, 'index.md'), '# Index\n\n[Target][missing]\n\n[Shortcut]\n\n[missing]: absent.md\n[Shortcut]: shortcut-missing.md\n\n[Code heading](#not-real)\n\n````markdown\n```\n# Not real\n```\n````\n');
    const diagnostics = await validateMarkdownTree(new URL(`file://${temporary}/`));
    assert.equal(diagnostics.filter(({ rule }) => rule === 'DA-04').length, 3);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('shortcut generic references receive DA-17 diagnostics', () => {
  const diagnostics = validatePlainSourceText('shortcut.md', '# Shortcut\n\n[Click here]\n\n[Click here]: missing.md\n');
  assert.ok(diagnostics.some(({ message }) => /descriptive link text/.test(message)));
});

test('indented backtick and tilde Mermaid fences each require a text alternative', () => {
  const content = '# Diagrams\n\n  ```mermaid\nA-->B\n  ```\n\n~~~mermaid\nB-->C\n~~~\n';
  const diagnostics = validatePlainSourceText('diagrams.md', content);
  assert.equal(diagnostics.filter(({ message }) => /diagram requires an adjacent text alternative/.test(message)).length, 2);
});
