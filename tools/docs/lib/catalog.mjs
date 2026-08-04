import { diagnostic } from './diagnostics.mjs';
import { inspectContainedPathSync } from './paths.mjs';
import { APPROVED_EVIDENCE_OUTPUT_PATTERNS } from './evidence-identity.mjs';

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
  for (const role of catalog.ownerRoles || []) {
    if (!Array.isArray(role.githubOwners) || role.githubOwners.length === 0) diagnostics.push(diagnostic('DA-12', 'docs/developers/catalog.json', `owner role lacks a confirmed GitHub owner: ${role.id || '<missing>'}`));
    for (const owner of role.githubOwners || []) if (!/^@[A-Za-z0-9][A-Za-z0-9-]{0,38}(?:\/[A-Za-z0-9][A-Za-z0-9_-]{0,99})?$/.test(owner)) diagnostics.push(diagnostic('DA-12', 'docs/developers/catalog.json', `owner role has an invalid GitHub owner handle: ${role.id || '<missing>'}`));
  }
  duplicateIds(catalog.audiences, 'id', 'audience route', diagnostics);
  duplicateIds(catalog.journeys, 'id', 'journey route', diagnostics);
  duplicateIds(catalog.components, 'id', 'component route', diagnostics);
  duplicateIds(catalog.topics, 'topicId', 'topic', diagnostics);
  duplicateIds(catalog.topicBindings, 'topicId', 'topic binding', diagnostics);
  duplicateIds(catalog.commands, 'id', 'command', diagnostics);
  duplicateIds(catalog.platformClaims, 'id', 'platform claim', diagnostics);
  duplicateIds(catalog.humanReviewRequirements, 'id', 'human review requirement', diagnostics);
  duplicateIds(catalog.versionDomains, 'id', 'version domain', diagnostics);
  for (const claim of catalog.platformClaims || []) {
    const configured = new Set(claim.configuredBundleTargets || []);
    const claimed = new Set(claim.claimedPlatforms || []);
    const diagnosticOnly = new Set(claim.diagnosticOnlyEnvironments || []);
    const evidencePlatforms = new Set((claim.requiredEvidence || []).map(({ platform }) => platform));
    if (!claim.id || !claim.journeyId || configured.size === 0 || claimed.size === 0 || diagnosticOnly.size === 0) {
      diagnostics.push(diagnostic('DA-06', 'docs/developers/catalog.json', 'platform claim requires id, journeyId, configured targets, claimed platforms, and diagnostic-only environments'));
    }
    for (const platform of claimed) {
      if (!configured.has(platform)) diagnostics.push(diagnostic('DA-09', 'docs/developers/catalog.json', `claimed platform is not a configured bundle target: ${platform}`));
      if (!evidencePlatforms.has(platform)) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', `claimed platform lacks a required evidence entry: ${platform}`));
    }
    for (const requirement of claim.requiredEvidence || []) {
      if (!claimed.has(requirement.platform)) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', `platform evidence is declared for a non-claimed platform: ${requirement.platform}`));
      if (requirement.environment !== 'native') diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', `claimed platform evidence must require a native environment: ${requirement.platform}`));
      if (requirement.status !== 'DEFERRED — REQUIRED BEFORE MILESTONE 7') diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', `claimed platform evidence has an invalid deferred status: ${requirement.platform}`));
      if (requirement.reportPath !== `docs/developers/verification/platform-reports/${requirement.platform}-j05.json`) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', `claimed platform evidence has an invalid report path: ${requirement.platform}`));
      if (requirement.schemaPath !== 'tools/docs/schemas/platform-report.schema.json') diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', `claimed platform evidence has an invalid schema path: ${requirement.platform}`));
    }
  }
  const expectedReviewIds = Array.from({ length: 8 }, (_, index) => `REV-${String(index + 1).padStart(2, '0')}`);
  const actualReviewIds = (catalog.humanReviewRequirements || []).map(({ id }) => id);
  if (JSON.stringify(actualReviewIds) !== JSON.stringify(expectedReviewIds)) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', 'human review requirements must declare REV-01 through REV-08 exactly once and in order'));
  for (const review of catalog.humanReviewRequirements || []) {
    if (review.path !== `docs/developers/verification/human-reviews/${String(review.id || '').toLowerCase()}.json` || review.schemaPath !== 'tools/docs/schemas/human-review.schema.json' || !review.reviewerRole) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', `human review requirement is invalid: ${review.id || '<missing>'}`));
  }
  if (JSON.stringify(catalog.evidenceOutputs?.recordIdentityFields) !== JSON.stringify(['SOURCE_TEST_REVISION', 'SOURCE_CANDIDATE_PROOF'])) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', 'evidence records must declare the immutable source identity fields'));
  if (JSON.stringify(catalog.evidenceOutputs?.revisionModelFields) !== JSON.stringify(['SOURCE_TEST_REVISION', 'EVIDENCE_REVISION'])) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', 'evidence outputs must declare the two-revision compatibility fields'));
  if (JSON.stringify(catalog.evidenceOutputs?.approvedPathPatterns) !== JSON.stringify(APPROVED_EVIDENCE_OUTPUT_PATTERNS)) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', 'approved evidence-output paths do not match the fixed validator allowlist'));
  if (JSON.stringify(catalog.evidenceOutputs?.releaseRecords) !== JSON.stringify(APPROVED_EVIDENCE_OUTPUT_PATTERNS.slice(-3))) diagnostics.push(diagnostic('DA-18', 'docs/developers/catalog.json', 'release evidence records do not match the fixed validator allowlist'));
  if (checkPaths) for (const schemaPath of ['tools/docs/schemas/platform-report.schema.json', 'tools/docs/schemas/human-review.schema.json']) inspectReference(root, schemaPath, 'evidence schema', diagnostics);
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
