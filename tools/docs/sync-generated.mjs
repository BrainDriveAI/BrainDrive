import { readFile, writeFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnostic } from './lib/diagnostics.mjs';
import { inspectContainedPath, readContainedText } from './lib/paths.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function applicability(topic) {
  const branches = topic.applicability?.branches?.map((branch) => `\`${branch}\``).join(', ');
  const milestone = topic.applicability?.milestone;
  return `${topic.status[0].toUpperCase()}${topic.status.slice(1)}${branches ? ` on ${branches}` : ''}${milestone === undefined ? '' : `; Milestone ${milestone}`}.`;
}

export function renderContract(topic, catalog) {
  const audienceLabels = new Map((catalog.audiences || []).map(({ id, label }) => [id, label]));
  const audiences = topic.audiences.map((id) => audienceLabels.get(id) || id).join(', ');
  const topics = new Map((catalog.topics || []).map((entry) => [entry.topicId, entry]));
  const binding = (catalog.topicBindings || []).find(({ topicId }) => topicId === topic.topicId);
  const relative = (target) => {
    const value = posix.relative(posix.dirname(topic.path), target);
    return value.startsWith('.') ? value : `./${value}`;
  };
  const parent = topic.parentPath ? `[${topic.parentPath}](${relative(topic.parentPath)})` : 'Not applicable';
  const adjacent = (topic.adjacentTopics || []).map((id) => {
    const entry = topics.get(id);
    return entry ? `[${entry.title}](${relative(entry.path)})` : id;
  }).join('; ') || 'None declared';
  return [
    `<!-- catalog-contract:start ${topic.topicId} -->`,
    '> **Document contract**',
    `> - Purpose: ${topic.purpose}.`,
    `> - Audience: ${audiences}.`,
    `> - Status: ${applicability(topic)}`,
    `> - Owner role: ${topic.ownerRole}.`,
    `> - Expected outcome: ${topic.expectedOutcome}.`,
    `> - Prerequisites: ${topic.prerequisites.join('; ')}.`,
    `> - Parent: ${parent}.`,
    `> - Adjacent topics: ${adjacent}.`,
    `> - Keywords: ${(topic.keywords || []).map((keyword) => `\`${keyword}\``).join(', ') || 'None declared'}.`,
    `> - Sources: ${(binding?.sources || []).map((path) => `[\`${path}\`](${relative(path)})`).join('; ') || 'None declared'}.`,
    `> - Tests: ${(binding?.tests || []).map((path) => `[\`${path}\`](${relative(path)})`).join('; ') || 'None declared'}.`,
    `<!-- catalog-contract:end ${topic.topicId} -->`,
  ].join('\n');
}

export async function synchronizeGenerated({ root = repositoryRoot, write = false } = {}) {
  const diagnostics = [];
  const catalogInput = await readContainedText(root, 'docs/developers/catalog.json');
  if (!catalogInput.ok) return [diagnostic('DA-16', 'docs/developers/catalog.json', `catalog was not read: ${catalogInput.reason}`)];
  let catalog;
  try { catalog = JSON.parse(catalogInput.text); }
  catch { return [diagnostic('DA-06', 'docs/developers/catalog.json', 'catalog is invalid JSON')]; }
  for (const topic of catalog.topics.filter(({ projection }) => projection)) {
    const inspected = await inspectContainedPath(root, topic.path);
    if (!inspected.ok) {
      diagnostics.push(diagnostic('DA-16', 'docs/developers/catalog.json', `projection path is unsafe: ${inspected.reason}`));
      continue;
    }
    const path = inspected.lexical;
    const content = await readFile(path, 'utf8');
    const start = `<!-- catalog-contract:start ${topic.topicId} -->`;
    const end = `<!-- catalog-contract:end ${topic.topicId} -->`;
    const pattern = new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const expected = renderContract(topic, catalog);
    if (!pattern.test(content)) {
      diagnostics.push(diagnostic('DA-06', topic.path, `declared catalog projection markers are missing for ${topic.topicId}`));
      continue;
    }
    const current = content.match(pattern)[0];
    if (current.replace(/\r\n/g, '\n') !== expected) {
      const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
      const nativeExpected = lineEnding === '\r\n' ? expected.replace(/\n/g, '\r\n') : expected;
      if (write) await writeFile(path, content.replace(pattern, nativeExpected));
      else diagnostics.push(diagnostic('DA-07', topic.path, `declared catalog projection diverges for ${topic.topicId}`, 'Run sync-generated.mjs --write only when the catalog change is intentional'));
    }
  }
  return diagnostics;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || '--check';
  if (!['--check', '--write'].includes(mode)) {
    console.error('Usage: node tools/docs/sync-generated.mjs --check|--write');
    process.exitCode = 2;
  } else {
    const diagnostics = await synchronizeGenerated({ write: mode === '--write' });
    for (const item of diagnostics) console.error(`[${item.rule}] ${item.path}: ${item.message}`);
    if (diagnostics.length) process.exitCode = 1;
    else console.log(`Documentation projections ${mode === '--write' ? 'synchronized' : 'match the catalog'}.`);
  }
}
