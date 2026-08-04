import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { open, readFile, realpath, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from './lib/catalog.mjs';
import { formatDiagnostic, diagnostic, redactDiagnosticText } from './lib/diagnostics.mjs';
import { documentationCandidates, enumerateCandidates } from './lib/git-inputs.mjs';
import { validateRepositoryAuthority } from './lib/rules/authority.mjs';
import { validateCommands, validatePackageScripts } from './lib/rules/commands.mjs';
import { validateRepositoryDuplication } from './lib/rules/duplication.mjs';
import { validateAiScorecard, validateEvidenceTemplates, validateMilestoneRecord, validateHarness } from './lib/rules/evidence.mjs';
import { freshnessNoImpactReason, validateGitHubContracts, validatePullRequestBody } from './lib/rules/github.mjs';
import { validateMarkdownFiles } from './lib/rules/links.mjs';
import { validateCandidateScope, validateSecurityText } from './lib/rules/security.mjs';
import { validateDirectEntryStatus, validateOrientationContent, validatePlainSourceText, validateStructure } from './lib/rules/structure.mjs';
import { validateFreshness } from './lib/rules/freshness.mjs';
import { validateVersioning } from './lib/rules/versioning.mjs';
import { synchronizeGenerated } from './sync-generated.mjs';
import { validateSchema } from './lib/schema.mjs';
import { readContainedText } from './lib/paths.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DA_CAPABILITIES = Array.from({ length: 18 }, (_, index) => `DA-${String(index + 1).padStart(2, '0')}`);

export function validateVerificationReport(report) {
  const diagnostics = [];
  const capabilities = Array.isArray(report?.capabilities) ? report.capabilities : [];
  const reportDiagnostics = Array.isArray(report?.diagnostics) ? report.diagnostics : [];
  if (reportDiagnostics.some(({ rule }) => !DA_CAPABILITIES.includes(rule))) diagnostics.push(diagnostic('DA-18', 'documentation-verification-report.diagnostics', 'diagnostic rules must be DA-01 through DA-18'));
  const ids = capabilities.map(({ id }) => id);
  if (JSON.stringify(ids) !== JSON.stringify(DA_CAPABILITIES)) {
    diagnostics.push(diagnostic('DA-18', 'documentation-verification-report.capabilities', 'capability matrix must contain DA-01 through DA-18 exactly once and in order'));
  }
  const expectedReportStatus = reportDiagnostics.length ? 'fail' : 'pass';
  if (report?.status !== expectedReportStatus) {
    diagnostics.push(diagnostic('DA-18', 'documentation-verification-report.status', `report status must be ${expectedReportStatus} when diagnostics are ${reportDiagnostics.length ? 'present' : 'absent'}`));
  }
  for (const capability of capabilities) {
    if (!DA_CAPABILITIES.includes(capability.id)) continue;
    const expectedStatus = reportDiagnostics.some(({ rule }) => rule === capability.id) ? 'fail' : 'pass';
    if (capability.status !== expectedStatus) {
      diagnostics.push(diagnostic('DA-18', `documentation-verification-report.capabilities.${capability.id}`, `capability status must be ${expectedStatus} for the reported diagnostics`));
    }
  }
  return diagnostics;
}

function sanitizeReportValue(value) {
  if (typeof value === 'string') return redactDiagnosticText(value);
  if (Array.isArray(value)) return value.map(sanitizeReportValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeReportValue(item)]));
  return value;
}

