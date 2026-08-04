import { diagnostic } from '../diagnostics.mjs';

export function validateVersioning(data = {}) {
  const diagnostics = [];
  const domains = new Set((data.versionDomains || []).map(({ id }) => id));
  for (const domain of data.versionDomains || []) {
    if (!String(domain.branchTagContract || '').trim() || !String(domain.compatibilityContract || '').trim()) diagnostics.push(diagnostic('DA-14', 'version domain', `version domain ${domain.id || '<missing>'} lacks an explicit branch/tag contract and compatibility contract`));
  }
  for (const reference of data.references || []) {
    if (!domains.has(reference.domain)) diagnostics.push(diagnostic('DA-14', 'version reference', `unknown version domain ${reference.domain}`));
    if (reference.applicability === 'tag' && reference.targetApplicability === 'dev') diagnostics.push(diagnostic('DA-14', 'version reference', 'release/tag guidance points silently to later dev truth'));
  }
  for (const deprecation of data.deprecations || []) {
    for (const field of ['status', 'replacement', 'migrationGuidance', 'compatibility', 'removalState']) {
      if (!String(deprecation[field] || '').trim()) diagnostics.push(diagnostic('DA-09', deprecation.subject || 'deprecation', `deprecation contract is missing ${field}`));
    }
  }
  return diagnostics;
}
