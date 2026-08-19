import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, repositoryRoot), 'utf8');
const catalog = async () => JSON.parse(await read('docs/developers/catalog.json'));

const journeyTopics = [
  ['native-development-setup', 'docs/developers/setup/native.md'],
  ['docker-development-setup', 'docs/developers/setup/docker-development.md'],
  ['tauri-desktop-setup', 'docs/developers/setup/tauri-desktop.md'],
  ['change-verification', 'docs/developers/verification.md'],
  ['safe-debugging', 'docs/developers/debugging.md'],
  ['tauri-desktop-boundary', 'builds/typescript/src-tauri/README.md'],
];

test('catalog routes all Milestone 2 journeys to current source-backed topics', async () => {
  const value = await catalog();
  const topics = new Map(value.topics.map((topic) => [topic.topicId, topic]));
  const bindings = new Map(value.topicBindings.map((binding) => [binding.topicId, binding]));
  for (const [topicId, path] of journeyTopics) {
    const topic = topics.get(topicId);
    assert.equal(topic?.path, path);
    assert.equal(topic?.status, 'current');
    assert.ok(topic?.keywords?.length >= 2);
    assert.ok(topic?.parentPath);
    assert.ok(topic?.adjacentTopics?.length >= 1);
    assert.ok(bindings.get(topicId)?.sources.length >= 1);
    assert.ok(bindings.get(topicId)?.tests.length >= 1);
    assert.ok(bindings.get(topicId)?.commands.length >= 1);
  }
  assert.equal(value.journeys.find(({ id }) => id === 'run')?.path, 'docs/developers/setup/native.md');
  assert.equal(value.components.find(({ id }) => id === 'tauri-desktop')?.path, 'builds/typescript/src-tauri/README.md');
});

test('all three setup guides expose complete provider-separated command contracts', async () => {
  for (const path of journeyTopics.slice(0, 3).map(([, path]) => path)) {
    const text = await read(path);
    for (const heading of [
      '## Prerequisites',
      '## Command contract',
      '## Provider-independent baseline',
      '## Provider validation is separate',
      '## Failure classification',
      '## Cleanup and recovery',
      '## Source evidence',
    ]) assert.ok(text.includes(heading), `${path} is missing ${heading}`);
    for (const field of ['Working directory', 'Platform', 'Mode', 'Credential need', 'Side effects', 'Expected result', 'Risk tier']) {
      assert.ok(text.includes(field), `${path} is missing ${field}`);
    }
  }
});

test('verification guide maps change types to focused and broader checks without treating E2E as baseline', async () => {
  const text = await read('docs/developers/verification.md');
  for (const term of ['Runtime or gateway', 'Web client', 'Docker or installer', 'Tauri desktop', 'Documentation', 'Tier A', 'Tier B', 'Tier C', 'OPEN-06']) {
    assert.ok(text.includes(term), `verification guide is missing ${term}`);
  }
  assert.match(text, /Playwright[^\n]+not[^\n]+basic startup/i);
});

test('debugging guide classifies failures and forbids unsafe evidence collection', async () => {
  const text = await read('docs/developers/debugging.md');
  for (const term of ['prerequisite', 'dependency', 'port conflict', 'startup', 'provider', 'authentication', 'migration', 'sanitized evidence', 'Do not collect']) {
    assert.match(text, new RegExp(term, 'i'));
  }
});

