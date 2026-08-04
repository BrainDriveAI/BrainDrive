import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repositoryRoot = new URL('../../../', import.meta.url);
const read = (path) => readFile(new URL(path, repositoryRoot), 'utf8');

const lifecycleScripts = [
  'installer/docker/scripts/install.ps1',
  'installer/docker/scripts/start.ps1',
  'installer/docker/scripts/stop.ps1',
];

test('PowerShell lifecycle scripts share a fail-closed native-command wrapper', async () => {
  const helper = await read('installer/docker/scripts/native-command.ps1');

  assert.match(helper, /& \$Command @Arguments\s+\$exitCode = \$LASTEXITCODE/);
  assert.match(helper, /if \(\$exitCode -ne 0\)[\s\S]+throw/);

  for (const path of lifecycleScripts) {
    const source = await read(path);
    assert.match(source, /\. "\$scriptDir\/native-command\.ps1"/, `${path} does not load the native-command wrapper`);
    assert.match(source, /Invoke-CheckedNativeCommand/, `${path} does not use the native-command wrapper`);
  }
});

test('PowerShell lifecycle scripts leave no unchecked direct Docker invocation', async () => {
  for (const path of lifecycleScripts) {
    const lines = (await read(path)).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^\s*docker\s/.test(lines[index])) continue;

      const nextLine = lines.slice(index + 1).find((line) => line.trim());
      assert.match(
        nextLine ?? '',
        /\$LASTEXITCODE/,
        `${path}:${index + 1} invokes Docker without immediately adjudicating its exit code`,
      );
    }
  }
});

test('PowerShell lifecycle success output follows the final checked Docker command', async () => {
  const expectations = [
    ['installer/docker/scripts/install.ps1', 'Write-BrainDriveAccessInfo'],
    ['installer/docker/scripts/start.ps1', 'Write-BrainDriveAccessInfo'],
    ['installer/docker/scripts/stop.ps1', 'Write-Host "Stop complete'],
  ];

  for (const [path, successMarker] of expectations) {
    const source = await read(path);
    const finalCheckedCommand = source.lastIndexOf('Invoke-CheckedNativeCommand');
    assert.ok(finalCheckedCommand >= 0, `${path} has no checked Docker command`);
    assert.ok(source.indexOf(successMarker, finalCheckedCommand) > finalCheckedCommand, `${path} prints success before Docker is checked`);
  }
});