export async function writeReportSafely(reportPath, output, { allowedRoots = [tmpdir(), process.env.RUNNER_TEMP].filter(Boolean) } = {}) {
  const resolvedPath = resolve(reportPath);
  const parent = await realpath(dirname(resolvedPath));
  const roots = await Promise.all(allowedRoots.map((path) => realpath(resolve(path))));
  if (!roots.some((allowed) => parent === allowed || parent.startsWith(`${allowed}${sep}`))) throw new Error('report destination must be inside an approved temporary root');
  let handle;
  try {
    handle = await open(resolvedPath, 'wx', 0o600);
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('report destination already exists or is a symlink');
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify(sanitizeReportValue(output), null, 2)}\n`);
    await handle.chmod(0o600);
  } catch (error) {
    await handle.close();
    await unlink(resolvedPath).catch(() => {});
    throw error;
  }
  await handle.close();
}

function reportArgument(argv) {
  const index = argv.indexOf('--report');
  if (index === -1) return null;
  if (!argv[index + 1]) throw new Error('--report requires a path');
  return resolve(process.cwd(), argv[index + 1]);
}

export async function checkRepository(repositoryRoot = root) {
  repositoryRoot = resolve(repositoryRoot);
  const candidates = enumerateCandidates(repositoryRoot);
  const scoped = documentationCandidates(candidates);
  const diagnostics = [];
  const report = () => ({
    schemaVersion: 1,
    status: diagnostics.length ? 'fail' : 'pass',
    evaluatedAt: new Date().toISOString(),
    candidateManifest: {
      enumeration: 'git ls-files --cached --others --exclude-standard -z',
      totalCandidates: candidates.length,
      documentationGovernanceCandidates: scoped,
      excludedBoundaries: ['ignored paths', 'docs/Security/', 'owner memory', 'backups', 'credential paths', 'generated output', 'vendored dependencies']
    },
    capabilities: DA_CAPABILITIES.map((id) => ({
      id,
      status: diagnostics.some(({ rule }) => rule === id) ? 'fail' : 'pass',
    })),
    diagnostics,
  });
  const safeText = async (path, rule = 'DA-16') => {
    const inspected = await readContainedText(repositoryRoot, path);
    if (!inspected.ok) {
      diagnostics.push(diagnostic(rule, path, `validation input was not read: ${inspected.reason}`));
      return null;
    }
    return inspected.text;
  };
  const catalogText = await safeText('docs/developers/catalog.json');
  if (catalogText === null) return report();
  let catalog;
  try { catalog = JSON.parse(catalogText); }
  catch {
    diagnostics.push(diagnostic('DA-06', 'docs/developers/catalog.json', 'catalog is invalid JSON'));
    return report();
  }
  diagnostics.push(
    ...validateCatalog(catalog, { root: repositoryRoot }),
    ...validateStructure(catalog, candidates),
    ...validateCommands(catalog.commands),
    ...validateCandidateScope(candidates),
    ...validateFreshness(catalog),
    ...validateVersioning(catalog),
  );
  const packageText = await safeText('builds/typescript/package.json');
  if (packageText !== null) {
    try { diagnostics.push(...validatePackageScripts(JSON.parse(packageText))); }
    catch { diagnostics.push(diagnostic('DA-10', 'builds/typescript/package.json', 'package script input is invalid JSON')); }
  }
  diagnostics.push(...await validateRepositoryAuthority(repositoryRoot, catalog));
  diagnostics.push(...await validateRepositoryDuplication(repositoryRoot, catalog));
  diagnostics.push(...await validateGitHubContracts(repositoryRoot));
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' && process.env.GITHUB_EVENT_PATH) {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const body = event.pull_request?.body || '';
    diagnostics.push(...validatePullRequestBody(body));
    const base = event.pull_request?.base?.sha;
    const head = event.pull_request?.head?.sha || 'HEAD';
    if (!base) diagnostics.push(diagnostic('DA-13', 'pull_request.event', 'pull request base revision is unavailable for documentation freshness'));
    else {
      const diff = spawnSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], { cwd: repositoryRoot, encoding: 'utf8' });
      if (diff.status !== 0) diagnostics.push(diagnostic('DA-13', 'pull_request.event', 'changed paths could not be resolved from the pull request revisions'));
      else {
        const changedPaths = diff.stdout.split('\0').filter(Boolean);
        diagnostics.push(...validateFreshness({ changedPaths, changedDocs: changedPaths, sourceMappings: catalog.sourceMappings, noImpactReason: freshnessNoImpactReason(body) }));
      }
    }
  }
  diagnostics.push(...await synchronizeGenerated({ root: repositoryRoot }));

  const schemas = {};
  for (const schema of ['catalog.schema.json', 'evidence.schema.json', 'ai-harness.schema.json', 'milestone-record.schema.json', 'verification-report.schema.json']) {
    const path = `tools/docs/schemas/${schema}`;
    const schemaText = await safeText(path, 'DA-18');
    if (schemaText !== null) {
      try { schemas[schema] = JSON.parse(schemaText); }
      catch { diagnostics.push(diagnostic('DA-18', path, 'schema is invalid JSON')); }
    }
  }
  if (schemas['catalog.schema.json']) diagnostics.push(...validateSchema(schemas['catalog.schema.json'], catalog, 'docs/developers/catalog.json', { rule: 'DA-06' }));
  const harnessText = await safeText('tools/docs/harness/scenarios.json', 'DA-18');
  let harness;
  if (harnessText !== null) {
    try { harness = JSON.parse(harnessText); diagnostics.push(...validateHarness(harness)); }
    catch { diagnostics.push(diagnostic('DA-18', 'tools/docs/harness/scenarios.json', 'AI harness is invalid JSON')); }
  }
  diagnostics.push(...await validateEvidenceTemplates(repositoryRoot));
  if (schemas['ai-harness.schema.json'] && harness) diagnostics.push(...validateSchema(schemas['ai-harness.schema.json'], harness, 'tools/docs/harness/scenarios.json'));
  if (harness) for (const scenario of harness.scenarios || []) {
    const scorecardPath = scenario.evidence?.scorecardPath;
    if (!scorecardPath) continue;
    const scorecard = await safeText(scorecardPath, 'DA-18');
    if (scorecard !== null) diagnostics.push(...validateAiScorecard(scenario, scorecard, scorecardPath));
  }

  for (const milestonePath of candidates.filter((path) => /^docs\/developers\/verification\/milestones\/\d{2}-.*\.md$/.test(path))) {
    if (!existsSync(resolve(repositoryRoot, milestonePath))) continue;
    const milestone = await safeText(milestonePath, 'DA-18');
    if (milestone !== null) {
      diagnostics.push(...validateMilestoneRecord(milestone, milestonePath));
      if (schemas['milestone-record.schema.json']) diagnostics.push(...validateSchema(schemas['milestone-record.schema.json'], milestone, milestonePath));
    }
  }

  const validationClassifications = new Set(['developer-authority', 'scoped-agent-authority', 'developer-security-authority', 'source-adjacent-developer-authority', 'evidence-template', 'non-authoritative-evidence-record', 'validator-reference']);
  const currentAuthorityPaths = new Set([
    ...catalog.topics.filter(({ status }) => status === 'current').map(({ path }) => path),
    ...catalog.documents.filter(({ status, classification }) => status === 'current' && validationClassifications.has(classification)).map(({ path }) => path),
  ]);
  const currentMarkdown = [...currentAuthorityPaths].filter((path) => path.endsWith('.md')).map((path) => resolve(repositoryRoot, path));
  diagnostics.push(...await validateMarkdownFiles(repositoryRoot, currentMarkdown));
  for (const absolutePath of currentMarkdown) {
    const path = absolutePath.slice(repositoryRoot.length + 1);
    const content = await safeText(path);
    if (content !== null) diagnostics.push(...validateSecurityText(path, content), ...validatePlainSourceText(path, content));
  }
  const orientationContents = new Map();
  for (const path of ['docs/developers/README.md', 'docs/developers/terminology.md', 'docs/developers/repository-map.md', 'docs/developers/architecture/README.md']) {
    const content = await safeText(path);
    if (content !== null) orientationContents.set(path, content);
  }
  diagnostics.push(...validateOrientationContent(catalog, orientationContents));
  const directEntryContents = new Map();
  for (const path of ['builds/typescript/Getting-Started-OpenRouter.md', 'builds/typescript/New-User-Setup.md', 'builds/typescript/client_web/src/api/CONTRACT.md']) {
    const content = await safeText(path);
    if (content !== null) directEntryContents.set(path, content);
  }
  diagnostics.push(...validateDirectEntryStatus(catalog, directEntryContents));

  const output = report();
  if (schemas['verification-report.schema.json']) diagnostics.push(...validateSchema(schemas['verification-report.schema.json'], output, 'documentation-verification-report', { rule: 'DA-18' }));
  diagnostics.push(...validateVerificationReport(output));
  return report();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const output = await checkRepository();
    for (const item of output.diagnostics) console.error(formatDiagnostic(item));
    const reportPath = reportArgument(process.argv.slice(2));
    if (reportPath) await writeReportSafely(reportPath, output);
    console.log(`Documentation validation: ${output.status.toUpperCase()} (${output.candidateManifest.documentationGovernanceCandidates.length} scoped candidates, ${output.diagnostics.length} diagnostics).`);
    if (output.diagnostics.length) process.exitCode = 1;
  } catch (error) {
    console.error(`[DA-00] tools/docs/check.mjs: validation could not run: ${redactDiagnosticText(error.message)}`);
    process.exitCode = 1;
  }
}
