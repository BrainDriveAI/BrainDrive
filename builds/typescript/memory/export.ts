import type { ExportResult } from "../contracts.js";
import { exportMigrationArchive } from "./migration.js";

export async function exportMemory(memoryRoot: string): Promise<ExportResult> {
  const exported = await exportMigrationArchive(memoryRoot);
  return { archive_path: exported.archive_path };
}
