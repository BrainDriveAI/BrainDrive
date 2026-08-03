import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnostic } from '../diagnostics.mjs';
import { headingAnchors, markdownLinks } from '../markdown.mjs';
import { inspectContainedPath } from '../paths.mjs';

function safeLinkLabel(rawPath, anchor) {
  const safePath = /^[\p{L}\p{N}._/-]+$/u.test(rawPath || '') && !(rawPath || '').includes('..') ? rawPath : '[redacted-link-target]';
  if (!anchor) return safePath;
  const fingerprint = createHash('sha256').update(anchor).digest('hex').slice(0, 12);
  return `${safePath || '.'}#[redacted-anchor:${fingerprint}]`;
}

async function markdownFiles(root) {
  const base = fileURLToPath(root);
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.name.endsWith('.md')) found.push(path);
    }
  }
  await visit(base);
  return found;
}

export async function validateMarkdownTree(root) {
  return validateMarkdownFiles(fileURLToPath(root), await markdownFiles(root));
}

export async function validateMarkdownFiles(root, files) {
  const diagnostics = [];
  const cache = new Map();
  async function text(path) {
    if (!cache.has(path)) cache.set(path, await readFile(path, 'utf8'));
    return cache.get(path);
  }
  for (const source of files) {
    const sourceInspection = await inspectContainedPath(root, source);
    if (!sourceInspection.ok) {
      diagnostics.push(diagnostic('DA-16', source.startsWith(root) ? source.slice(root.length).replace(/^\//, '') : '[redacted-path]', sourceInspection.reason));
      continue;
    }
    const markdown = await text(source);
    for (const target of markdownLinks(markdown)) {
      if (/^(?:[a-z]+:|mailto:)/i.test(target)) continue;
      const [rawPath, anchor] = target.split('#', 2);
      const resolved = rawPath ? resolve(dirname(source), decodeURIComponent(rawPath)) : source;
      const label = safeLinkLabel(rawPath, anchor);
      const targetInspection = await inspectContainedPath(root, resolved);
      if (!targetInspection.ok) {
        const rule = targetInspection.reason === 'path does not exist' ? 'DA-04' : 'DA-16';
        diagnostics.push(diagnostic(rule, source, `${targetInspection.reason}: ${label}`));
        continue;
      }
      if (anchor && extname(resolved).toLowerCase() === '.md') {
        const anchors = headingAnchors(await text(resolved));
        if (!anchors.has(decodeURIComponent(anchor).toLowerCase())) diagnostics.push(diagnostic('DA-04', source, `link anchor does not exist: ${label}`));
      }
    }
  }
  return diagnostics.map((item) => ({ ...item, path: item.path.startsWith(root) ? item.path.slice(root.length).replace(/^\//, '') || '.' : item.path }));
}
