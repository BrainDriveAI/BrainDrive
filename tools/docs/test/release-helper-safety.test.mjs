import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = new URL('../../../', import.meta.url);
const repositoryFile = (relativePath) =>
  readFile(new URL(`../../../${relativePath}`, import.meta.url), 'utf8');

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('release version normalization updates and checks app, web, locks, and Tauri together', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'braindrive-release-version-test-'));
  try {
    await writeJson(path.join(root, 'builds/typescript/package.json'), { version: '1.0.0' });
    await writeJson(path.join(root, 'builds/typescript/package-lock.json'), {
      version: '1.0.0',
      packages: { '': { version: '1.0.0' } },
    });
    await writeJson(path.join(root, 'builds/typescript/client_web/package.json'), {
      version: '1.0.0',
    });
    await writeJson(path.join(root, 'builds/typescript/client_web/package-lock.json'), {
      version: '1.0.0',
      packages: { '': { version: '1.0.0' }, '..': { version: '1.0.0' } },
    });
    await writeJson(path.join(root, 'builds/typescript/src-tauri/tauri.conf.json'), {
      version: '1.0.0',
    });

    const script = fileURLToPath(
      new URL('../../../installer/docker/scripts/normalize-release-version.mjs', import.meta.url),
    );
    await execFileAsync(process.execPath, [script, '--root', root, '--write', '26.8.4']);
    await execFileAsync(process.execPath, [script, '--root', root, '--check', '26.8.4']);

    for (const [relativePath, segments] of [
      ['builds/typescript/package.json', ['version']],
      ['builds/typescript/package-lock.json', ['version']],
      ['builds/typescript/package-lock.json', ['packages', '', 'version']],
      ['builds/typescript/client_web/package.json', ['version']],
      ['builds/typescript/client_web/package-lock.json', ['version']],
      ['builds/typescript/client_web/package-lock.json', ['packages', '', 'version']],
      ['builds/typescript/client_web/package-lock.json', ['packages', '..', 'version']],
      ['builds/typescript/src-tauri/tauri.conf.json', ['version']],
    ]) {
      const value = JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
      assert.equal(segments.reduce((current, key) => current?.[key], value), '26.8.4');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release publication is pinned to a clean normalized immutable candidate', async () => {
  const script = await repositoryFile('installer/docker/scripts/release-production.sh');
  assert.match(script, /assert_clean_candidate/);
  assert.match(script, /normalize-release-version\.mjs[^\n]*--check/);
  assert.match(script, /CANDIDATE_REVISION="\$\(git rev-parse HEAD\)"/);
  assert.match(script, /git archive[\s\S]*?"\$\{CANDIDATE_REVISION\}"[\s\\]*\n[\s\S]*?installer\/docker/);
  assert.doesNotMatch(script, /normalize_package_version\(\)/);
});

test('production preflight fails closed on any dirty candidate', async () => {
  const script = await repositoryFile(
    'installer/docker/scripts/preflight-production-build.sh',
  );
  assert.match(script, /git status --porcelain=v1 --untracked-files=all/);
  assert.match(script, /requires a clean candidate/);
  assert.doesNotMatch(script, /Warning: working tree has local changes/);
});

test('latest tags move only after the release manifest is signed and verified', async () => {
  const script = await repositoryFile('installer/docker/scripts/release-production.sh');
  const publish = script.indexOf('publish-release-images.sh');
  const sign = script.indexOf('sign-release-manifest.sh');
  const verify = script.indexOf('verify-release-manifest.sh');
  const latest = script.indexOf('docker tag "${APP_IMAGE}:${IMAGE_TAG}"');
  assert.ok(publish >= 0 && sign > publish && verify > sign && latest > verify);
  assert.match(script, /Failure recovery/);
});

test('release helper declares a non-publishing dry run that exits before external mutation', async () => {
  const script = await repositoryFile('installer/docker/scripts/release-production.sh');
  assert.match(script, /--dry-run/);
  assert.match(script, /DRY_RUN/);
  assert.match(script, /Dry run complete; no Git checkout, pull, login, build, push, sign, tag, or publication occurred\./);
});