test('source-adjacent READMEs preserve their assigned responsibilities and real launch paths', async () => {
  const runtime = await read('builds/typescript/README.md');
  const web = await read('builds/typescript/client_web/README.md');
  const tauri = await read('builds/typescript/src-tauri/README.md');
  const docker = await read('installer/docker/README.md');
  const scripts = await read('installer/docker/scripts/README.md');
  assert.match(runtime, /setup\/native\.md/);
  assert.match(web, /Vite[^\n]+8787/);
  assert.match(tauri, /embedded runtime/i);
  assert.match(tauri, /desktop:preflight/);
  assert.doesNotMatch(docker, /Repo root[^\n]+\.\/scripts\//);
  assert.doesNotMatch(docker, /Installer root[^\n]+\.\/scripts\//);
  assert.match(docker, /setup\/docker-development\.md/);
  assert.match(scripts, /Development lifecycle command contracts/);
});

test('clean-clone Tauri development prepares the configured runtime resource before Vite', async () => {
  const packageJson = JSON.parse(await read('builds/typescript/package.json'));
  const tauriConfig = JSON.parse(await read('builds/typescript/src-tauri/tauri.conf.json'));
  const prepareScript = await read('builds/typescript/scripts/desktop-prepare-dev.mjs');

  assert.equal(packageJson.scripts['desktop:prepare-dev'], 'node scripts/desktop-prepare-dev.mjs');
  assert.match(
    packageJson.scripts['desktop:test'],
    /^npm run desktop:prepare-dev[^\n]+cargo test/,
  );
  assert.match(
    tauriConfig.build.beforeDevCommand,
    /desktop:preflight[^\n]+desktop:prepare-dev[^\n]+desktop:dev:web/,
  );
  assert.match(prepareScript, /mkdir/);
  assert.match(prepareScript, /desktop-runtime/);
});

test('OPEN-06 records one accurate Playwright and Vite gateway startup contract', async () => {
  const value = await catalog();
  const open06 = value.openItems.find(({ id }) => id === 'OPEN-06');
  assert.match(open06?.state ?? '', /^resolved/);
  assert.match(open06?.summary ?? '', /8787/);
  const playwright = await read('builds/typescript/client_web/playwright.config.ts');
  const mobile = await read('builds/typescript/client_web/e2e/mobile-layout.spec.ts');
  const vite = await read('builds/typescript/client_web/vite.config.ts');
  assert.doesNotMatch(playwright, /localhost:3000/);
  assert.doesNotMatch(mobile, /localhost:3000/);
  const runner = await read('builds/typescript/client_web/scripts/run-isolated-e2e.mjs');
  assert.match(runner, /scripts\/dev-runtime\.mjs/);
  assert.match(runner, /VITE_GATEWAY_PROXY_TARGET/);
  assert.match(vite, /127\.0\.0\.1:8787/);
});

test('browser E2E has a reproducible disposable provider-independent auth seed', async () => {
  const value = await catalog();
  const commands = new Map(value.commands.map((command) => [command.id, command]));
  for (const id of ['browser-e2e', 'browser-e2e-mobile']) {
    const command = commands.get(id);
    assert.equal(command?.riskTier, 'B');
    assert.ok(command?.target);
    assert.ok(command?.authority);
    assert.match(command?.prerequisites.join(' ') ?? '', /Playwright browsers/i);
    assert.doesNotMatch(command?.prerequisites.join(' ') ?? '', /unresolved|initialized.*account/i);
  }
  const open10 = value.openItems.find(({ id }) => id === 'OPEN-10');
  assert.match(open10?.state ?? '', /^resolved/);
  assert.match(open10?.summary ?? '', /task-owned|disposable/i);
});

test('native isolation and Docker mutation/network boundaries are explicit', async () => {
  const native = await read('docs/developers/setup/native.md');
  const docker = await read('docs/developers/setup/docker-development.md');
  assert.match(native, /PAA_MEMORY_ROOT/);
  assert.match(native, /PAA_SECRETS_HOME/);
  for (const term of ['chown', 'BRAINDRIVE_DEV_HOST_UID', 'npm install', 'proxied', 'trusted LAN']) {
    assert.match(docker, new RegExp(term, 'i'));
  }
});

test('Tauri guidance preserves the WSL failure as diagnostic evidence without treating it as native platform support', async () => {
  const text = await read('docs/developers/setup/tauri-desktop.md');
  const value = await catalog();
  const open03 = value.openItems.find(({ id }) => id === 'OPEN-03');
  assert.match(text, /## Prior WSL diagnostic record/);
  assert.match(text, /Vite proxy/i);
  assert.match(text, /not [^\n]*passing J-05 evidence/i);
  assert.match(open03?.state ?? '', /deferred-required-before-milestone-7/);
  assert.match(open03?.summary ?? '', /Tauri/i);
  assert.match(open03?.summary ?? '', /native Windows/i);
  assert.match(open03?.summary ?? '', /native macOS/i);
});

test('Tauri configured bundle targets are distinct from claimed and evidenced J-05 platforms', async () => {
  const value = await catalog();
  const claim = value.platformClaims.find(({ id }) => id === 'tauri-development');

  assert.deepEqual(claim?.configuredBundleTargets, ['windows', 'macos', 'linux']);
  assert.deepEqual(claim?.claimedPlatforms, ['windows', 'macos']);
  assert.deepEqual(claim?.diagnosticOnlyEnvironments, ['wsl', 'linux']);
  assert.equal(claim?.journeyId, 'J-05');
  assert.deepEqual(
    claim?.requiredEvidence,
    [
      { platform: 'windows', environment: 'native', status: 'DEFERRED — REQUIRED BEFORE MILESTONE 7', reportPath: 'docs/developers/verification/platform-reports/windows-j05.json', schemaPath: 'tools/docs/schemas/platform-report.schema.json' },
      { platform: 'macos', environment: 'native', status: 'DEFERRED — REQUIRED BEFORE MILESTONE 7', reportPath: 'docs/developers/verification/platform-reports/macos-j05.json', schemaPath: 'tools/docs/schemas/platform-report.schema.json' },
    ],
  );

  const tauriCommand = value.commands.find(({ id }) => id === 'tauri-dev');
  assert.deepEqual(tauriCommand?.platforms, [
    'claimed V1 J-05: native windows, macos',
    'configured but not claimed for V1 J-05: native linux',
    'diagnostics only, not claimed J-05: wsl, linux',
  ]);
});
