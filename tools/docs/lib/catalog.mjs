import { diagnostic } from './diagnostics.mjs';
import { inspectContainedPathSync } from './paths.mjs';

export const CURRENT_STATUS = 'current';
export const ALLOWED_STATUSES = new Set(['current', 'legacy', 'historical', 'experimental', 'internal', 'deprecated', 'removed', 'unsupported', 'unresolved']);
const REQUIRED_TOPIC_FIELDS = ['topicId', 'path', 'title', 'purpose', 'audiences', 'status', 'applicability', 'ownerRole', 'expectedOutcome', 'prerequisites'];

function duplicateIds(items, field, label, diagnostics) {
  const seen = new Set();
  for (const item of items || []) {
    const id = item?.[field];
    if (!id) continue;
    if (seen.has(id)) diagnostics.push(diagnostic('DA-05', 'docs/developers/catalog.json', `${label} is declared more than once: ${id}`));
    seen.add(id);
  }
}

function inspectReference(root, path, label, diagnostics, options) {
  const inspected = inspectContainedPathSync(root, path, options);
  if (!inspected.ok) diagnostics.push(diagnostic(inspected.reason.includes('escape') || inspected.reason.includes('symlink') ? 'DA-16' : 'DA-10', 'docs/developers/catalog.json', `${label} is invalid: ${inspected.reason}`));
}

