import { lstatSync, realpathSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export function isWithin(root, target) {
  const relation = relative(root, target);
  return relation === '' || (!relation.startsWith('..') && !isAbsolute(relation));
}

export function inspectContainedPathSync(root, candidate, { allowSymlink = false, regularFile = true } = {}) {
  const rootReal = realpathSync(root);
  const lexical = resolve(root, candidate);
  if (!isWithin(rootReal, lexical)) return { ok: false, reason: 'path escapes repository root' };
  let info;
  try { info = lstatSync(lexical); } catch { return { ok: false, reason: 'path does not exist' }; }
  if (info.isSymbolicLink() && !allowSymlink) return { ok: false, reason: 'symlink is not permitted for this input' };
  const resolved = realpathSync(lexical);
  if (!isWithin(rootReal, resolved)) return { ok: false, reason: 'resolved path escapes repository root' };
  if (regularFile && !info.isFile() && !(allowSymlink && lstatSync(resolved).isFile())) return { ok: false, reason: 'path is not a regular file' };
  return { ok: true, lexical, resolved, info };
}

export async function inspectContainedPath(root, candidate, { allowSymlink = false, regularFile = true } = {}) {
  const rootReal = await realpath(root);
  const lexical = resolve(root, candidate);
  if (!isWithin(rootReal, lexical)) return { ok: false, reason: 'path escapes validation root' };
  let info;
  try { info = await lstat(lexical); } catch { return { ok: false, reason: 'path does not exist' }; }
  if (info.isSymbolicLink() && !allowSymlink) return { ok: false, reason: 'symlink is not permitted for documentation input' };
  const resolved = await realpath(lexical);
  if (!isWithin(rootReal, resolved)) return { ok: false, reason: 'resolved path escapes validation root' };
  if (regularFile && !info.isFile() && !(allowSymlink && (await lstat(resolved)).isFile())) return { ok: false, reason: 'path is not a regular file' };
  return { ok: true, lexical, resolved, info };
}

export async function readContainedText(root, candidate, options) {
  const inspected = await inspectContainedPath(root, candidate, options);
  if (!inspected.ok) return inspected;
  return { ...inspected, text: await readFile(inspected.lexical, 'utf8') };
}
