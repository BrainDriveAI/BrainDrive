import { diagnostic } from '../diagnostics.mjs';
import { readContainedText } from '../paths.mjs';

const EVIDENCE_FIELDS = ['schemaVersion', 'kind', 'id', 'revision', 'branchOrTag', 'environment', 'startState', 'command', 'workingDirectory', 'toolVersions', 'steps', 'expected', 'actual', 'interventions', 'confusionPoints', 'cleanup', 'remainingRisk', 'disposition', 'sanitization'];
const HARNESS_FIELDS = ['id', 'goal', 'allowedContext', 'startingPath', 'prohibitedInputs', 'prohibitedActions', 'expectedAuthorities', 'requiredOutput', 'rubric', 'evidence'];

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
  }
  return diagnostics;
}

export function validateClaimedPlatformEvidence(claim = {}, reports = []) {
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
    if (report.disposition !== 'pass') {
      diagnostics.push(diagnostic('G-07', path, `claimed ${requirement.platform} journey evidence must have a passing disposition`));
    }
  }

  return diagnostics;
}

export function validateMilestoneRecord(text, path) {
  const diagnostics = [];
  const match = path.match(/\/milestones\/(\d{2})-/);
  const milestone = match ? Number(match[1]) : null;
  const terminalResults = ['NEEDS CORRECTION', 'BLOCKED'];
  if (milestone !== null) terminalResults.unshift(`MILESTONE ${milestone} COMPLETE — NEXT LEGAL PROMPT: ${milestone + 1}`);
  if (/\baccepted_(?:by|at)\b|\bapproval status\b|\bacceptance metadata\b/i.test(text)) diagnostics.push(diagnostic('DA-18', path, 'milestone record contains prohibited acceptance or approval metadata'));
  if (containsSensitiveEvidence(text)) diagnostics.push(diagnostic('DA-18', path, 'milestone record contains a disallowed private, network, or credential-shaped value; content is redacted'));
  const terminalPattern = /^(?:MILESTONE \d+ COMPLETE — NEXT LEGAL PROMPT: \d+|NEEDS CORRECTION|BLOCKED)$/;
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
    'docs/developers/verification/templates/ai-agent-scorecard.md': ['Scenario ID:', 'Candidate revision:', 'Prohibited inputs/actions confirmed:', 'Gating dimension', '## Outcome'],
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
