export type LineDiffSummary = {
  added_lines: number;
  removed_lines: number;
  changed: boolean;
};

export type MergeTextResult = {
  content: string;
  inserted_lines: number;
  changed: boolean;
};

type SourceAnchor = {
  source_index: number;
  merged_index: number;
};

export function summarizeLineDiff(sourceContent: string, targetContent: string): LineDiffSummary {
  const sourceLines = toLines(sourceContent);
  const targetLines = toLines(targetContent);

  const sourceCounts = countLines(sourceLines);
  const targetCounts = countLines(targetLines);

  let added = 0;
  let removed = 0;

  for (const [line, sourceCount] of sourceCounts.entries()) {
    const targetCount = targetCounts.get(line) ?? 0;
    if (sourceCount > targetCount) {
      added += sourceCount - targetCount;
    }
  }

  for (const [line, targetCount] of targetCounts.entries()) {
    const sourceCount = sourceCounts.get(line) ?? 0;
    if (targetCount > sourceCount) {
      removed += targetCount - sourceCount;
    }
  }

  return {
    added_lines: added,
    removed_lines: removed,
    changed: added > 0 || removed > 0,
  };
}

// Merge strategy: preserve owner content and insert missing starter-pack lines
// at stable anchor positions when possible.
export function mergeTextWithLineInsertions(sourceContent: string, targetContent: string): MergeTextResult {
  if (sourceContent === targetContent) {
    return {
      content: targetContent,
      inserted_lines: 0,
      changed: false,
    };
  }

  const sourceLines = toLines(sourceContent);
  const mergedLines = toLines(targetContent);
  const anchors: SourceAnchor[] = [];
  let insertedLines = 0;

  for (let sourceIndex = 0; sourceIndex < sourceLines.length; sourceIndex += 1) {
    const sourceLine = sourceLines[sourceIndex] ?? "";
    const previousAnchor = anchors[anchors.length - 1] ?? null;
    const searchStart = previousAnchor ? previousAnchor.merged_index + 1 : 0;

    const existingIndex = findLineIndex(mergedLines, sourceLine, searchStart);
    if (existingIndex >= 0) {
      anchors.push({
        source_index: sourceIndex,
        merged_index: existingIndex,
      });
      continue;
    }

    const insertionPoint = resolveInsertionPoint(sourceLines, mergedLines, sourceIndex, anchors);
    mergedLines.splice(insertionPoint, 0, sourceLine);
    insertedLines += 1;

    for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
      const anchor = anchors[anchorIndex];
      if (!anchor) {
        continue;
      }
      if (anchor.merged_index >= insertionPoint) {
        anchors[anchorIndex] = {
          ...anchor,
          merged_index: anchor.merged_index + 1,
        };
      }
    }

    anchors.push({
      source_index: sourceIndex,
      merged_index: insertionPoint,
    });
  }

  const sourceHasTrailingNewline = sourceContent.endsWith("\n");
  const targetHasTrailingNewline = targetContent.endsWith("\n");
  const mergedContent = fromLines(mergedLines, sourceHasTrailingNewline || targetHasTrailingNewline);

  return {
    content: mergedContent,
    inserted_lines: insertedLines,
    changed: mergedContent !== targetContent,
  };
}

function resolveInsertionPoint(
  sourceLines: string[],
  mergedLines: string[],
  sourceIndex: number,
  anchors: SourceAnchor[]
): number {
  const previousAnchor = anchors[anchors.length - 1] ?? null;
  if (previousAnchor) {
    return previousAnchor.merged_index + 1;
  }

  const currentLine = sourceLines[sourceIndex] ?? "";
  for (let lookahead = sourceIndex + 1; lookahead < sourceLines.length; lookahead += 1) {
    const nextLine = sourceLines[lookahead] ?? "";
    if (nextLine === currentLine) {
      continue;
    }

    const nextIndex = findLineIndex(mergedLines, nextLine, 0);
    if (nextIndex >= 0) {
      return nextIndex;
    }
  }

  return 0;
}

function toLines(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function fromLines(lines: string[], trailingNewline: boolean): string {
  if (lines.length === 0) {
    return trailingNewline ? "\n" : "";
  }

  const joined = lines.join("\n");
  return trailingNewline ? `${joined}\n` : joined;
}

function countLines(lines: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const current = counts.get(line) ?? 0;
    counts.set(line, current + 1);
  }
  return counts;
}

function findLineIndex(lines: string[], needle: string, start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index] === needle) {
      return index;
    }
  }
  return -1;
}
