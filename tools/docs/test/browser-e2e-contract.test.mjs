import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readRepositoryFile = (path) =>
  readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('Playwright commands use a disposable task-owned local-auth seed contract', async () => {
  const packageJson = JSON.parse(
    await readRepositoryFile('builds/typescript/client_web/package.json'),
  );
  assert.equal(
    packageJson.scripts['test:e2e'],
    'npm run test:e2e:mobile && node scripts/run-isolated-e2e.mjs --project=desktop-chrome',
  );
  assert.equal(
    packageJson.scripts['test:e2e:mobile'],
    'node scripts/run-isolated-e2e.mjs --project=mobile-chrome --project=mobile-safari',
  );

  const runner = await readRepositoryFile(
    'builds/typescript/client_web/scripts/run-isolated-e2e.mjs',
  );
  for (const required of [
    'mkdtemp',
    'PAA_MEMORY_ROOT',
    'PAA_SECRETS_HOME',
    'PAA_AUTH_MODE',
    'BRAINDRIVE_E2E_ISOLATED',
    'BRAINDRIVE_E2E_ARTIFACT_ROOT',
    '/auth/signup',
    '/settings',
    'active_provider_profile: "ollama"',
    'assertMcpPortsAvailable',
    'waitForMcpPortsReleased',
    'killGroup',
    'rm(taskRoot',
  ]) {
    assert.match(runner, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(runner, /your-memory|\.paa-secrets|provider.*key/i);
});

test('isolated Playwright configuration cannot reuse an owner process or artifact root', async () => {
  const config = await readRepositoryFile(
    'builds/typescript/client_web/playwright.config.ts',
  );
  assert.match(config, /BRAINDRIVE_E2E_ISOLATED/);
  assert.match(config, /reuseExistingServer:\s*!isolatedE2e/);
  assert.match(config, /BRAINDRIVE_E2E_ARTIFACT_ROOT/);
  assert.match(config, /workers:\s*isolatedE2e\s*\?\s*1/);
});
