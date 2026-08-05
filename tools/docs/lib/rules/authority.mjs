import { lstat, readFile, readlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnostic } from '../diagnostics.mjs';
import { inspectContainedPath, readContainedText } from '../paths.mjs';

const normalizeLineEndings = (text) => text.replace(/\r\n/g, '\n');

export async function validateAuthorityFixture(root) {
  const base = fileURLToPath(root);
  const declaration = JSON.parse(await readFile(resolve(base, 'authority.json'), 'utf8'));
  if (declaration.kind === 'product-agent') {
    return declaration.path.includes('memory/starter-pack/') && declaration.path.endsWith('/AGENT.md') ? [] : [diagnostic('DA-08', declaration.path, 'product AGENT fixture is not classified under starter-pack')];
  }
  const source = await readFile(resolve(base, declaration.source), 'utf8');
  const projection = await readFile(resolve(base, declaration.projection), 'utf8');
  return source === projection ? [] : [diagnostic('DA-07', declaration.projection, `declared ${declaration.kind} diverges from canonical source ${declaration.source}`, 'Edit the canonical source and synchronize the declaration')];
}

export async function validateRepositoryAuthority(root, catalog) {
  const diagnostics = [];
  const canonical = await readContainedText(root, 'AGENTS.md');
  if (!canonical.ok) diagnostics.push(diagnostic('DA-16', 'AGENTS.md', `canonical agent instructions were not read: ${canonical.reason}`));
  for (const path of ['CLAUDE.md', 'GEMINI.md']) {
    const inspected = await inspectContainedPath(root, path, { allowSymlink: true });
    if (!inspected.ok) {
      diagnostics.push(diagnostic('DA-16', path, `agent compatibility alias was not read: ${inspected.reason}`));
      continue;
    }
    const full = inspected.lexical;
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      if (await readlink(full) !== 'AGENTS.md') diagnostics.push(diagnostic('DA-07', path, 'compatibility symlink must target AGENTS.md'));
    } else {
      const mirror = await readContainedText(root, path);
      const isGitSymlinkPlaceholder = process.platform === 'win32' && mirror.ok && mirror.text.trim() === 'AGENTS.md';
      if (process.platform !== 'win32') diagnostics.push(diagnostic('DA-07', path, 'compatibility mirror must remain a symlink to AGENTS.md'));
      if (
        canonical.ok &&
        mirror.ok &&
        !isGitSymlinkPlaceholder &&
        normalizeLineEndings(canonical.text) !== normalizeLineEndings(mirror.text)
      ) diagnostics.push(diagnostic('DA-07', path, 'compatibility mirror diverges from canonical AGENTS.md'));
    }
  }
  const classes = new Map((catalog.documents || []).map((item) => [item.path, item.classification]));
  for (const path of (catalog.documents || []).map(({ path }) => path).filter((path) => path.includes('/memory/starter-pack/') && path.endsWith('/AGENT.md'))) {
    if (classes.get(path) !== 'product-agent-artifact') diagnostics.push(diagnostic('DA-08', path, 'starter-pack AGENT.md must be classified as a product-agent-artifact'));
  }
  const contract = catalog.agentContract;
  if (!contract) {
    diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', 'catalog is missing the machine-readable agentContract'));
    return diagnostics;
  }
  const instructions = contract.governingInstructions || [];
  const expectedInstructions = [
    { path: 'AGENTS.md', scope: '**', kind: 'canonical-root', precedence: 1 },
    { path: 'docs/AGENTS.md', scope: 'docs/**', kind: 'additive-scoped', precedence: 2 },
  ];
  if (JSON.stringify(instructions) !== JSON.stringify(expectedInstructions)) diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', 'agentContract governing instructions must declare the exact root and additive docs scope, kind, and precedence'));
  const mirrors = new Map((contract.compatibilityMirrors || []).map((item) => [item.path, item]));
  for (const path of ['CLAUDE.md', 'GEMINI.md']) if (mirrors.get(path)?.canonicalPath !== 'AGENTS.md' || mirrors.get(path)?.independentAuthority !== false) diagnostics.push(diagnostic('DA-07', path, 'agentContract compatibility mirror must point to AGENTS.md and deny independent authority'));
  if (!(contract.artifactClasses || []).some(({ pattern, classification, codingAuthority }) => pattern === 'builds/typescript/memory/starter-pack/**/AGENT.md' && classification === 'product-agent-artifact' && codingAuthority === false)) diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', 'agentContract must classify tracked starter-pack AGENT.md files as non-governing product artifacts'));
  const restrictedPatterns = new Set((contract.restrictedExclusions || []).map(({ pattern }) => pattern));
  for (const pattern of ['builds/typescript/your-memory/**', 'builds/typescript/your-memory*', 'builds/typescript/.paa-secrets/**', 'builds/typescript/.paa-secrets*', 'builds/typescript/.reset-backups/**', 'builds/typescript/.your-memory.root-owned.backup/**', 'installer/docker/backups/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/target/**', '**/coverage/**', '**/vendor/**', '**/.cache/**', 'docs/Security/**']) {
    if (!restrictedPatterns.has(pattern)) diagnostics.push(diagnostic('DA-16', 'docs/developers/catalog.json', `agentContract must exclude restricted candidate pattern ${pattern}`));
  }
  for (const [key, field] of [['taskRoutes', 'id'], ['changeRoutes', 'id'], ['checkRoutes', 'id'], ['pairedChangeObligations', 'id']]) {
    const values = (contract[key] || []).map((item) => item[field]);
    if (new Set(values).size !== values.length) diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', `agentContract ${key} contains duplicate IDs`));
  }
  const checkIds = new Set((contract.checkRoutes || []).map(({ id }) => id));
  const commandIds = new Set((catalog.commands || []).map(({ id }) => id));
  const pairedIds = new Set((contract.pairedChangeObligations || []).map(({ id }) => id));
  for (const route of contract.checkRoutes || []) for (const id of route.broaderCommandIds || []) if (!commandIds.has(id)) diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `agent check route ${route.id} references unknown command ${id}`));
  for (const route of contract.changeRoutes || []) {
    for (const id of route.checkRouteIds || []) if (!checkIds.has(id)) diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `agent change route ${route.id} references unknown check route ${id}`));
    for (const id of route.pairedChangeIds || []) if (!pairedIds.has(id)) diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `agent change route ${route.id} references unknown paired-change obligation ${id}`));
  }
  const routes = new Map((contract.changeRoutes || []).map((route) => [route.id, route]));
  const requiredRouteMembers = {
    'web-to-tool-change': {
      sourcePaths: ['builds/typescript/client_web/src/api/gateway-adapter.ts', 'builds/typescript/engine/tool-executor.ts'],
      configurationPaths: ['builds/typescript/config.json', 'builds/typescript/mcp/servers.full-mcp.json'],
      testPaths: ['builds/typescript/client_web/src/api/gateway-adapter.test.ts', 'builds/typescript/client_web/src/components/chat/ChatPanel.test.tsx'],
    },
    'first-party-mcp-change': {
      sourcePaths: ['builds/typescript/mcp/client.ts'],
      configurationPaths: ['builds/typescript/mcp/servers.full-mcp.json', 'builds/typescript/mcp/servers.full-mcp.docker.json'],
    },
    'provider-change': { testPaths: ['builds/typescript/gateway/provider-activation.test.ts'] },
    'provider-ui-change': {
      sourcePaths: ['builds/typescript/client_web/src/components/settings/SettingsModal.tsx'],
      testPaths: ['builds/typescript/client_web/src/components/settings/SettingsModal.test.tsx'],
    },
    'memory-template-change': { testPaths: ['builds/typescript/memory/starter-pack-draft3-layout.test.ts', 'builds/typescript/gateway/auth-routes.integration.test.ts'] },
  };
  for (const [routeId, fields] of (contract.changeRoutes || []).length ? Object.entries(requiredRouteMembers) : []) {
    const route = routes.get(routeId);
    for (const [field, paths] of Object.entries(fields)) for (const path of paths) {
      if (!(route?.[field] || []).includes(path)) diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', `agent change route ${routeId} must include ${path} in ${field}`));
    }
  }
  const memoryObligation = (contract.pairedChangeObligations || []).find(({ id }) => id === 'memory-template-existing-owner');
  if (!memoryObligation) diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', 'agentContract requires the memory-template-existing-owner paired-change obligation'));
  if (memoryObligation && !/no active starter-pack updater/i.test(memoryObligation.existingOwnerDisposition || '')) diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', 'memory paired-change obligation must disclose that no active starter-pack updater exists'));
  if (memoryObligation && (!/exact recognized prior default/i.test(memoryObligation.proposedUpdaterRequirements || '') || !/customized/i.test(memoryObligation.proposedUpdaterRequirements || '') || !/idempotent/i.test(memoryObligation.proposedUpdaterRequirements || ''))) diagnostics.push(diagnostic('DA-08', 'docs/developers/catalog.json', 'memory paired-change obligation must define preservation-aware updater requirements'));
  const referencedPaths = [
    ...instructions.map(({ path }) => path),
    ...(contract.taskRoutes || []).flatMap(({ startPaths = [] }) => startPaths),
    ...(contract.changeRoutes || []).flatMap((route) => ['sourcePaths', 'callerPaths', 'configurationPaths', 'testPaths', 'documentationPaths'].flatMap((key) => route[key] || [])),
  ];
  for (const path of new Set(referencedPaths)) {
    const inspected = await inspectContainedPath(root, path, { regularFile: false });
    if (!inspected.ok) diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `agentContract path is invalid: ${path}`));
  }
  return diagnostics;
}
