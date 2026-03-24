import path from "node:path";

import type { HistoryEntry } from "../contracts.js";
import { historyForPath, readFileAtCommit } from "../git.js";
import { auditLog } from "../logger.js";

export async function getMemoryHistory(memoryRoot: string, targetPath: string, commit?: string): Promise<HistoryEntry[]> {
  const absolutePath = path.resolve(memoryRoot, targetPath);
  auditLog("memory.history", {
    path: absolutePath,
    commit: commit ?? null,
  });
  const history = await historyForPath(memoryRoot, absolutePath);

  const results: HistoryEntry[] = [];
  for (const entry of history) {
    const includePreviousState = commit === undefined || commit === entry.commit;
    results.push({
      commit: entry.commit,
      message: entry.message,
      timestamp: entry.timestamp,
      path: targetPath,
      previous_state: includePreviousState ? await readFileAtCommit(memoryRoot, absolutePath, entry.commit).catch(() => undefined) : undefined,
    });
  }

  return commit ? results.filter((entry) => entry.commit === commit) : results;
}
