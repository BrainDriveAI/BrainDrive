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
  return diagnostics;
}
