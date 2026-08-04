export function githubSlug(value) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/ /g, '-');
}

function fenceToken(line) {
  const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(line);
  return match ? { marker: match[1], character: match[1][0], length: match[1].length, info: match[2].trim() } : null;
}

export function markdownFences(markdown) {
  const fences = [];
  let active = null;
  let offset = 0;
  for (const raw of markdown.match(/[^\n]*(?:\n|$)/g).filter(Boolean)) {
    const line = raw.replace(/\r?\n$/, '');
    const token = fenceToken(line);
    if (!active && token) active = { ...token, start: offset };
    else if (active && token && token.character === active.character && token.length >= active.length && token.info === '') {
      fences.push({ ...active, end: offset + raw.length });
      active = null;
    }
    offset += raw.length;
  }
  if (active) fences.push({ ...active, end: markdown.length });
  return fences;
}

export function stripMarkdownCode(markdown) {
  const chunks = [];
  let cursor = 0;
  for (const fence of markdownFences(markdown)) {
    chunks.push(markdown.slice(cursor, fence.start), '\n');
    cursor = fence.end;
  }
  chunks.push(markdown.slice(cursor));
  return chunks.join('').replace(/`[^`\r\n]+`/g, '');
}

export function headingAnchors(markdown) {
  const counts = new Map();
  const anchors = new Set();
  for (const line of stripMarkdownCode(markdown).split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const base = githubSlug(match[2].replace(/\s+#+$/, ''));
    const count = counts.get(base) || 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}

export function markdownLinks(markdown) {
  const links = [];
  const prose = stripMarkdownCode(markdown);
  const definitions = new Map();
  for (const match of prose.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*(\S+)/gm)) definitions.set(match[1].trim().toLowerCase(), match[2].replace(/^<|>$/g, ''));
  const pattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const match of prose.matchAll(pattern)) links.push(match[1].replace(/^<|>$/g, ''));
  for (const match of prose.matchAll(/(?<!!)\[([^\]]+)\]\[([^\]]*)\]/g)) {
    const label = (match[2] || match[1]).trim().toLowerCase();
    if (definitions.has(label)) links.push(definitions.get(label));
  }
  for (const match of prose.matchAll(/(?<![!\]])\[([^\]]+)\](?![ \t]*(?:\(|\[|:))/g)) {
    const label = match[1].trim().toLowerCase();
    if (definitions.has(label)) links.push(definitions.get(label));
  }
  return links;
}
