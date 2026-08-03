import { diagnostic } from '../diagnostics.mjs';

function matches(path, pattern) {
  if (pattern.endsWith('/**')) return path.startsWith(pattern.slice(0, -3));
  return path === pattern;
}

export function validateFreshness(data = {}) {
  const diagnostics = [];
  for (const path of data.changedPaths || []) {
    const mapping = (data.sourceMappings || []).find(({ source }) => matches(path, source));
    if (mapping && !(data.changedDocs || []).includes(mapping.documentation) && !String(data.noImpactReason || '').trim()) diagnostics.push(diagnostic('DA-13', path, `governed source changed without mapped documentation ${mapping.documentation} or a no-impact reason`));
  }
  if (data.previous && data.current && data.previous.revision === data.current.revision) diagnostics.push(diagnostic('DA-13', 'freshness record', 'current revision must change when recording a new attempt'));
  return diagnostics;
}
