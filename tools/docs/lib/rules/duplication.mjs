import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnostic } from '../diagnostics.mjs';
import { readContainedText } from '../paths.mjs';

export async function validateDuplicationFixture(root) {
  const base = fileURLToPath(root);
  const files = (await readdir(base)).filter((name) => name.endsWith('.md'));
  const paragraphs = new Map();
  const diagnostics = [];
  for (const file of files) {
    const content = await readFile(resolve(base, file), 'utf8');
    for (const paragraph of content.split(/\n\s*\n/).map((value) => value.trim()).filter((value) => value.length >= 120)) {
      const prior = paragraphs.get(paragraph);
      if (prior) diagnostics.push(diagnostic('DA-07', file, `material prose duplicates ${prior} without a declared canonical relation`));
      else paragraphs.set(paragraph, file);
    }
  }
  return diagnostics;
}

export async function validateRepositoryDuplication(root, catalog) {
  const paragraphs = new Map();
  const diagnostics = [];
  for (const topic of (catalog.topics || []).filter(({ status }) => status === 'current')) {
    const inspected = await readContainedText(root, topic.path);
    if (!inspected.ok) {
      diagnostics.push(diagnostic('DA-16', topic.path?.includes('..') ? 'docs/developers/catalog.json' : topic.path, `current authority was not read: ${inspected.reason}`));
      continue;
    }
    const content = inspected.text;
    for (const paragraph of content.split(/\n\s*\n/).map((value) => value.replace(/\s+/g, ' ').trim()).filter((value) => value.length >= 240 && !value.startsWith('<!-- catalog-contract:'))) {
      const prior = paragraphs.get(paragraph);
      if (prior && prior !== topic.path) diagnostics.push(diagnostic('DA-07', topic.path, `material current prose duplicates ${prior} without a declared generated or alias relation`));
      else paragraphs.set(paragraph, topic.path);
    }
  }
  return diagnostics;
}