export function validateCatalog(catalog, { root = process.cwd(), checkPaths = true } = {}) {
  const diagnostics = [];
  if (!catalog || catalog.schemaVersion !== 1 || catalog.authority !== 'catalog') {
    diagnostics.push(diagnostic('DA-06', 'docs/developers/catalog.json', 'catalog schemaVersion must be 1 and authority must be catalog', 'Use the catalog schema contract'));
    return diagnostics;
  }
  if (!Array.isArray(catalog.topics)) return [diagnostic('DA-06', 'docs/developers/catalog.json', 'topics must be an array')];
  duplicateIds(catalog.ownerRoles, 'id', 'owner role', diagnostics);
  duplicateIds(catalog.audiences, 'id', 'audience route', diagnostics);
  duplicateIds(catalog.journeys, 'id', 'journey route', diagnostics);
  duplicateIds(catalog.components, 'id', 'component route', diagnostics);
  duplicateIds(catalog.topics, 'topicId', 'topic', diagnostics);
  duplicateIds(catalog.topicBindings, 'topicId', 'topic binding', diagnostics);
  duplicateIds(catalog.commands, 'id', 'command', diagnostics);
  duplicateIds(catalog.versionDomains, 'id', 'version domain', diagnostics);
  for (const topic of catalog.topics) {
    const missing = REQUIRED_TOPIC_FIELDS.filter((field) => {
      const value = topic[field];
      return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    });
    if (missing.length) diagnostics.push(diagnostic('DA-06', topic.path || 'docs/developers/catalog.json', `canonical topic ${topic.topicId || '<missing>'} is missing metadata: ${missing.join(', ')}`));
    if (topic.status && !ALLOWED_STATUSES.has(topic.status)) diagnostics.push(diagnostic('DA-09', topic.path || 'docs/developers/catalog.json', `topic ${topic.topicId || '<missing>'} uses unsupported status ${topic.status}`));
    if (checkPaths && topic.path) {
      const inspected = inspectContainedPathSync(root, topic.path);
      if (!inspected.ok) diagnostics.push(diagnostic(inspected.reason.includes('escape') || inspected.reason.includes('symlink') ? 'DA-16' : 'DA-10', inspected.reason.includes('escape') ? 'docs/developers/catalog.json' : topic.path, `declared canonical path is invalid: ${inspected.reason}`));
    }
  }
  const currentByTopic = new Map();
  for (const topic of catalog.topics.filter(({ status }) => status === CURRENT_STATUS)) {
    const prior = currentByTopic.get(topic.topicId);
    if (prior) diagnostics.push(diagnostic('DA-05', 'docs/developers/catalog.json', `topic ${topic.topicId} has multiple current authorities: ${prior.path} and ${topic.path}`, 'Choose one current path; classify the other as an alias or history'));
    else currentByTopic.set(topic.topicId, topic);
  }
  const currentByPath = new Map();
  for (const topic of catalog.topics.filter(({ status }) => status === CURRENT_STATUS)) {
    const prior = currentByPath.get(topic.path);
    if (prior && prior.topicId !== topic.topicId) diagnostics.push(diagnostic('DA-05', topic.path, `one current path declares multiple topic authorities: ${prior.topicId} and ${topic.topicId}`));
    currentByPath.set(topic.path, topic);
  }
  if (catalog.documents) {
    const seen = new Set();
    for (const document of catalog.documents) {
      if (!document.path || !document.classification || !document.status || !document.ownerRole) diagnostics.push(diagnostic('DA-06', document.path || 'docs/developers/catalog.json', 'inventory entry requires path, classification, status, and ownerRole'));
      if (seen.has(document.path)) diagnostics.push(diagnostic('DA-05', document.path, 'document inventory path is declared more than once'));
      seen.add(document.path);
      if (document.status && !ALLOWED_STATUSES.has(document.status)) diagnostics.push(diagnostic('DA-09', document.path || 'docs/developers/catalog.json', `document status is outside the allowed vocabulary: ${document.status}`));
      if (checkPaths && document.path) {
        const inspected = inspectContainedPathSync(root, document.path, { allowSymlink: document.classification === 'agent-compatibility-mirror' });
        if (!inspected.ok) diagnostics.push(diagnostic(inspected.reason.includes('escape') || inspected.reason.includes('symlink') ? 'DA-16' : 'DA-10', inspected.reason.includes('escape') ? 'docs/developers/catalog.json' : document.path, `inventoried document is invalid: ${inspected.reason}`));
      }
    }
  }
  const commandIds = new Set((catalog.commands || []).map(({ id }) => id));
  const bindings = new Map((catalog.topicBindings || []).map((binding) => [binding.topicId, binding]));
  for (const topic of catalog.topics) {
    const binding = bindings.get(topic.topicId);
    if (!binding) {
      diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `topic ${topic.topicId} is missing source/test/command bindings`));
      continue;
    }
    for (const [kind, references] of [['source', binding.sources], ['test', binding.tests]]) {
      if (!Array.isArray(references) || references.length === 0) diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `topic ${topic.topicId} has no ${kind} decision`));
      for (const reference of references || []) {
        const inspected = checkPaths ? inspectContainedPathSync(root, reference) : { ok: true };
        if (!inspected.ok) diagnostics.push(diagnostic(inspected.reason.includes('escape') || inspected.reason.includes('symlink') ? 'DA-16' : 'DA-10', 'docs/developers/catalog.json', `${kind} reference for ${topic.topicId} is invalid: ${inspected.reason}`));
      }
    }
    if (!Array.isArray(binding.commands) || binding.commands.length === 0) diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `topic ${topic.topicId} has no command decision`));
    for (const reference of binding.commands || []) if (!commandIds.has(reference)) diagnostics.push(diagnostic('DA-10', 'docs/developers/catalog.json', `topic ${topic.topicId} references unknown command ${reference}`));
  }
  for (const surface of catalog.governanceSurfaces || []) {
    const inspected = checkPaths ? inspectContainedPathSync(root, surface.path, { allowSymlink: false }) : { ok: true };
    if (!surface.classification || !surface.status || !surface.ownerRole) diagnostics.push(diagnostic('DA-06', surface.path || 'docs/developers/catalog.json', 'governance surface requires classification, status, and ownerRole'));
    if (surface.status && !ALLOWED_STATUSES.has(surface.status)) diagnostics.push(diagnostic('DA-09', surface.path || 'docs/developers/catalog.json', `governance status is outside the allowed vocabulary: ${surface.status}`));
    if (!inspected.ok) diagnostics.push(diagnostic(inspected.reason.includes('escape') || inspected.reason.includes('symlink') ? 'DA-16' : 'DA-10', 'docs/developers/catalog.json', `governance surface is invalid: ${inspected.reason}`));
  }
  const aliasPaths = new Set();
  for (const alias of catalog.aliases || []) {
    if (!alias.path || !alias.canonicalPath || !alias.kind || !alias.status) diagnostics.push(diagnostic('DA-06', 'docs/developers/catalog.json', 'alias requires path, canonicalPath, kind, and status'));
    if (alias.status && !ALLOWED_STATUSES.has(alias.status)) diagnostics.push(diagnostic('DA-09', alias.path || 'docs/developers/catalog.json', `alias status is outside the allowed vocabulary: ${alias.status}`));
    if (aliasPaths.has(alias.path)) diagnostics.push(diagnostic('DA-05', 'docs/developers/catalog.json', `alias path is declared more than once: ${alias.path}`));
    aliasPaths.add(alias.path);
    if (checkPaths && alias.path) inspectReference(root, alias.path, 'alias path', diagnostics, { allowSymlink: alias.kind === 'symlink-mirror' });
    if (checkPaths && alias.canonicalPath) inspectReference(root, alias.canonicalPath, 'alias canonical path', diagnostics);
  }
  const mappingSources = new Set();
  for (const mapping of catalog.sourceMappings || []) {
    if (!mapping.source || !mapping.documentation || !mapping.impact) diagnostics.push(diagnostic('DA-06', 'docs/developers/catalog.json', 'source mapping requires source, documentation, and impact'));
    if (mappingSources.has(mapping.source)) diagnostics.push(diagnostic('DA-05', 'docs/developers/catalog.json', `source mapping is declared more than once: ${mapping.source}`));
    mappingSources.add(mapping.source);
    if (checkPaths && mapping.source) {
      const wildcard = mapping.source.search(/[?*\[]/);
      const sourcePath = wildcard === -1 ? mapping.source : mapping.source.slice(0, wildcard).replace(/\/$/, '');
      if (sourcePath) inspectReference(root, sourcePath, 'source mapping source', diagnostics, { regularFile: wildcard === -1 });
    }
    if (checkPaths && mapping.documentation) inspectReference(root, mapping.documentation, 'source mapping documentation', diagnostics);
  }
  for (const domain of catalog.versionDomains || []) {
    if (!domain.id || !Array.isArray(domain.sources) || domain.sources.length === 0 || !domain.status) diagnostics.push(diagnostic('DA-06', 'docs/developers/catalog.json', 'version domain requires id, non-empty sources, and status'));
    if (domain.status && domain.status !== 'current-distinct-domain') diagnostics.push(diagnostic('DA-09', 'docs/developers/catalog.json', `version domain status is outside the allowed vocabulary: ${domain.status}`));
    for (const source of domain.sources || []) if (checkPaths) inspectReference(root, source, 'version domain source', diagnostics, { regularFile: false });
  }
  return diagnostics;
}
