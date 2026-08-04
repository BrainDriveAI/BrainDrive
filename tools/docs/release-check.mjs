import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidateDigest } from './candidate-digest.mjs';
import { checkRepository } from './check.mjs';
import { diagnostic, formatDiagnostic, redactDiagnosticText } from './lib/diagnostics.mjs';
import { readContainedText } from './lib/paths.mjs';
import { validateAiScorecard, validateClaimedPlatformEvidence } from './lib/rules/evidence.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const platformReportPath = 'docs/developers/verification/platform-reports.json';

async function readJson(repositoryRoot, path, rule) {
  const inspected = await readContainedText(repositoryRoot, path);
  if (!inspected.ok) return { diagnostics: [diagnostic(rule, path, `release evidence was not read: ${inspected.reason}`)] };
  try {
    return { value: JSON.parse(inspected.text), diagnostics: [] };
  } catch {
    return { diagnostics: [diagnostic(rule, path, 'release evidence is invalid JSON')] };
  }
}

export async function checkReleaseEvidence(repositoryRoot = root, { platformReports } = {}) {
  repositoryRoot = resolve(repositoryRoot);
  const diagnostics = [];
  const documentation = await checkRepository(repositoryRoot);
  if (documentation.status !== 'pass') diagnostics.push(diagnostic('G-12', 'documentation-verification', 'repository documentation validation is not passing'));

  const catalogResult = await readJson(repositoryRoot, 'docs/developers/catalog.json', 'G-02');
  const harnessResult = await readJson(repositoryRoot, 'tools/docs/harness/scenarios.json', 'G-10');
  diagnostics.push(...catalogResult.diagnostics, ...harnessResult.diagnostics);
  const catalog = catalogResult.value;
  const harness = harnessResult.value;
  const digest = await candidateDigest(repositoryRoot);
  const candidateProof = `candidate-content ${digest.algorithm} ${digest.digest}; entries ${digest.entries}; head ${digest.head}`;

  let reports = platformReports;
  if (!reports && existsSync(resolve(repositoryRoot, platformReportPath))) {
    const reportResult = await readJson(repositoryRoot, platformReportPath, 'G-07');
    diagnostics.push(...reportResult.diagnostics);
    reports = reportResult.value?.reports;
  }
  reports = Array.isArray(reports) ? reports : [];
  for (const claim of catalog?.platformClaims || []) diagnostics.push(...validateClaimedPlatformEvidence(claim, reports, { candidateProof }));

  for (const scenario of harness?.scenarios || []) {
    const path = scenario.evidence?.scorecardPath;
    if (!path) continue;
    const inspected = await readContainedText(repositoryRoot, path);
    if (!inspected.ok) {
      diagnostics.push(diagnostic('G-10', path, `AI scorecard was not read: ${inspected.reason}`));
      continue;
    }
    diagnostics.push(...validateAiScorecard(scenario, inspected.text, path, { candidateProof }).filter(({ rule }) => rule === 'G-10'));
  }

  return { status: diagnostics.length ? 'blocked' : 'pass', candidateProof, diagnostics };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkReleaseEvidence(process.cwd());
    for (const item of result.diagnostics) console.error(formatDiagnostic(item));
    console.log(`Release evidence precursor: ${result.status.toUpperCase()} (${result.diagnostics.length} diagnostics).`);
    if (result.diagnostics.length) process.exitCode = 1;
  } catch (error) {
    console.error(`[G-00] tools/docs/release-check.mjs: validation could not run: ${redactDiagnosticText(error.message)}`);
    process.exitCode = 1;
  }
}
