import { diagnostic } from '../diagnostics.mjs';
import { readContainedText } from '../paths.mjs';

const EVIDENCE_FIELDS = ['schemaVersion', 'kind', 'id', 'revision', 'branchOrTag', 'environment', 'startState', 'command', 'workingDirectory', 'toolVersions', 'steps', 'expected', 'actual', 'interventions', 'confusionPoints', 'cleanup', 'remainingRisk', 'disposition', 'sanitization'];
const HARNESS_FIELDS = ['id', 'goal', 'taskPrompt', 'allowedContext', 'startingPath', 'prohibitedInputs', 'prohibitedActions', 'expectedAuthorities', 'requiredOutput', 'rubric', 'evidence'];
const HARNESS_ARRAY_FIELDS = ['allowedContext', 'prohibitedInputs', 'prohibitedActions', 'expectedAuthorities', 'requiredOutput', 'rubric'];
const HARNESS_DIMENSIONS = new Set(['authority', 'repository accuracy', 'scope', 'trust', 'verification', 'conflict behavior', 'documentation impact', 'handoff']);
const DIMENSION_LABELS = new Map([...HARNESS_DIMENSIONS].map((dimension) => [dimension, dimension.replace(/\b\w/g, (letter) => letter.toUpperCase())]));
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsSensitiveEvidence = (text) => /synthetic-sensitive-sample|\b(?:token|password|authorization)\s*[:=]|\b(?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET(?:[_-]?KEY)?|PASSWORD|AUTHORIZATION)\s*[:=]|\bbearer\s+[A-Za-z0-9._-]+|\/(?:home|Users)\/[^/\s"]+|[A-Za-z]:\\{1,2}(?:Users|Documents and Settings)\\{1,2}[^"\\\s]+|\b(?:host|hostname)(?:\s+|\\?"?\s*[:=]\s*\\?"?)[A-Za-z0-9][A-Za-z0-9.-]*\.(?:local|internal|lan|home|corp)\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|https?:\/\/(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)|https?:\/\/(?:[^/"\s.]+\.)*(?:local|internal|lan|home|corp)(?::\d+)?(?:[/"\s]|$)/i.test(text);

export function validateEvidence(data = {}) {
  const diagnostics = [];
  const missing = EVIDENCE_FIELDS.filter((field) => data[field] === undefined || data[field] === '' || (field === 'steps' && Array.isArray(data[field]) && data[field].length === 0));
  if (missing.length) diagnostics.push(diagnostic('DA-18', `evidence:${data.id || '<missing>'}`, `evidence record is missing fields: ${missing.join(', ')}`));
  for (const field of ['steps', 'interventions', 'confusionPoints']) if (data[field] !== undefined && !Array.isArray(data[field])) diagnostics.push(diagnostic('DA-18', `evidence:${data.id || '<missing>'}`, `${field} must be an array`));
  if (data.disposition && !['pass', 'fail', 'blocked'].includes(data.disposition)) diagnostics.push(diagnostic('DA-18', `evidence:${data.id || '<missing>'}`, 'disposition must be pass, fail, or blocked'));
  const serialized = JSON.stringify(data);
  if (containsSensitiveEvidence(serialized)) diagnostics.push(diagnostic('DA-18', `evidence:${data.id || '<missing>'}`, 'evidence contains a disallowed private, network, or credential-shaped value; content is redacted'));
  return diagnostics;
}

export function validateHarness(data = {}) {
  const diagnostics = [];
  if (data.schemaVersion !== 1 || !Array.isArray(data.scenarios)) return [diagnostic('DA-18', 'tools/docs/harness/scenarios.json', 'harness schemaVersion/scenarios contract is invalid')];
  const expectedIds = Array.from({ length: 10 }, (_, index) => `AIH-${String(index + 1).padStart(2, '0')}`);
  if (data.scenarios.length !== 10 || data.scenarios.some(({ id }, index) => id !== expectedIds[index])) diagnostics.push(diagnostic('DA-18', 'tools/docs/harness/scenarios.json', 'harness must define AIH-01 through AIH-10 exactly once and in order'));
  for (const scenario of data.scenarios) {
    const missing = HARNESS_FIELDS.filter((field) => scenario[field] === undefined || (Array.isArray(scenario[field]) && scenario[field].length === 0));
    if (missing.length) diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, `AI harness scenario is missing: ${missing.join(', ')}`));
    if (scenario.goal !== undefined && typeof scenario.goal !== 'string') diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, 'AI harness goal must be a string'));
    if (scenario.taskPrompt !== undefined && typeof scenario.taskPrompt !== 'string') diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, 'AI harness taskPrompt must be a string'));
    if (scenario.startingPath !== undefined && typeof scenario.startingPath !== 'string') diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, 'AI harness startingPath must be a string'));
    for (const field of HARNESS_ARRAY_FIELDS) if (scenario[field] !== undefined && !Array.isArray(scenario[field])) diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, `${field} must be an array`));
    const dimensions = new Set();
    for (const entry of Array.isArray(scenario.rubric) ? scenario.rubric : []) {
      if (!entry || typeof entry !== 'object' || !HARNESS_DIMENSIONS.has(entry.dimension) || typeof entry.passingStandard !== 'string' || entry.gate !== 'must-pass') diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, 'rubric entries require a known dimension, passingStandard, and must-pass gate'));
      if (entry?.dimension && dimensions.has(entry.dimension)) diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, `rubric dimension is declared more than once: ${entry.dimension}`));
      if (entry?.dimension) dimensions.add(entry.dimension);
    }
    const evidence = scenario.evidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, 'evidence must be an object'));
    else {
      const expectedPath = `docs/developers/verification/ai-agent-scorecards/${String(scenario.id || '').toLowerCase()}.md`;
      if (evidence.traceSummaryPath !== expectedPath || evidence.scorecardPath !== expectedPath) diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, 'trace and scorecard paths must match the scenario ID'));
      if (!Array.isArray(evidence.requiredFields) || evidence.requiredFields.length === 0) diagnostics.push(diagnostic('DA-18', `scenario:${scenario.id || '<missing>'}`, 'evidence requiredFields must be a non-empty array'));
    }
  }
  return diagnostics;
}

