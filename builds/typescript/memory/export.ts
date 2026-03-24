import path from "node:path";

import type { ExportResult } from "../contracts.js";
import { exportMemoryArchive } from "../git.js";
import { auditLog } from "../logger.js";

export async function exportMemory(memoryRoot: string): Promise<ExportResult> {
  const fileName = `memory-export-${Date.now()}.tar.gz`;
  const destination = path.join(memoryRoot, "exports", fileName);
  await exportMemoryArchive(memoryRoot, destination);
  auditLog("memory.export", { archive_path: destination });
  return { archive_path: destination };
}
