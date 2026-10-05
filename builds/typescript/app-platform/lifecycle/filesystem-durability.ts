import { open } from "node:fs/promises";

/**
 * Flushes an atomic rename's directory entry where the host supports it.
 * Windows does not expose directory fsync through Node and reports one of
 * these unsupported-operation codes. File handles are still synced before
 * rename, and every other directory-sync failure remains fatal.
 */
export async function syncDirectoryEntry(directoryPath: string): Promise<void> {
  const directory = await open(directoryPath, "r");
  try {
    await directory.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && (code === "EPERM" || code === "EINVAL" || code === "ENOTSUP")) return;
    throw error;
  } finally {
    await directory.close();
  }
}
