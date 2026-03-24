import path from "node:path";

const reservedMemoryRoots = new Set([".git"]);

export function resolveMemoryPath(memoryRoot: string, requestedPath: string): string {
  const root = path.resolve(memoryRoot);
  const trimmedPath = requestedPath.trim();
  const resolved = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(root, trimmedPath.length > 0 ? trimmedPath : ".");
  const relative = path.relative(root, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path escapes memory root");
  }

  const normalizedRelative = relative.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/")[0] ?? "";
  if (reservedMemoryRoots.has(firstSegment)) {
    throw new Error("Path targets reserved memory internals");
  }

  return resolved;
}

export function toMemoryRelativePath(memoryRoot: string, absolutePath: string): string {
  return path.relative(memoryRoot, absolutePath).replace(/\\/g, "/");
}

export function isReservedMemoryPath(memoryRoot: string, absolutePath: string): boolean {
  const relativePath = toMemoryRelativePath(path.resolve(memoryRoot), path.resolve(absolutePath));
  const normalizedRelative = relativePath.replace(/\\/g, "/");
  const firstSegment = normalizedRelative.split("/")[0] ?? "";
  return reservedMemoryRoots.has(firstSegment);
}
