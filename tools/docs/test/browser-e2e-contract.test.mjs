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
    'BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT',
    'sanitized-browser-run.json',
    'spec10-browser-recovery-matrix.json',
    'validateBrowserRecoveryManifest',
    'spec10-browser-inference-matrix.json',
    'validateBrowserInferenceManifest',
    'raw_playwright_trace_retained: false',
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

test('opt-in browser evidence retention stays synthetic, allowlisted, and non-replayable', async () => {
  const verification = await readRepositoryFile('docs/developers/verification.md');
  const webReadme = await readRepositoryFile('builds/typescript/client_web/README.md');
  const catalog = JSON.parse(await readRepositoryFile('docs/developers/catalog.json'));
  const browserCommand = catalog.commands.find(({ id }) => id === 'browser-e2e');

  for (const text of [verification, webReadme]) {
    assert.match(text, /BRAINDRIVE_E2E_RETAIN_EVIDENCE_ROOT/);
    assert.match(text, /three allowlisted synthetic screenshots/i);
    assert.match(text, /strict content-free recovery and inference manifests/i);
    assert.match(text, /sanitized-browser-run\.json/);
    assert.match(text, /raw Playwright trace[^.]*never retained/i);
    assert.match(text, /default[^.]*disposable[^.]*no artifacts? retained/i);
  }
  assert.match(browserCommand?.sideEffects ?? '', /explicit opt-in external task-owned evidence root/i);
  assert.match(browserCommand?.cleanup ?? '', /raw Playwright trace is never retained/i);
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
