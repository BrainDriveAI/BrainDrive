// Canonical inline grammar for paper previews and PDF exports.
// The standalone shipped program embeds a generated copy (see scripts/sync-inline-markdown.mjs).
export interface InlineTextRun { text: string; bold: boolean }

type InlinePair = { openStart: number; closeStart: number; width: number; openRun: number; closeRun: number };

function analyzeInlineMarkdown(text: string) {
  // Pair emphasis delimiters; unmatched/escaped punctuation remains literal.
  // Italics use plain text in the two-face PDF font set; strong stays bold.
  const removed = new Set<number>();
  const pairs: InlinePair[] = [];
  const literal = new Set<number>();
  const boldChanges = new Int16Array(text.length + 1);
  const delimiters: { marker: string; start: number; length: number; remaining: number; open: boolean; close: boolean }[] = [];
  const whitespace = (character: string) => !character || /\s/u.test(character);
  const punctuation = (character: string) => /[\p{P}\p{S}]/u.test(character);
  const matchCloser = (closerIndex: number) => {
    const closer = delimiters[closerIndex];
    if (!closer.close) return;
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
        pairs.push({ openStart, closeStart, width, openRun: openerIndex, closeRun: closerIndex });
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
  };
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
          for (let offset = index; offset < closing + ticks.length; offset += 1) literal.add(offset);
          index = closing + ticks.length - 1;
          break;
        }
        closing += match[0].length;
      }
      if (removed.has(index - ticks.length + 1)) continue;
    }
    // Leading emphasis is syntax; underscores inside an address remain protected.
    const address = text[index] !== "_" && /^(?:(?:https?:\/\/|www\.)[^\s<>`]+|[\w.+-]+@[\w.-]+\.[a-z]{2,})/i.exec(text.slice(index));
    if (address) {
      let length = address[0].length;
      // A suffix can close several nested emphasis runs before sentence punctuation.
      // Protect the URL payload, not the surrounding syntax. Internal underscores
      // (including /_private_/) stay literal; only a trailing matching run is syntax.
      let suffix = address[0].replace(/(?:(?![*_])[\p{P}\p{S}])+$/u, "");
      const available = {
        "*": delimiters.filter((run) => run.open && run.marker === "*").reduce((sum, run) => sum + run.remaining, 0),
        "_": delimiters.filter((run) => run.open && run.marker === "_").reduce((sum, run) => sum + run.remaining, 0),
      };
      let tail: RegExpExecArray | null;
      while ((tail = /(\*+|_+)$/.exec(suffix))) {
        const marker = tail[0][0] as "*" | "_";
        if (available[marker] < tail[0].length) break;
        available[marker] -= tail[0].length;
        suffix = suffix.slice(0, -tail[0].length);
        length = suffix.length;
      }
      for (let offset = index; offset < index + length; offset += 1) literal.add(offset);
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
    matchCloser(delimiters.length - 1);
  }
  // Never consume only part of an ambiguous delimiter run. Restore the entire
  // connected match, including enclosing pairs, rather than moving a literal star
  // into a different field when the source is subsequently sliced.
  const ambiguous = new Set(delimiters.flatMap((run, index) => run.remaining > 0 && run.remaining < run.length ? [index] : []));
  let previousSize = -1;
  while (previousSize !== ambiguous.size) {
    previousSize = ambiguous.size;
    for (const pair of pairs) {
      if (ambiguous.has(pair.openRun) || ambiguous.has(pair.closeRun)) {
        ambiguous.add(pair.openRun);
        ambiguous.add(pair.closeRun);
      }
    }
  }
  const balanced = pairs.filter((pair) => {
    if (!ambiguous.has(pair.openRun)) return true;
    for (let offset = 0; offset < pair.width; offset += 1) {
      removed.delete(pair.openStart + offset);
      removed.delete(pair.closeStart + offset);
    }
    if (pair.width === 2) {
      boldChanges[pair.openStart + pair.width] -= 1;
      boldChanges[pair.closeStart] += 1;
    }
    return false;
  });
  const unsafeToSplit = ambiguous.size > 0 || delimiters.some((run) => run.open && run.remaining > 0);
  return { removed, boldChanges, pairs: balanced, literal, unsafeToSplit };
}

export function parseInlineMarkdown(text: string): InlineTextRun[] {
  const { removed, boldChanges } = analyzeInlineMarkdown(text);
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

// Cut at source offsets, balancing only pairs that actually intersect the slice.
// Unmatched punctuation stays byte-for-byte literal. Values are parsed only once,
// at display time, so code content cannot become markup on a second pass.
export function sliceInlineMarkdown(text: string, start: number, end = text.length): string {
  const { pairs } = analyzeInlineMarkdown(text);
  const omitted = new Set<number>();
  const opening: InlinePair[] = [];
  const closing: InlinePair[] = [];
  for (const pair of pairs) {
    const contentStart = pair.openStart + pair.width;
    const intersects = contentStart < end && pair.closeStart > start;
    if (!intersects) {
      for (let offset = 0; offset < pair.width; offset += 1) {
        omitted.add(pair.openStart + offset);
        omitted.add(pair.closeStart + offset);
      }
      continue;
    }
    if (pair.openStart < start) opening.push(pair);
    if (pair.closeStart + pair.width > end) closing.push(pair);
  }
  const prefix = opening.sort((a, b) => a.openStart - b.openStart).map((pair) => text.slice(pair.openStart, pair.openStart + pair.width)).join("");
  const suffix = closing.sort((a, b) => a.closeStart - b.closeStart).map((pair) => text.slice(pair.closeStart, pair.closeStart + pair.width)).join("");
  return prefix + text.slice(start, end).split("").filter((_, offset) => !omitted.has(start + offset)).join("") + suffix;
}

export function splitInlineMarkdownPipes(text: string): string[] {
  const { literal, unsafeToSplit } = analyzeInlineMarkdown(text);
  // A structural interpretation is unsafe when emphasis is unfinished/ambiguous.
  if (unsafeToSplit) return [text];
  const boundaries = [...text.matchAll(/\|/g)].map((match) => match.index!).filter((index) => !literal.has(index));
  if (!boundaries.length) return [text];
  let start = 0;
  return [...boundaries, text.length].map((end) => {
    let from = start, to = end;
    while (from < to && /\s/.test(text[from])) from += 1;
    while (to > from && /\s/.test(text[to - 1])) to -= 1;
    const part = sliceInlineMarkdown(text, from, to);
    start = end + 1;
    return part;
  });
}

// Legacy flattened-input repair may edit only plain text, never code, addresses,
// or a matched emphasis span. Placeholders are private and collision-free.
export function mapInlineMarkdownPlainText(text: string, transform: (text: string) => string): string {
  const { pairs, literal } = analyzeInlineMarkdown(text);
  const protectedPositions = new Set(literal);
  for (const pair of pairs) {
    for (let index = pair.openStart; index < pair.closeStart + pair.width; index += 1) protectedPositions.add(index);
  }
  let sentinel = "\u0000";
  while (text.includes(sentinel)) sentinel += "\u0000";
  const spans: string[] = [];
  let masked = "";
  for (let index = 0; index < text.length;) {
    if (!protectedPositions.has(index)) { masked += text[index++]; continue; }
    const start = index;
    while (index < text.length && protectedPositions.has(index)) index += 1;
    masked += `${sentinel}${spans.length}${sentinel}`;
    spans.push(text.slice(start, index));
  }
  let result = transform(masked);
  for (let index = 0; index < spans.length; index += 1) result = result.replace(`${sentinel}${index}${sentinel}`, () => spans[index]);
  return result;
}
