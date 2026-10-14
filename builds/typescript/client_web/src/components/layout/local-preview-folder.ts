// Explicit opt-in for a verified local preview. No host path is inferred from gateway data.
export function localPreviewFolder(projectId: string): string | null {
  if (!import.meta.env.DEV || typeof window === "undefined") return null;
  const { hostname, origin } = window.location;
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]") return null;
  if (origin !== import.meta.env.VITE_LOCAL_PREVIEW_ORIGIN
    || projectId !== import.meta.env.VITE_LOCAL_PREVIEW_PROJECT_ID) return null;
  const folder = import.meta.env.VITE_LOCAL_PREVIEW_FOLDER_PATH;
  return typeof folder === "string" && folder.startsWith("/") ? folder : null;
}
