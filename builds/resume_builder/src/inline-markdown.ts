// Canonical inline grammar for paper previews and PDF exports.
// The standalone shipped program embeds a generated copy (see scripts/sync-inline-markdown.mjs).
export interface InlineTextRun { text: string; bold: boolean }

export function parseInlineMarkdown(text: string): InlineTextRun[] {
  // Pair emphasis delimiters; unmatched/escaped punctuation remains literal.
  // Italics use plain text in the two-face PDF font set; strong stays bold.
  const removed = new Set<number>();
  const boldChanges = new Int16Array(text.length + 1);
  const delimiters: { marker: string; start: number; length: number; remaining: number; open: boolean; close: boolean }[] = [];
  const whitespace = (character: string) => !character || /\s/u.test(character);
  const punctuation = (character: string) => /[\p{P}\p{S}]/u.test(character);
  for (let index = 0; index < text.length; index += 1) {
    // Code spans and bare URLs/emails are literal; emphasis can still surround them.
    if (text[index] === "`") {
      const ticks = /^`+/.exec(text.slice(index))![0];
      let closing = index + ticks.length;
      while (closing < text.length) {
        const match = /`+/.exec(text.slice(closing));
        if (!match) break;
        closing += match.index;
        if (match[0].length === ticks.length) {
          for (let offset = 0; offset < ticks.length; offset += 1) {
            removed.add(index + offset);
            removed.add(closing + offset);
          }
          const content = text.slice(index + ticks.length, closing);
          if (content.startsWith(" ") && content.endsWith(" ") && content.trim()) {
            removed.add(index + ticks.length);
            removed.add(closing - 1);
          }
          index = closing + ticks.length - 1;
          break;
        }
        closing += match[0].length;
      }
      if (removed.has(index - ticks.length + 1)) continue;
    }
    // Leading emphasis is syntax; underscores inside an address remain protected.
    const literal = text[index] !== "_" && /^(?:(?:https?:\/\/|www\.)[^\s<>`]+|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.exec(text.slice(index));
    if (literal) {
      let length = literal[0].length;
      const opener = delimiters.at(-1);
      if (opener?.open && literal[0].endsWith(opener.marker.repeat(opener.remaining))) length -= opener.remaining;
      index += length - 1;
      continue;
    }
    if (text[index] === "\\" && /[\\*_]/.test(text[index + 1] ?? "")) {
      removed.add(index);
      index += 1;
      continue;
    }
    const marker = text[index];
    if (marker !== "*" && marker !== "_") continue;
    const start = index;
    while (text[index + 1] === marker) index += 1;
    const before = text[start - 1] ?? "";
    const after = text[index + 1] ?? "";
    const left = !whitespace(after) && (!punctuation(after) || whitespace(before) || punctuation(before));
    const right = !whitespace(before) && (!punctuation(before) || whitespace(after) || punctuation(after));
    delimiters.push({
      marker, start, length: index - start + 1, remaining: index - start + 1,
      open: left && (marker === "*" || !right || punctuation(before)),
      close: right && (marker === "*" || !left || punctuation(after)),
    });
  }
  for (let closerIndex = 0; closerIndex < delimiters.length; closerIndex += 1) {
    const closer = delimiters[closerIndex];
    if (!closer.close) continue;
    for (let openerIndex = closerIndex - 1; openerIndex >= 0 && closer.remaining > 0; openerIndex -= 1) {
      const opener = delimiters[openerIndex];
      if (!opener.open || !opener.remaining || opener.marker !== closer.marker) continue;
      // Ambiguous runs follow Markdown's rule of three.
      if ((opener.close || closer.open) && (opener.length + closer.length) % 3 === 0
        && (opener.length % 3 !== 0 || closer.length % 3 !== 0)) continue;
      while (opener.remaining > 0 && closer.remaining > 0) {
        const width = opener.remaining >= 2 && closer.remaining >= 2 ? 2 : 1;
        const openStart = opener.start + opener.remaining - width;
        const closeStart = closer.start + closer.length - closer.remaining;
        for (let offset = 0; offset < width; offset += 1) {
          removed.add(openStart + offset);
          removed.add(closeStart + offset);
        }
        if (width === 2) {
          boldChanges[openStart + width] += 1;
          boldChanges[closeStart] -= 1;
        }
        opener.remaining -= width;
        closer.remaining -= width;
      }
      // Matched pairs enclose, rather than cross, intervening delimiters.
      for (let index = openerIndex + 1; index < closerIndex; index += 1) delimiters[index].open = false;
    }
  }
  const runs: InlineTextRun[] = [];
  let boldDepth = 0;
  for (let index = 0; index < text.length; index += 1) {
    boldDepth += boldChanges[index];
    if (removed.has(index)) continue;
    const bold = boldDepth > 0;
    const last = runs.at(-1);
    if (last && last.bold === bold) last.text += text[index];
    else runs.push({ text: text[index], bold });
  }
  return runs;
}