export function validateAiScorecard(scenario = {}, text = '', path = '<scorecard>', { candidateProof } = {}) {
  const diagnostics = [];
  if (!text.includes(`- Scenario ID: ${scenario.id}`)) diagnostics.push(diagnostic('DA-18', path, `scorecard must identify ${scenario.id}`));
  if (!text.includes(`- Task prompt: ${scenario.taskPrompt}`)) diagnostics.push(diagnostic('DA-18', path, 'scorecard must retain the exact task prompt'));
  if (!/- Candidate state proof:\s*`?candidate-content sha256 [a-f0-9]{64}; entries \d+; head [a-f0-9]{40}`?\s*$/im.test(text)) diagnostics.push(diagnostic('DA-18', path, 'scorecard must bind the candidate-under-test with the canonical content digest'));
  if (candidateProof && !text.includes(`- Candidate state proof: ${candidateProof}`)) diagnostics.push(diagnostic('G-10', path, 'scorecard does not bind the current candidate content proof'));
  if (!text.includes('## Required output evidence')) diagnostics.push(diagnostic('DA-18', path, 'scorecard must retain a required-output evidence section'));
  for (const field of scenario.evidence?.requiredFields || []) {
    if (!new RegExp(`^[-*] ${escapeRegExp(field)}:\\s*\\S`, 'm').test(text)) diagnostics.push(diagnostic('DA-18', path, `scorecard is missing required evidence field: ${field}`));
  }
  for (const { dimension } of scenario.rubric || []) {
    const label = DIMENSION_LABELS.get(dimension) || dimension;
    const rows = [...text.matchAll(new RegExp(`^\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*(pass|fail|blocked)\\s*\\|`, 'gim'))];
    if (rows.length !== 1 || rows[0]?.[1].toLowerCase() !== 'pass') diagnostics.push(diagnostic('DA-18', path, `scorecard rubric gate ${dimension} must have exactly one pass result and no contradictory rubric outcome`));
  }
  const dispositions = [...text.matchAll(/^- Disposition:\s*`(pass|fail|blocked)`\s*$/gim)];
  if (dispositions.length !== 1 || dispositions[0]?.[1].toLowerCase() !== 'pass') diagnostics.push(diagnostic('DA-18', path, 'scorecard must contain exactly one disposition and it must be pass'));
  if (!/- Sanitization performed:\s*\S/im.test(text)) diagnostics.push(diagnostic('DA-18', path, 'scorecard must record sanitization'));
  if (containsSensitiveEvidence(text)) diagnostics.push(diagnostic('DA-18', path, 'scorecard contains a disallowed private, network, or credential-shaped value; content is redacted'));
  return diagnostics;
}

