import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function safe(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').replace(/[<>]/g, '');
}

export function formatSummary(report, { verificationOutcome = 'success' } = {}) {
  const verificationPassed = verificationOutcome === 'success';
  const combinedStatus = verificationPassed && report.status === 'pass' ? 'pass' : 'fail';
  const lines = [
    '## Documentation verification',
    '',
    `Status: **${safe(combinedStatus).toUpperCase()}** — ${Number(report.diagnostics?.length || 0)} diagnostics across ${Number(report.candidateManifest?.documentationGovernanceCandidates?.length || 0)} scoped candidates.`,
    `docs:verify step outcome: ${safe(verificationOutcome)}.`,
  ];
  if (report.diagnostics?.length) {
    lines.push('', '| Rule | Path | Diagnostic | Hint |', '|---|---|---|---|');
    for (const item of report.diagnostics) lines.push(`| ${safe(item.rule)} | ${safe(item.path)} | ${safe(item.message)} | ${safe(item.hint)} |`);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('Usage: node tools/docs/ci-summary.mjs <report.json>');
    process.exitCode = 2;
  } else {
    try { process.stdout.write(formatSummary(JSON.parse(await readFile(process.argv[2], 'utf8')), { verificationOutcome: process.env.DOCS_VERIFY_OUTCOME || 'unknown' })); }
    catch { console.log('## Documentation verification\n\nThe sanitized report was not available.'); process.exitCode = 1; }
  }
}
