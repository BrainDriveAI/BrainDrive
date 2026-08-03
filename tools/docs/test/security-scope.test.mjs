import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { enumerateCandidates } from '../lib/git-inputs.mjs';
import { validateCandidateScope, validateSecurityText } from '../lib/rules/security.mjs';

const text = (name) => readFile(new URL(`./fixtures/security/${name}`, import.meta.url), 'utf8');

test('approved synthetic placeholders pass', async () => {
  assert.deepEqual(validateSecurityText('synthetic-safe.md', await text('synthetic-safe.md')), []);
});

test('secret-shaped fixture fails without echoing the value', async () => {
  const source = await text('secret-like-rejected.md');
  const diagnostics = validateSecurityText('secret-like-rejected.md', source);
  assert.ok(diagnostics.some((item) => item.rule === 'DA-15'));
  assert.ok(diagnostics.every((item) => !item.message.includes(source.trim())));
});

test('ignored/generated/vendor canaries are excluded', async () => {
  const manifest = JSON.parse(await readFile(new URL('./fixtures/security/ignored-canary-manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateCandidateScope(manifest.candidates, manifest.forbidden), []);
  assert.ok(validateCandidateScope([...manifest.candidates, manifest.forbidden[0]], manifest.forbidden).some((item) => item.rule === 'DA-16'));
});

test('real Git enumeration excludes ignored canaries without reading them', async () => {
  const temporary = await mkdtemp(resolve(tmpdir(), 'docs-git-inputs-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: temporary });
    await writeFile(resolve(temporary, '.gitignore'), 'ignored/\nnode_modules/\n');
    await writeFile(resolve(temporary, 'tracked.md'), '# tracked\n');
    await mkdir(resolve(temporary, 'ignored'));
    await writeFile(resolve(temporary, 'ignored/private-marker.md'), '# never-read-private-marker\n');
    await mkdir(resolve(temporary, 'node_modules'));
    await writeFile(resolve(temporary, 'node_modules/vendor-marker.md'), '# never-read-vendor-marker\n');
    execFileSync('git', ['add', '.gitignore', 'tracked.md'], { cwd: temporary });
    const candidates = enumerateCandidates(temporary);
    assert.ok(candidates.includes('tracked.md'));
    assert.ok(!candidates.some((path) => path.includes('private-marker') || path.includes('vendor-marker')));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const name of ['provider-coupling.md', 'owned-key-example.md']) {
  test(`${name} fails provider safety`, async () => {
    const diagnostics = validateSecurityText(name, await text(name));
    assert.ok(diagnostics.some((item) => item.rule === 'DA-15'));
  });
}
