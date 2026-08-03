import { fileURLToPath } from 'node:url';
import { diagnostic } from '../diagnostics.mjs';
import { readContainedText } from '../paths.mjs';

const ISSUE_FIELDS = ['page-path', 'branch-tag', 'journey', 'expected', 'actual', 'proposed-correction', 'sanitized-evidence'];
const PR_FIELDS = ['documentation impact', 'no-impact reason', 'exact verification evidence'];

function validateContract(contract, path = 'contract.json') {
  const diagnostics = [];
  for (const field of ISSUE_FIELDS) if (!(contract.issueFields || []).includes(field)) diagnostics.push(diagnostic('DA-12', path, `documentation issue form is missing ${field}`));
  for (const field of PR_FIELDS) if (!(contract.prFields || []).includes(field)) diagnostics.push(diagnostic('DA-12', path, `pull request contract is missing ${field}`));
  if (!String(contract.routes?.support || '').toLowerCase().includes('community')) diagnostics.push(diagnostic('DA-12', path, 'support requests must route to the BrainDrive community forum'));
  if (!String(contract.routes?.security || '').includes('Private Vulnerability Reporting')) diagnostics.push(diagnostic('DA-12', path, 'suspected vulnerabilities must route to GitHub Private Vulnerability Reporting'));
  if (!contract.ownerRole) diagnostics.push(diagnostic('DA-12', path, 'canonical documentation contract is missing an owner role'));
  if (contract.ci?.job !== 'Documentation' || Number(contract.ci?.node) !== 22) diagnostics.push(diagnostic('DA-12', path, 'Documentation CI contract must use Node 22'));
  return diagnostics;
}

function section(body, title) {
  const clean = body.replace(/<!--[\s\S]*?-->/g, '');
  const lines = clean.split(/\r?\n/);
  const heading = new RegExp(`^#{2,3}\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return '';
  const content = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^#{2,3}\s+/.test(lines[index])) break;
    content.push(lines[index]);
  }
  return content.join('\n').trim();
}

export function pullRequestDecision(body = '') {
  const impact = section(body, 'Documentation impact');
  const noImpactReason = section(body, 'No-impact reason');
  const verificationEvidence = section(body, 'Exact verification evidence');
  return { impact, noImpactReason, verificationEvidence, noImpact: /\bno documentation impact\b/i.test(impact) };
}

export function validatePullRequestBody(body = '') {
  const diagnostics = [];
  const decision = pullRequestDecision(body);
  if (!decision.impact) diagnostics.push(diagnostic('DA-13', 'pull_request.body', 'pull request is missing a substantive documentation impact declaration'));
  if (decision.noImpact && !decision.noImpactReason) diagnostics.push(diagnostic('DA-13', 'pull_request.body', 'no-documentation-impact declaration is missing a substantive no-impact reason'));
  if (!decision.verificationEvidence) diagnostics.push(diagnostic('DA-13', 'pull_request.body', 'pull request is missing substantive exact verification evidence'));
  return diagnostics;
}

export async function validateGitHubContracts(root) {
  const base = root instanceof URL ? fileURLToPath(root) : root;
  const fixtureContract = await readContainedText(base, 'contract.json');
  if (fixtureContract.ok) {
    try { return validateContract(JSON.parse(fixtureContract.text)); }
    catch { return [diagnostic('DA-12', 'contract.json', 'GitHub fixture contract is invalid JSON')]; }
  }
  if (fixtureContract.reason !== 'path does not exist') return [diagnostic('DA-16', 'contract.json', `GitHub fixture contract was not read: ${fixtureContract.reason}`)];
  const inputs = await Promise.all([
    readContainedText(base, '.github/ISSUE_TEMPLATE/documentation.yml'),
    readContainedText(base, '.github/pull_request_template.md'),
    readContainedText(base, '.github/workflows/ci.yml'),
    readContainedText(base, 'docs/developers/catalog.json'),
  ]);
  const inputPaths = ['.github/ISSUE_TEMPLATE/documentation.yml', '.github/pull_request_template.md', '.github/workflows/ci.yml', 'docs/developers/catalog.json'];
  const unsafe = inputs.flatMap((input, index) => input.ok ? [] : [diagnostic('DA-16', inputPaths[index], `GitHub governance input was not read: ${input.reason}`)]);
  if (unsafe.length) return unsafe;
  const [issue, pr, ci, catalogText] = inputs.map(({ text }) => text);
  let catalog;
  try { catalog = JSON.parse(catalogText); }
  catch { return [diagnostic('DA-12', 'docs/developers/catalog.json', 'GitHub governance catalog input is invalid JSON')]; }
  const contract = {
    issueFields: ISSUE_FIELDS.filter((field) => issue.includes(`id: ${field}`)),
    prFields: PR_FIELDS.filter((field) => pr.toLowerCase().includes(field)),
    routes: { support: issue.includes('community.braindrive.ai') ? 'BrainDrive community forum' : '', security: issue.includes('security/advisories/new') ? 'GitHub Private Vulnerability Reporting' : '' },
    ownerRole: catalog.ownerRoles?.find(({ id }) => id === 'documentation-maintainers')?.id,
    ci: { job: /\n\s*documentation:\s*\n[\s\S]*?name:\s*Documentation/.test(ci) ? 'Documentation' : '', node: /documentation:[\s\S]*?node-version:\s*22/.test(ci) ? 22 : 0 },
  };
  const diagnostics = validateContract(contract, '.github');
  if (!ci.includes('npm --prefix builds/typescript run docs:verify')) diagnostics.push(diagnostic('DA-12', '.github/workflows/ci.yml', 'Documentation job is missing docs:verify command'));
  if (!ci.includes('node tools/docs/check.mjs --report "$RUNNER_TEMP/docs-verification-report.json"')) diagnostics.push(diagnostic('DA-12', '.github/workflows/ci.yml', 'Documentation job is missing the repository-root report command'));
  for (const job of ['runtime', 'web-client', 'mcp-release', 'docker-smoke', 'installer-integrity', 'secret-scan']) {
    if (!new RegExp(`\\n  ${job}:\\n`).test(ci)) diagnostics.push(diagnostic('DA-12', '.github/workflows/ci.yml', `existing CI job is missing: ${job}`));
  }
  for (const trigger of ['pull_request', 'push', 'workflow_dispatch']) if (!new RegExp(`^  ${trigger}:`, 'm').test(ci)) diagnostics.push(diagnostic('DA-12', '.github/workflows/ci.yml', `existing workflow trigger is missing: ${trigger}`));
  if (!/pull_request:\s*\n\s*branches:\s*\n\s*- dev\s*\n\s*- main/.test(ci) || !/push:\s*\n\s*branches:\s*\n\s*- dev\s*\n\s*- main/.test(ci)) diagnostics.push(diagnostic('DA-12', '.github/workflows/ci.yml', 'pull-request and push triggers must retain dev and main branches'));
  if (/^\s+paths(?:-ignore)?:/m.test(ci)) diagnostics.push(diagnostic('DA-12', '.github/workflows/ci.yml', 'CI workflow must not add path filtering'));
  return diagnostics;
}
