import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { diagnostic } from './diagnostics.mjs';
import { readContainedText } from './paths.mjs';

const AIH_IDS = Array.from({ length: 10 }, (_, index) => `AIH-${String(index + 1).padStart(2, '0')}`);
const HUMAN_IDS = Array.from({ length: 8 }, (_, index) => `REV-${String(index + 1).padStart(2, '0')}`);
const PLATFORM_IDS = ['macos-j05', 'windows-j05'];

export const APPROVED_EVIDENCE_OUTPUT_PATTERNS = Object.freeze([
  'docs/developers/verification/ai-agent-scorecards/aih-??.md',
  'docs/developers/verification/platform-reports/windows-j05.json',
  'docs/developers/verification/platform-reports/macos-j05.json',
  'docs/developers/verification/human-reviews/rev-??.json',
  'docs/developers/verification/milestones/07-release-gauntlet.md',
  'docs/developers/verification/m7-trace-matrix.md',
  'docs/developers/verification/v1-readiness.md',
]);

const PLATFORM_RERUN_PATTERNS = [
  'builds/typescript/src-tauri/**',
  'builds/typescript/client_web/src/api/runtime-api-base.ts',
  'builds/typescript/client_web/src/api/desktop-*.ts',
  'builds/typescript/client_web/vite.config.ts',
  'builds/typescript/client_web/package.json',
  'builds/typescript/config.ts',
  'builds/typescript/gateway/**',
  'builds/typescript/scripts/dev-runtime.mjs',
  'builds/typescript/scripts/desktop-*',
  'builds/typescript/package.json',
  'builds/typescript/package-lock.json',
  'tools/docs/lib/paths.mjs',
];

const AIH_GLOBAL_PATTERNS = [
  'AGENTS.md',
  '**/AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'docs/developers/verification/ai-agent-harness.md',
  'docs/developers/verification/templates/ai-agent-scorecard.md',
  'tools/docs/candidate-digest.mjs',
  'tools/docs/release-check.mjs',
  'tools/docs/lib/evidence-identity.mjs',
  'tools/docs/lib/rules/evidence.mjs',
  'tools/docs/schemas/ai-harness.schema.json',
  'tools/docs/schemas/evidence-policy.schema.json',
];

const AIH_SCENARIO_PATTERNS = {
  'AIH-01': ['docs/developers/catalog.json', 'builds/typescript/memory/starter-pack/**'],
  'AIH-02': ['docs/developers/catalog.json', 'docs/developers/repository-map.md', 'docs/developers/architecture/**', 'builds/typescript/**', 'builds/mcp_release/**', 'installer/**', '.github/workflows/**'],
  'AIH-03': ['docs/developers/catalog.json', 'docs/developers/setup/native.md', 'docs/developers/integrations/gateway.md', 'docs/developers/history/**', 'builds/typescript/New-User-Setup.md', 'builds/typescript/client_web/src/api/**', 'ROADMAP.md'],
  'AIH-04': ['docs/developers/catalog.json', 'docs/developers/repository-map.md', 'docs/developers/architecture/request-flows.md', 'docs/developers/integrations/mcp-and-tools.md', 'builds/typescript/client_web/src/**', 'builds/typescript/gateway/**', 'builds/typescript/engine/**', 'builds/typescript/mcp/**', 'builds/typescript/tools.ts', 'builds/mcp_release/**', '.github/workflows/**'],
  'AIH-05': ['docs/developers/catalog.json', 'builds/typescript/adapters/**', 'builds/typescript/gateway/provider-activation.*', 'builds/typescript/secrets/**', 'builds/typescript/client_web/src/components/settings/**', 'docs/developers/integrations/providers.md', 'docs/developers/integrations/mcp-and-tools.md'],
  'AIH-06': ['docs/developers/catalog.json', 'docs/AGENTS.md', 'tools/docs/harness/**', 'tools/docs/lib/**', 'tools/docs/schemas/**', 'tools/docs/test/**'],
  'AIH-07': ['docs/developers/catalog.json', 'builds/typescript/memory/**', 'builds/typescript/your-memory/**', 'docs/developers/architecture/memory-and-secrets.md'],
  'AIH-08': ['docs/developers/catalog.json', 'builds/typescript/package.json', 'builds/typescript/client_web/package.json', 'builds/mcp_release/package.json', '.github/workflows/ci.yml', 'docs/developers/verification.md', 'tools/docs/test/**'],
  'AIH-09': ['tools/docs/test/fixtures/harness/high-risk-conflict/**', 'docs/developers/governance.md', 'docs/developers/security.md'],
  'AIH-10': ['tools/docs/test/fixtures/harness/handoff/**', 'docs/developers/verification/ai-agent-harness.md', 'docs/developers/verification/templates/**'],
};

