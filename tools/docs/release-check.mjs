import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRepository } from './check.mjs';
import { diagnostic, formatDiagnostic, redactDiagnosticText } from './lib/diagnostics.mjs';
import {
  adjudicateRevisionCompatibility,
  adjudicatePlatformEvidenceCarryForward,
  readEvidenceJson,
  resolveCommit,
  sourceCandidateIdentity,
  validateHumanReview,
  validatePlatformReport,
} from './lib/evidence-identity.mjs';
import { readContainedText } from './lib/paths.mjs';
import { HUMAN_REVIEW_ROLES } from './lib/catalog.mjs';
import { validateAiScorecard, validateMilestoneRecord } from './lib/rules/evidence.mjs';
import { validateSchema } from './lib/schema.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
async function readJson(repositoryRoot, path, rule) {
  const result = await readEvidenceJson(repositoryRoot, path, { rule });
  return result;
}

function identityFromScorecard(text) {
  return {
    sourceTestRevision: text.match(/^- (?:SOURCE_TEST_REVISION|Source test revision):\s*`?([a-f0-9]{40})`?\s*$/im)?.[1],
    sourceCandidateProof: text.match(/^- (?:SOURCE_CANDIDATE_PROOF|Source candidate proof):\s*`?(source-candidate sha256 [a-f0-9]{64}; entries \d+; revision [a-f0-9]{40})`?\s*$/im)?.[1],
  };
}

async function discoverSourceTestRevision(repositoryRoot, catalog, harness) {
  const revisions = new Set();
  for (const claim of catalog?.platformClaims || []) for (const requirement of claim.requiredEvidence || []) {
    if (!requirement.reportPath || !existsSync(resolve(repositoryRoot, requirement.reportPath))) continue;
    const result = await readJson(repositoryRoot, requirement.reportPath, 'G-07');
    if (result.value?.sourceTestRevision) revisions.add(result.value.sourceTestRevision);
  }
  for (const requirement of catalog?.humanReviewRequirements || []) {
    if (!existsSync(resolve(repositoryRoot, requirement.path))) continue;
    const result = await readJson(repositoryRoot, requirement.path, 'G-05');
    if (result.value?.sourceTestRevision) revisions.add(result.value.sourceTestRevision);
  }
  for (const scenario of harness?.scenarios || []) {
    const path = scenario.evidence?.scorecardPath;
    if (!path) continue;
    const inspected = await readContainedText(repositoryRoot, path);
    if (inspected.ok) {
      const revision = identityFromScorecard(inspected.text).sourceTestRevision;
      if (revision) revisions.add(revision);
    }
  }
  return [...revisions];
}

function worktreeIsClean(repositoryRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: repositoryRoot, encoding: 'buffer' });
  if (result.status !== 0) throw new Error('git status failed while checking release evidence identity');
  return result.stdout.length === 0;
}

async function readSchema(repositoryRoot, name, diagnostics) {
  const path = `tools/docs/schemas/${name}`;
  const result = await readJson(repositoryRoot, path, 'G-13');
  diagnostics.push(...result.diagnostics);
  return result.value;
}

