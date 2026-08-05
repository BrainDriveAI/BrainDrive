import { diagnostic } from '../diagnostics.mjs';

const REQUIRED = ['id', 'command', 'workingDirectory', 'prerequisites', 'platforms', 'modes', 'credentialNeed', 'sideEffects', 'expectedResult', 'failureClassification', 'cleanup', 'riskTier'];

export function validateCommands(commands = []) {
  const diagnostics = [];
  for (const command of commands) {
    for (const field of REQUIRED) {
      const value = command[field];
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) diagnostics.push(diagnostic('DA-11', `command:${command.id || '<missing>'}`, `command descriptor is missing ${field}`));
    }
    if (!['A', 'B', 'C'].includes(command.riskTier)) diagnostics.push(diagnostic('DA-11', `command:${command.id || '<missing>'}`, 'command descriptor riskTier must be A, B, or C'));
    if (['B', 'C'].includes(command.riskTier)) {
      for (const field of ['target', 'authority', 'recovery']) if (!command[field]) diagnostics.push(diagnostic('DA-11', `command:${command.id || '<missing>'}`, `risk Tier ${command.riskTier} command is missing ${field}`));
    } else if (!command.recovery) diagnostics.push(diagnostic('DA-11', `command:${command.id || '<missing>'}`, 'command descriptor is missing recovery'));
  }
  return diagnostics;
}

export function validatePackageScripts(packageJson) {
  const expected = {
    'docs:test': 'node --test ../../tools/docs/test/*.test.mjs',
    'docs:check': 'node ../../tools/docs/check.mjs',
    'docs:verify': 'npm run docs:test && npm run docs:check',
  };
  return Object.entries(expected).flatMap(([name, command]) => packageJson.scripts?.[name] === command ? [] : [diagnostic('DA-10', 'builds/typescript/package.json', `package script ${name} must equal: ${command}`)]);
}