const HUMAN_REVIEW_PATTERNS = {
  'REV-01': ['README.md', 'CONTRIBUTING.md', 'docs/developers/README.md', 'docs/developers/setup/**'],
  'REV-02': ['builds/typescript/gateway/**', 'builds/typescript/engine/**', 'builds/typescript/auth/**', 'builds/typescript/config.*', 'docs/developers/architecture/**'],
  'REV-03': ['builds/typescript/adapters/**', 'builds/typescript/mcp/**', 'builds/mcp_release/**', 'docs/developers/integrations/**'],
  'REV-04': ['SECURITY.md', 'docs/repository-security.md', 'docs/developers/security.md', 'tools/security/**', 'builds/typescript/secrets/**', 'tools/docs/lib/rules/evidence.mjs', 'tools/docs/lib/evidence-identity.mjs', 'tools/docs/schemas/*evidence*', 'tools/docs/schemas/platform-report.schema.json', 'tools/docs/schemas/human-review.schema.json'],
  'REV-05': ['.github/**', 'CONTRIBUTING.md', 'docs/developers/README.md', 'docs/developers/governance.md'],
  'REV-06': ['CHANGELOG.md', '.github/workflows/**', 'docs/developers/releases.md', 'installer/docker/scripts/preflight-production-build.sh', 'installer/docker/scripts/release-production.sh', 'builds/typescript/package.json', 'builds/mcp_release/package.json'],
  'REV-07': ['docs/developers/*.md', 'docs/developers/**/*.md', 'README.md', 'CONTRIBUTING.md'],
  'REV-08': ['AGENTS.md', 'docs/AGENTS.md', 'docs/developers/catalog.json', 'docs/developers/governance.md', 'docs/developers/verification/**', 'tools/docs/**'],
};

function globPattern(pattern) {
  let output = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      output += '.*';
      index += 1;
    } else if (character === '*') output += '[^/]*';
    else if (character === '?') output += '[^/]';
    else output += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }
  return new RegExp(`${output}$`);
}

const matches = (path, patterns) => patterns.some((pattern) => globPattern(pattern).test(path));

export function isApprovedEvidenceOutput(path) {
  if (!matches(path, APPROVED_EVIDENCE_OUTPUT_PATTERNS)) return false;
  if (path.startsWith('docs/developers/verification/ai-agent-scorecards/')) return /^docs\/developers\/verification\/ai-agent-scorecards\/aih-(0[1-9]|10)\.md$/.test(path);
  if (path.startsWith('docs/developers/verification/human-reviews/')) return /^docs\/developers\/verification\/human-reviews\/rev-0[1-8]\.json$/.test(path);
  return APPROVED_EVIDENCE_OUTPUT_PATTERNS.filter((pattern) => !pattern.includes('?')).includes(path);
}