export async function checkReleaseEvidence(repositoryRoot = root, options = {}) {
  repositoryRoot = resolve(repositoryRoot);
  const diagnostics = [];
  const documentation = await checkRepository(repositoryRoot);
  if (documentation.status !== 'pass') diagnostics.push(diagnostic('G-12', 'documentation-verification', 'repository documentation validation is not passing'));

  const catalogResult = await readJson(repositoryRoot, 'docs/developers/catalog.json', 'G-02');
  const harnessResult = await readJson(repositoryRoot, 'tools/docs/harness/scenarios.json', 'G-10');
  diagnostics.push(...catalogResult.diagnostics, ...harnessResult.diagnostics);
  const catalog = catalogResult.value;
  const harness = harnessResult.value;

  const evidenceRevision = resolveCommit(repositoryRoot, options.evidenceRevision || process.env.EVIDENCE_REVISION || 'HEAD');
  const discovered = await discoverSourceTestRevision(repositoryRoot, catalog, harness);
  if (!options.sourceTestRevision && !process.env.SOURCE_TEST_REVISION && discovered.length > 1) diagnostics.push(diagnostic('G-13', 'release-evidence-identity', 'evidence records disagree on SOURCE_TEST_REVISION'));
  const requestedSource = options.sourceTestRevision || process.env.SOURCE_TEST_REVISION || (discovered.length === 1 ? discovered[0] : evidenceRevision);
  let identity;
  try {
    identity = await sourceCandidateIdentity(repositoryRoot, requestedSource);
  } catch {
    diagnostics.push(diagnostic('G-13', 'release-evidence-identity', 'declared SOURCE_TEST_REVISION does not resolve to a repository commit'));
    identity = await sourceCandidateIdentity(repositoryRoot, evidenceRevision);
  }
  const suppliedProof = options.sourceCandidateProof || process.env.SOURCE_CANDIDATE_PROOF;
  if (suppliedProof && suppliedProof !== identity.sourceCandidateProof) diagnostics.push(diagnostic('G-13', 'release-evidence-identity', 'supplied SOURCE_CANDIDATE_PROOF does not match SOURCE_TEST_REVISION'));
  const compatibility = await adjudicateRevisionCompatibility(repositoryRoot, { sourceTestRevision: identity.sourceTestRevision, evidenceRevision });
  diagnostics.push(...compatibility.diagnostics);
  if (resolveCommit(repositoryRoot, 'HEAD') !== evidenceRevision) diagnostics.push(diagnostic('G-13', 'release-evidence-identity', 'EVIDENCE_REVISION must match the checked-out revision used to read evidence'));
  if (!worktreeIsClean(repositoryRoot)) diagnostics.push(diagnostic('G-13', 'release-evidence-identity', 'release evidence checkout is not clean'));

  const platformSchema = await readSchema(repositoryRoot, 'platform-report.schema.json', diagnostics);
  const humanSchema = await readSchema(repositoryRoot, 'human-review.schema.json', diagnostics);
  const expectedIdentity = {
    sourceTestRevision: identity.sourceTestRevision,
    sourceCandidateProof: identity.sourceCandidateProof,
  };

  for (const claim of catalog?.platformClaims || []) for (const requirement of claim.requiredEvidence || []) {
    const path = requirement.reportPath || `docs/developers/verification/platform-reports/${requirement.platform}-j05.json`;
    let value;
    if (Array.isArray(options.platformReports)) value = options.platformReports.find((report) => report?.journeyId === claim.journeyId && report?.platform === requirement.platform);
    else if (existsSync(resolve(repositoryRoot, path))) {
      const result = await readJson(repositoryRoot, path, 'G-07');
      diagnostics.push(...result.diagnostics);
      value = result.value;
    }
    if (!value) {
      diagnostics.push(diagnostic('G-07', `platform-evidence:${claim.journeyId}:${requirement.platform}`, `required native ${requirement.platform} journey evidence report is absent`));
      continue;
    }
    if (platformSchema) diagnostics.push(...validateSchema(platformSchema, value, path, { rule: 'G-07' }));
    let reportIdentity = expectedIdentity;
    if (value.sourceTestRevision !== identity.sourceTestRevision || value.sourceCandidateProof !== identity.sourceCandidateProof) {
      try {
        const testedIdentity = await sourceCandidateIdentity(repositoryRoot, value.sourceTestRevision);
        reportIdentity = {
          sourceTestRevision: testedIdentity.sourceTestRevision,
          sourceCandidateProof: testedIdentity.sourceCandidateProof,
        };
        const carryForward = await adjudicatePlatformEvidenceCarryForward(repositoryRoot, {
          testedRevision: testedIdentity.sourceTestRevision,
          targetRevision: identity.sourceTestRevision,
          platform: requirement.platform,
        });
        diagnostics.push(...carryForward.diagnostics);
      } catch {
        diagnostics.push(diagnostic('G-07', `platform-evidence:${claim.journeyId}:${requirement.platform}`, 'platform report SOURCE_TEST_REVISION does not resolve for compatibility review'));
      }
    }
    diagnostics.push(...validatePlatformReport(value, { expectedPlatform: requirement.platform, ...reportIdentity }));
  }

  for (const requirement of catalog?.humanReviewRequirements || []) {
    let value;
    if (existsSync(resolve(repositoryRoot, requirement.path))) {
      const result = await readJson(repositoryRoot, requirement.path, 'G-05');
      diagnostics.push(...result.diagnostics);
      value = result.value;
    }
    if (!value) {
      diagnostics.push(diagnostic('G-05', `human-evidence:${requirement.id}`, `required ${requirement.id} human review is absent`));
      continue;
    }
    if (humanSchema) diagnostics.push(...validateSchema(humanSchema, value, requirement.path, { rule: 'G-05' }));
    diagnostics.push(...validateHumanReview(value, { expectedReviewId: requirement.id, expectedReviewerRole: requirement.reviewerRole || HUMAN_REVIEW_ROLES[requirement.id], ...expectedIdentity }));
  }

  for (const scenario of harness?.scenarios || []) {
    const path = scenario.evidence?.scorecardPath;
    if (!path) continue;
    const inspected = await readContainedText(repositoryRoot, path);
    if (!inspected.ok) {
      diagnostics.push(diagnostic('G-10', path, `AI scorecard was not read: ${inspected.reason}`));
      continue;
    }
    diagnostics.push(...validateAiScorecard(scenario, inspected.text, path, { ...expectedIdentity, requireSubstantiveArtifacts: true }).filter(({ rule }) => rule === 'G-10'));
  }

  const milestonePath = 'docs/developers/verification/milestones/07-release-gauntlet.md';
  const milestone = await readContainedText(repositoryRoot, milestonePath);
  if (!milestone.ok) diagnostics.push(diagnostic('G-13', milestonePath, `Milestone 7 evidence was not read: ${milestone.reason}`));
  else {
    diagnostics.push(...validateMilestoneRecord(milestone.text, milestonePath).map((item) => ({ ...item, rule: 'G-13' })));
    if (!milestone.text.trimEnd().endsWith('MILESTONE 7 COMPLETE — NEXT LEGAL PROMPT: NONE')) diagnostics.push(diagnostic('G-13', milestonePath, 'Milestone 7 remains blocked or incomplete'));
  }
  for (const path of ['docs/developers/verification/m7-trace-matrix.md', 'docs/developers/verification/v1-readiness.md']) {
    const inspected = await readContainedText(repositoryRoot, path);
    if (!inspected.ok) diagnostics.push(diagnostic('G-13', path, `required release evidence was not read: ${inspected.reason}`));
    else {
      const recordIdentity = identityFromScorecard(inspected.text);
      if (recordIdentity.sourceTestRevision !== identity.sourceTestRevision || recordIdentity.sourceCandidateProof !== identity.sourceCandidateProof) diagnostics.push(diagnostic('G-13', path, 'release evidence does not bind the current SOURCE_TEST_REVISION and SOURCE_CANDIDATE_PROOF'));
    }
  }

  return {
    status: diagnostics.length ? 'blocked' : 'pass',
    sourceTestRevision: identity.sourceTestRevision,
    sourceCandidateProof: identity.sourceCandidateProof,
    evidenceRevision,
    compatibility,
    diagnostics,
  };
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  if (!argv[index + 1]) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const result = await checkReleaseEvidence(process.cwd(), {
      sourceTestRevision: argument(argv, '--source-test-revision'),
      sourceCandidateProof: argument(argv, '--source-candidate-proof'),
      evidenceRevision: argument(argv, '--evidence-revision'),
    });
    for (const item of result.diagnostics) console.error(formatDiagnostic(item));
    console.log(`SOURCE_TEST_REVISION=${result.sourceTestRevision}`);
    console.log(`SOURCE_CANDIDATE_PROOF=${result.sourceCandidateProof}`);
    console.log(`EVIDENCE_REVISION=${result.evidenceRevision}`);
    console.log(`Release evidence precursor: ${result.status.toUpperCase()} (${result.diagnostics.length} diagnostics).`);
    if (result.diagnostics.length) process.exitCode = 1;
  } catch (error) {
    console.error(`[G-00] tools/docs/release-check.mjs: validation could not run: ${redactDiagnosticText(error.message)}`);
    process.exitCode = 1;
  }
}
