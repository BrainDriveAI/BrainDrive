import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateCommands } from '../lib/rules/commands.mjs';
import { validateSchema } from '../lib/schema.mjs';

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/commands/${name}`, import.meta.url), 'utf8'));

test('complete Tier A command passes', async () => {
  assert.deepEqual(validateCommands([await fixture('valid-tier-a.json')]), []);
});

test('every material command declares failure classification and cleanup', async () => {
  const command = { ...(await fixture('valid-tier-a.json')) };
  delete command.failureClassification;
  delete command.cleanup;
  const diagnostics = validateCommands([command]);
  assert.ok(diagnostics.some((item) => item.rule === 'DA-11' && item.message.includes('failureClassification')));
  assert.ok(diagnostics.some((item) => item.rule === 'DA-11' && item.message.includes('cleanup')));
});

test('Tier B and C commands require an explicit target and authority', async () => {
  const command = await fixture('risky-missing-target.json');
  const diagnostics = validateCommands([command]);
  assert.ok(diagnostics.some((item) => item.rule === 'DA-11' && item.message.includes('target')));
  delete command.authority;
  const authorityDiagnostics = validateCommands([command]);
  assert.ok(authorityDiagnostics.some((item) => item.rule === 'DA-11' && item.message.includes('authority')));
});

test('catalog command schema enforces Tier B target and authority', async () => {
  const schema = JSON.parse(await readFile(new URL('../schemas/catalog.schema.json', import.meta.url), 'utf8'));
  const command = await fixture('risky-missing-target.json');
  const diagnostics = validateSchema({ ...schema, ...schema.$defs.command }, command, 'command');
  assert.ok(diagnostics.some((item) => item.message.includes('target')));
  delete command.authority;
  const authorityDiagnostics = validateSchema({ ...schema, ...schema.$defs.command }, command, 'command');
  assert.ok(authorityDiagnostics.some((item) => item.message.includes('authority')));
});

for (const [name, expected] of [
  ['missing-working-directory.json', 'workingDirectory'],
  ['risky-missing-recovery.json', 'recovery'],
  ['credential-unstated.json', 'credentialNeed'],
]) {
  test(`${name} fails for ${expected}`, async () => {
    const diagnostics = validateCommands([await fixture(name)]);
    assert.ok(diagnostics.some((item) => item.rule === 'DA-11' && item.message.includes(expected)));
  });
}