function git(root, args, { encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed while resolving release evidence identity`);
  return result.stdout;
}

export function resolveCommit(root, revision) {
  const requested = String(revision || '').trim();
  if (!requested || requested.startsWith('-') || /[\0\r\n]/.test(requested)) throw new Error('release evidence revision is invalid');
  return git(root, ['rev-parse', '--verify', `${requested}^{commit}`]).trim();
}

export async function sourceCandidateIdentity(repositoryRoot, revision = 'HEAD') {
  const root = resolve(repositoryRoot);
  const sourceTestRevision = resolveCommit(root, revision);
  const tree = git(root, ['ls-tree', '-r', '-z', '--full-tree', sourceTestRevision], { encoding: 'buffer' });
  const entries = tree.toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const separator = entry.indexOf('\t');
    if (separator === -1) throw new Error('git ls-tree returned an invalid candidate entry');
    const metadata = entry.slice(0, separator);
    const path = entry.slice(separator + 1);
    const [mode, type, object] = metadata.split(' ');
    return { mode, type, object, path };
  }).filter(({ path }) => !isApprovedEvidenceOutput(path));
  const digest = createHash('sha256');
  digest.update(`SOURCE_TEST_REVISION\0${sourceTestRevision}\0`);
  for (const entry of entries) digest.update(`${entry.mode}\0${entry.type}\0${entry.object}\0${entry.path}\0`);
  const value = digest.digest('hex');
  return {
    sourceTestRevision,
    algorithm: 'sha256',
    digest: value,
    entries: entries.length,
    sourceCandidateProof: `source-candidate sha256 ${value}; entries ${entries.length}; revision ${sourceTestRevision}`,
  };
}

export function classifyEvidenceImpact(changedPaths = []) {
  const paths = [...new Set(changedPaths)].filter((path) => !isApprovedEvidenceOutput(path)).sort();
  const platform = paths.some((path) => matches(path, PLATFORM_RERUN_PATTERNS)) ? [...PLATFORM_IDS] : [];
  const aih = AIH_IDS.filter((id) => paths.some((path) => matches(path, AIH_GLOBAL_PATTERNS) || path === 'tools/docs/harness/scenarios.json' || matches(path, AIH_SCENARIO_PATTERNS[id])));
  const human = HUMAN_IDS.filter((id) => paths.some((path) => matches(path, HUMAN_REVIEW_PATTERNS[id])));
  return { platform, aih, human };
}

export async function adjudicatePlatformEvidenceCarryForward(repositoryRoot, { testedRevision, targetRevision, platform } = {}) {
  const root = resolve(repositoryRoot);
  const tested = resolveCommit(root, testedRevision);
  const target = resolveCommit(root, targetRevision);
  const evidenceId = `${platform}-j05`;
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', tested, target], { cwd: root });
  if (ancestor.status !== 0) {
    return {
      compatible: false,
      testedRevision: tested,
      targetRevision: target,
      changedPaths: [],
      rerun: { platform: [], aih: [], human: [] },
      diagnostics: [diagnostic('G-07', `platform-evidence:J-05:${platform || '<missing>'}`, 'tested platform revision is not an ancestor of the current source candidate')],
    };
  }
  const changedPaths = git(root, ['diff', '--name-only', '--no-renames', '-z', `${tested}..${target}`]).split('\0').filter(Boolean).sort();
  const rerun = classifyEvidenceImpact(changedPaths);
  const diagnostics = [];
  if (!PLATFORM_IDS.includes(evidenceId)) diagnostics.push(diagnostic('G-07', `platform-evidence:J-05:${platform || '<missing>'}`, 'platform evidence carry-forward requested an unknown platform'));
  else if (rerun.platform.includes(evidenceId)) diagnostics.push(diagnostic('G-07', `platform-evidence:J-05:${platform}`, 'runtime-relevant changes require this native platform journey to be rerun'));
  return { compatible: diagnostics.length === 0, testedRevision: tested, targetRevision: target, changedPaths, rerun, diagnostics };
}

export async function adjudicateRevisionCompatibility(repositoryRoot, { sourceTestRevision, evidenceRevision } = {}) {
  const root = resolve(repositoryRoot);
  const source = resolveCommit(root, sourceTestRevision);
  const evidence = resolveCommit(root, evidenceRevision);
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', source, evidence], { cwd: root });
  if (ancestor.status !== 0) {
    return { compatible: false, sourceTestRevision: source, evidenceRevision: evidence, changedPaths: [], disallowedPaths: [], rerun: { platform: [], aih: [], human: [] }, diagnostics: [diagnostic('G-13', 'release-evidence-identity', 'SOURCE_TEST_REVISION is not an ancestor of EVIDENCE_REVISION')] };
  }
  const changedPaths = git(root, ['diff', '--name-only', '--no-renames', '-z', `${source}..${evidence}`]).split('\0').filter(Boolean).sort();
  const disallowedPaths = changedPaths.filter((path) => !isApprovedEvidenceOutput(path));
  const rerun = classifyEvidenceImpact(changedPaths);
  const diagnostics = [];
  if (disallowedPaths.length) diagnostics.push(diagnostic('G-13', 'release-evidence-identity', `EVIDENCE_REVISION contains ${disallowedPaths.length} path(s) outside the approved evidence-output allowlist`));
  if (rerun.platform.length || rerun.aih.length || rerun.human.length) diagnostics.push(diagnostic('G-13', 'release-evidence-identity', 'mapped behavior, guidance, schema, instruction, source, or validator changes require affected evidence to be rerun'));
  return {
    compatible: diagnostics.length === 0,
    sourceTestRevision: source,
    evidenceRevision: evidence,
    changedPaths,
    disallowedPaths,
    rerun,
    diagnostics,
  };
}

const sensitiveEvidence = (text) => /synthetic-private-value|\b(?:token|password|authorization)\s*[:=]|\b(?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET(?:[_-]?KEY)?|PASSWORD|AUTHORIZATION)\s*[:=]|\bbearer\s+[A-Za-z0-9._-]+|\/(?:home|Users)\/[^/\s"]+|[A-Za-z]:\\{1,2}(?:Users|Documents and Settings)\\{1,2}[^"\\\s]+|\b(?:\d{1,3}\.){3}\d{1,3}\b/i.test(text);
const fullSha = (value) => /^[0-9a-f]{40}$/i.test(value || '');
const canonicalProof = (value) => /^source-candidate sha256 [0-9a-f]{64}; entries \d+; revision [0-9a-f]{40}$/i.test(value || '');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

function identityDiagnostics(record, path, rule, expected = {}) {
  const diagnostics = [];
  if (!fullSha(record.sourceTestRevision)) diagnostics.push(diagnostic(rule, path, 'record requires a full SOURCE_TEST_REVISION SHA'));
  if (!canonicalProof(record.sourceCandidateProof)) diagnostics.push(diagnostic(rule, path, 'record requires the canonical SOURCE_CANDIDATE_PROOF'));
  if (expected.sourceTestRevision && record.sourceTestRevision !== expected.sourceTestRevision) diagnostics.push(diagnostic(rule, path, 'record SOURCE_TEST_REVISION is stale'));
  if (expected.sourceCandidateProof && record.sourceCandidateProof !== expected.sourceCandidateProof) diagnostics.push(diagnostic(rule, path, 'record SOURCE_CANDIDATE_PROOF is stale'));
  const proofRevision = record.sourceCandidateProof?.match(/; revision ([0-9a-f]{40})$/i)?.[1];
  if (proofRevision && record.sourceTestRevision && proofRevision !== record.sourceTestRevision) diagnostics.push(diagnostic(rule, path, 'record SOURCE_CANDIDATE_PROOF does not bind its SOURCE_TEST_REVISION'));
  if (sensitiveEvidence(JSON.stringify(record))) diagnostics.push(diagnostic(rule, path, 'record contains disallowed private, network, or credential-shaped content; content is redacted'));
  return diagnostics;
}

export function validatePlatformReport(report = {}, expected = {}) {
  const path = `platform-evidence:J-05:${expected.expectedPlatform || report.platform || '<missing>'}`;
  const diagnostics = identityDiagnostics(report, path, 'G-07', expected);
  const required = ['schemaVersion', 'journeyId', 'platform', 'environment', 'sourceTestRevision', 'sourceCandidateProof', 'cleanBefore', 'cleanAfter', 'toolVersions', 'commands', 'dynamicGatewayObservation', 'providerIndependentUsableShellBaseline', 'cleanup', 'sanitization', 'operatorRole', 'reviewerRole', 'remainingRisk', 'disposition'];
  const missing = required.filter((field) => report[field] === undefined || report[field] === '');
  if (missing.length) diagnostics.push(diagnostic('G-07', path, `platform report is missing required fields: ${missing.join(', ')}`));
  if (report.schemaVersion !== 1 || report.journeyId !== 'J-05') diagnostics.push(diagnostic('G-07', path, 'platform report schema version or journey ID is invalid'));
  if (expected.expectedPlatform && report.platform !== expected.expectedPlatform) diagnostics.push(diagnostic('G-07', path, 'platform report does not match its declared native platform'));
  if (!object(report.environment) || report.environment.kind !== 'native' || !nonempty(report.environment.osName) || !nonempty(report.environment.osVersion) || !nonempty(report.environment.architecture)) diagnostics.push(diagnostic('G-07', path, 'platform report requires a complete native environment'));
  const expectedOs = report.platform === 'windows' ? /windows/i : report.platform === 'macos' ? /macos|mac os|darwin/i : null;
  if (expectedOs && !expectedOs.test(report.environment?.osName || '')) diagnostics.push(diagnostic('G-07', path, 'platform report native OS does not match the claimed platform'));
  if (report.cleanBefore !== true || report.cleanAfter !== true) diagnostics.push(diagnostic('G-07', path, 'platform report requires clean before and after states'));
  if (!object(report.toolVersions) || Object.keys(report.toolVersions).length === 0 || Object.values(report.toolVersions).some((value) => !nonempty(value))) diagnostics.push(diagnostic('G-07', path, 'platform report requires non-empty platform and tool versions'));
  if (!Array.isArray(report.commands) || report.commands.length === 0 || report.commands.some((entry) => !object(entry) || !nonempty(entry.command) || !nonempty(entry.workingDirectory) || entry.exitCode !== 0 || entry.result !== 'pass' || !nonempty(entry.summary))) diagnostics.push(diagnostic('G-07', path, 'platform report requires exact passing commands and results'));
  for (const field of ['dynamicGatewayObservation', 'providerIndependentUsableShellBaseline']) if (!object(report[field]) || report[field].result !== 'pass' || !nonempty(report[field].summary)) diagnostics.push(diagnostic('G-07', path, `platform report requires a substantive passing ${field}`));
  for (const field of ['cleanup', 'operatorRole', 'reviewerRole', 'remainingRisk']) if (!nonempty(report[field])) diagnostics.push(diagnostic('G-07', path, `platform report requires ${field}`));
  if (report.sanitization !== 'pass') diagnostics.push(diagnostic('G-07', path, 'platform report sanitization must pass'));
  if (report.disposition !== 'pass') diagnostics.push(diagnostic('G-07', path, 'platform report disposition must pass'));
  return diagnostics;
}

export function validateHumanReview(report = {}, expected = {}) {
  const path = `human-evidence:${expected.expectedReviewId || report.reviewId || '<missing>'}`;
  const diagnostics = identityDiagnostics(report, path, 'G-05', expected);
  const required = ['schemaVersion', 'reviewId', 'reviewerRole', 'operatorRole', 'sourceTestRevision', 'sourceCandidateProof', 'scope', 'reviewedSources', 'findings', 'independence', 'sanitization', 'remainingRisk', 'disposition'];
  const missing = required.filter((field) => report[field] === undefined || report[field] === '');
  if (missing.length) diagnostics.push(diagnostic('G-05', path, `human review is missing required fields: ${missing.join(', ')}`));
  if (report.schemaVersion !== 1 || !/^REV-0[1-8]$/.test(report.reviewId || '')) diagnostics.push(diagnostic('G-05', path, 'human review schema version or review ID is invalid'));
  if (expected.expectedReviewId && report.reviewId !== expected.expectedReviewId) diagnostics.push(diagnostic('G-05', path, 'human review ID does not match its declared location'));
  if (expected.expectedReviewerRole && report.reviewerRole !== expected.expectedReviewerRole) diagnostics.push(diagnostic('G-05', path, 'human review is not attributable to the required reviewer role'));
  for (const field of ['reviewerRole', 'operatorRole', 'independence', 'remainingRisk']) if (!nonempty(report[field])) diagnostics.push(diagnostic('G-05', path, `human review requires ${field}`));
  for (const field of ['scope', 'reviewedSources']) if (!Array.isArray(report[field]) || report[field].length === 0 || report[field].some((value) => !nonempty(value))) diagnostics.push(diagnostic('G-05', path, `human review requires a non-empty ${field} array`));
  if (!Array.isArray(report.findings) || report.findings.some((finding) => !object(finding))) diagnostics.push(diagnostic('G-05', path, 'human review findings must be an array of structured records'));
  if (Array.isArray(report.findings) && report.findings.some((finding) => finding?.disposition !== 'resolved')) diagnostics.push(diagnostic('G-05', path, 'human review cannot pass with an open or blocked finding'));
  if (report.sanitization !== 'pass') diagnostics.push(diagnostic('G-05', path, 'human review sanitization must pass'));
  if (report.disposition !== 'pass') diagnostics.push(diagnostic('G-05', path, 'human review disposition must pass'));
  return diagnostics;
}

export async function readEvidenceJson(root, path, { rule = 'G-13' } = {}) {
  const inspected = await readContainedText(root, path);
  if (!inspected.ok) return { diagnostics: [diagnostic(rule, path, `evidence record was not read: ${inspected.reason}`)] };
  let value;
  try { value = JSON.parse(inspected.text); }
  catch { return { diagnostics: [diagnostic(rule, path, 'evidence record is invalid JSON')] }; }
  if (sensitiveEvidence(inspected.text)) return { diagnostics: [diagnostic(rule, path, 'evidence record contains disallowed sensitive content; content is redacted')] };
  return { value, diagnostics: [] };
}
