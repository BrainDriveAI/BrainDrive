import { posix } from 'node:path';
import { diagnostic } from '../diagnostics.mjs';

const REQUIRED_AUDIENCES = ['first-time-contributors', 'recurring-contributors', 'integrators', 'maintainers', 'security-researchers', 'release-engineers', 'ai-coding-agents', 'verification-reviewers'];
const REQUIRED_JOURNEYS = ['orient', 'run', 'contribute', 'trace', 'integrate', 'secure', 'maintain', 'release'];
const REQUIRED_COMPONENTS = ['web-client', 'gateway-api', 'engine-tools', 'auth-config', 'memory-secrets', 'providers-mcp', 'docker-installer', 'tauri-desktop', 'tests-ci', 'security-release'];
const ORIENTATION_TOPICS = ['developer-documentation-index', 'terminology', 'repository-map', 'architecture-overview', 'runtime-workspace-overview'];

export function validateStructure(catalog, candidates = []) {
  const diagnostics = [];
  const audienceIds = new Set((catalog.audiences || []).map(({ id }) => id));
  const journeyIds = new Set((catalog.journeys || []).map(({ id }) => id));
  const componentIds = new Set((catalog.components || []).map(({ id }) => id));
  const owners = new Set((catalog.ownerRoles || []).map(({ id }) => id));
  for (const id of REQUIRED_AUDIENCES) if (!audienceIds.has(id)) diagnostics.push(diagnostic('DA-01', 'docs/developers/catalog.json', `required audience route is missing: ${id}`));
  for (const id of REQUIRED_JOURNEYS) if (!journeyIds.has(id)) diagnostics.push(diagnostic('DA-01', 'docs/developers/catalog.json', `required journey route is missing: ${id}`));
  for (const id of REQUIRED_COMPONENTS) if (!componentIds.has(id)) diagnostics.push(diagnostic('DA-01', 'docs/developers/catalog.json', `required component route is missing: ${id}`));
  const declaredPaths = new Set([...(catalog.documents || []).map(({ path }) => path), ...(catalog.governanceSurfaces || []).map(({ path }) => path)]);
  const routes = [...(catalog.audiences || []), ...(catalog.journeys || []), ...(catalog.components || [])];
  for (const route of routes) {
    if (!declaredPaths.has(route.path)) diagnostics.push(diagnostic('DA-02', 'docs/developers/catalog.json', `route ${route.id} points to an undeclared path: ${route.path}`));
  }
  for (const topic of catalog.topics || []) {
    for (const audience of topic.audiences || []) if (!audienceIds.has(audience)) diagnostics.push(diagnostic('DA-01', topic.path, `topic references undeclared audience: ${audience}`));
    if (!owners.has(topic.ownerRole)) diagnostics.push(diagnostic('DA-06', topic.path, `topic references undeclared owner role: ${topic.ownerRole}`));
  }
  for (const entry of [...(catalog.documents || []), ...(catalog.governanceSurfaces || [])]) if (!owners.has(entry.ownerRole)) diagnostics.push(diagnostic('DA-06', entry.path, `inventory references undeclared owner role: ${entry.ownerRole}`));
  const currentRoutes = new Set(routes.map(({ path }) => path));
  for (const topic of catalog.topics || []) if (topic.status !== 'current' && currentRoutes.has(topic.path)) diagnostics.push(diagnostic('DA-09', topic.path, `non-current topic status ${topic.status} appears in a current route`));
  for (const document of catalog.documents || []) if (document.status !== 'current' && currentRoutes.has(document.path)) diagnostics.push(diagnostic('DA-09', document.path, `non-current document status ${document.status} appears in a current route`));
  for (const alias of catalog.aliases || []) if (alias.status !== 'current' && currentRoutes.has(alias.path)) diagnostics.push(diagnostic('DA-09', alias.path, `legacy or non-current alias appears in a current route`));
  const topicIds = new Set((catalog.topics || []).map(({ topicId }) => topicId));
  for (const id of ORIENTATION_TOPICS) {
    const topic = (catalog.topics || []).find(({ topicId }) => topicId === id);
    if (!topic) {
      diagnostics.push(diagnostic('DA-01', 'docs/developers/catalog.json', `required orientation topic is missing: ${id}`));
      continue;
    }
    if (topic.status !== 'current') diagnostics.push(diagnostic('DA-09', topic.path, `orientation topic ${id} must be current`));
    if (!Array.isArray(topic.keywords) || topic.keywords.length < 2) diagnostics.push(diagnostic('DA-03', topic.path, `orientation topic ${id} requires at least two search keywords`));
    if (!topic.parentPath || !declaredPaths.has(topic.parentPath)) diagnostics.push(diagnostic('DA-02', topic.path, `orientation topic ${id} requires a declared direct-entry parent`));
    if (!Array.isArray(topic.adjacentTopics) || topic.adjacentTopics.length === 0) diagnostics.push(diagnostic('DA-02', topic.path, `orientation topic ${id} requires at least one adjacent topic`));
    for (const adjacent of topic.adjacentTopics || []) if (adjacent === id || !topicIds.has(adjacent)) diagnostics.push(diagnostic('DA-02', topic.path, `orientation topic ${id} has invalid adjacency: ${adjacent}`));
  }
  const vocabulary = catalog.searchVocabulary || [];
  if (new Set(vocabulary.map((term) => term.toLowerCase())).size !== vocabulary.length) diagnostics.push(diagnostic('DA-03', 'docs/developers/catalog.json', 'search vocabulary contains duplicate terms'));
  for (const required of ['web client', 'gateway', 'engine', 'auth', 'BrainDrive Models', 'BYOK OpenRouter', 'Ollama', 'MCP', 'Docker dev', 'Tauri desktop', 'documentation impact', 'sanitized evidence']) {
    if (!vocabulary.includes(required)) diagnostics.push(diagnostic('DA-03', 'docs/developers/catalog.json', `required search term is missing: ${required}`));
  }
  const inventory = new Set((catalog.documents || []).map(({ path }) => path));
  const markdown = candidates.filter((path) => path.endsWith('.md') && !path.startsWith('tools/docs/test/fixtures/'));
  for (const path of markdown) if (!inventory.has(path)) diagnostics.push(diagnostic('DA-01', path, 'tracked/current Markdown candidate is missing from the document inventory'));
  for (const path of ['.github/ISSUE_TEMPLATE/bug_report.yml', '.github/ISSUE_TEMPLATE/config.yml', '.github/ISSUE_TEMPLATE/documentation.yml', '.github/workflows/ci.yml', 'builds/typescript/package.json', 'tools/docs/check.mjs', 'tools/docs/sync-generated.mjs']) {
    if (!(catalog.governanceSurfaces || []).some((entry) => entry.path === path)) diagnostics.push(diagnostic('DA-01', path, 'required governance surface is missing from the catalog inventory'));
  }
  const governanceInventory = new Set((catalog.governanceSurfaces || []).map(({ path }) => path));
  for (const path of candidates.filter((path) => path.startsWith('tools/docs/') && !path.startsWith('tools/docs/test/fixtures/') && !path.endsWith('.md'))) {
    if (!governanceInventory.has(path)) diagnostics.push(diagnostic('DA-01', path, 'documentation validation surface is missing from the catalog inventory'));
  }
  return diagnostics;
}

