export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isHttpUrl(url)) {
    return false;
  }

  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_external_url", { url });
      return true;
    } catch (error) {
      console.warn("Unable to open external URL through desktop shell", error);
      return false;
    }
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
