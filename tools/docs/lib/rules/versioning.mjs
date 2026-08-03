import { diagnostic } from '../diagnostics.mjs';

export function validateVersioning(data = {}) {
  const diagnostics = [];
  const domains = new Set((data.versionDomains || []).map(({ id }) => id));
  for (const reference of data.references || []) {
    if (!domains.has(reference.domain)) diagnostics.push(diagnostic('DA-14', 'version reference', `unknown version domain ${reference.domain}`));
    if (reference.applicability === 'tag' && reference.targetApplicability === 'dev') diagnostics.push(diagnostic('DA-14', 'version reference', 'release/tag guidance points silently to later dev truth'));
  }
  return diagnostics;
}