export function validateOrientationContent(catalog, contents = new Map()) {
  const diagnostics = [];
  const requiredTerms = ['web client', 'gateway', 'engine', 'auth', 'BrainDrive Models', 'BYOK OpenRouter', 'Ollama', 'MCP', 'file-backed memory', 'secrets', 'Docker dev', 'Docker local', 'Docker prod', 'Tauri desktop', 'documentation impact', 'sanitized evidence'];
  const combined = [...contents.values()].join('\n').toLowerCase();
  for (const path of ['docs/developers/README.md', 'docs/developers/terminology.md', 'docs/developers/repository-map.md', 'docs/developers/architecture/README.md']) {
    const text = contents.get(path);
    if (!text) {
      diagnostics.push(diagnostic('DA-03', path, 'orientation page is unavailable for plain-source validation'));
      continue;
    }
    for (const field of ['> - Status:', '> - Parent:', '> - Sources:', '> - Tests:']) if (!text.includes(field)) diagnostics.push(diagnostic('DA-06', path, `plain-source metadata is missing: ${field}`));
  }
  for (const term of requiredTerms) if (!combined.includes(term.toLowerCase())) diagnostics.push(diagnostic('DA-03', 'docs/developers/README.md', `orientation corpus is missing searchable term: ${term}`));
  return diagnostics;
}

export function validateDirectEntryStatus(catalog, contents = new Map()) {
  const diagnostics = [];
  for (const alias of (catalog.aliases || []).filter(({ status }) => status === 'legacy')) {
    const text = contents.get(alias.path);
    if (!text) {
      diagnostics.push(diagnostic('DA-09', alias.path, 'legacy direct-entry page is unavailable for status validation'));
      continue;
    }
    const canonicalLink = posix.relative(posix.dirname(alias.path), alias.canonicalPath);
    if (!/status:\s*legacy/i.test(text)) diagnostics.push(diagnostic('DA-09', alias.path, 'legacy direct-entry page lacks a visible Legacy status'));
    if (!text.includes(canonicalLink)) diagnostics.push(diagnostic('DA-02', alias.path, `legacy direct-entry page lacks its canonical route: ${alias.canonicalPath}`));
  }
  for (const topic of (catalog.topics || []).filter(({ status, topicId }) => status === 'unresolved' && topicId === 'gateway-client-contract')) {
    const text = contents.get(topic.path);
    if (!text) {
      diagnostics.push(diagnostic('DA-09', topic.path, 'mixed direct-entry page is unavailable for status validation'));
      continue;
    }
    if (!/status:\s*unresolved/i.test(text) || !/mixed current\/legacy/i.test(text)) diagnostics.push(diagnostic('DA-09', topic.path, 'mixed direct-entry page lacks a visible Unresolved mixed-content status'));
    const parentLink = posix.relative(posix.dirname(topic.path), topic.parentPath);
    if (!text.includes(parentLink)) diagnostics.push(diagnostic('DA-02', topic.path, `mixed direct-entry page lacks its parent route: ${topic.parentPath}`));
  }
  return diagnostics;
}