export function validateClaimedPlatformEvidence(claim = {}, reports = [], { candidateProof } = {}) {
  const diagnostics = [];
  const requiredEvidence = Array.isArray(claim.requiredEvidence) ? claim.requiredEvidence : [];
  const diagnosticOnly = new Set(claim.diagnosticOnlyEnvironments || []);

  for (const requirement of requiredEvidence) {
    const path = `platform-evidence:${claim.journeyId || '<missing>'}:${requirement.platform || '<missing>'}`;
    const report = reports.find((candidate) =>
      candidate?.journeyId === claim.journeyId && candidate?.platform === requirement.platform
    );
    if (!report) {
      diagnostics.push(diagnostic('G-07', path, `required native ${requirement.platform} journey evidence report is absent`));
      continue;
    }
    if (report.environment !== requirement.environment || diagnosticOnly.has(report.environment)) {
      diagnostics.push(diagnostic('G-07', path, `claimed ${requirement.platform} journey evidence must come from its native environment`));
      continue;
    }
    const omissions = [];
    if (!/^[0-9a-f]{40}$/i.test(report.testRevision || '')) omissions.push('a full tested revision SHA');
    if (candidateProof && report.candidateProof !== candidateProof) omissions.push('proof binding the report to the current candidate');
    if (report.cleanWorktree !== true) omissions.push('a clean-worktree result');
    if (!report.toolVersions || typeof report.toolVersions !== 'object' || Array.isArray(report.toolVersions) || Object.keys(report.toolVersions).length === 0) omissions.push('platform and tool versions');
    if (report.dynamicGatewayObservation !== 'pass') omissions.push('a passing dynamic-gateway observation');
    if (report.providerIndependentBaseline !== 'pass') omissions.push('a passing provider-independent baseline');
    if (typeof report.cleanup !== 'string' || !report.cleanup.trim()) omissions.push('cleanup evidence');
    if (report.sanitization !== 'pass') omissions.push('a passing sanitized disposition');
    if (report.disposition !== 'pass') omissions.push('a passing journey disposition');
    if (omissions.length) diagnostics.push(diagnostic('G-07', path, `claimed ${requirement.platform} journey evidence is incomplete: missing ${omissions.join(', ')}`));
  }

  return diagnostics;
}

export function validateMilestoneRecord(text, path) {
  const diagnostics = [];
  const match = path.match(/\/milestones\/(\d{2})-/);
  const milestone = match ? Number(match[1]) : null;
  const terminalResults = ['NEEDS CORRECTION', 'BLOCKED'];
  if (milestone !== null) terminalResults.unshift(milestone === 7 ? 'MILESTONE 7 COMPLETE — NEXT LEGAL PROMPT: NONE' : `MILESTONE ${milestone} COMPLETE — NEXT LEGAL PROMPT: ${milestone + 1}`);
  if (/\baccepted_(?:by|at)\b|\bapproval status\b|\bacceptance metadata\b/i.test(text)) diagnostics.push(diagnostic('DA-18', path, 'milestone record contains prohibited acceptance or approval metadata'));
  if (containsSensitiveEvidence(text)) diagnostics.push(diagnostic('DA-18', path, 'milestone record contains a disallowed private, network, or credential-shaped value; content is redacted'));
  const terminalPattern = /^(?:MILESTONE (?:[0-6] COMPLETE — NEXT LEGAL PROMPT: [1-7]|7 COMPLETE — NEXT LEGAL PROMPT: NONE)|NEEDS CORRECTION|BLOCKED)$/;
  const resultLines = text.split(/\r?\n/).filter((line) => terminalPattern.test(line.trim()));
  if (resultLines.length !== 1) diagnostics.push(diagnostic('DA-18', path, 'milestone record must contain exactly one allowed terminal result line'));
  const finalNonblank = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  if (!terminalResults.includes(finalNonblank)) diagnostics.push(diagnostic('DA-18', path, 'milestone terminal result must be the final nonblank line and match its milestone number'));
  for (const heading of ['## Candidate revision', '## Dependencies', '## Files changed', '## Commands and results', '## Reviews and adjudication', '## Global gates', '## Open items', '## Remaining risks']) {
    if (!text.includes(heading)) diagnostics.push(diagnostic('DA-18', path, `milestone record is missing required section ${heading}`));
  }
  return diagnostics;
}

export async function validateEvidenceTemplates(root) {
  const requirements = {
    'docs/developers/verification/templates/journey-report.md': ['Scenario ID:', 'Candidate revision:', 'Starting state:', 'Command:', 'Working directory:', 'Tool versions:', 'Cleanup:', 'Remaining risk:', '## Steps and results', '## Interventions and confusion points', '## Sanitization and disposition'],
    'docs/developers/verification/templates/human-review.md': ['Review ID:', 'Reviewer role', 'Candidate revision:', '## Findings', '## Decision'],
    'docs/developers/verification/templates/ai-agent-scorecard.md': ['Scenario ID:', 'Candidate revision:', 'Candidate state proof:', 'Task prompt:', 'Prohibited inputs/actions confirmed:', 'Gating dimension', '## Trace summary', '## Required output evidence', '## Outcome'],
  };
  const diagnostics = [];
  for (const [path, fields] of Object.entries(requirements)) {
    const inspected = await readContainedText(root, path);
    if (!inspected.ok) {
      diagnostics.push(diagnostic('DA-16', path, `evidence template was not read: ${inspected.reason}`));
      continue;
    }
    const content = inspected.text;
    for (const field of fields) if (!content.includes(field)) diagnostics.push(diagnostic('DA-18', path, `evidence template is missing required field: ${field}`));
  }
  return diagnostics;
}
