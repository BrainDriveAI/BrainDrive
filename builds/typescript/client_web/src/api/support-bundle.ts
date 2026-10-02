import { authenticatedFetch } from "./auth-adapter";

type SupportBundleCreateResponse = {
  file_name?: unknown;
  download_path?: unknown;
};

export type SupportBundleDownload = {
  fileName: string;
  blob: Blob;
};

export async function downloadSupportBundle(): Promise<SupportBundleDownload> {
  const created = await authenticatedFetch("/api/support/bundles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ window_hours: 24 }),
  });
  if (!created.ok) {
    throw new Error("Support bundle could not be created.");
  }

  const payload = (await created.json()) as SupportBundleCreateResponse;
  if (typeof payload.file_name !== "string" || typeof payload.download_path !== "string") {
    throw new Error("Support bundle could not be created.");
  }

  const downloaded = await authenticatedFetch(`/api${payload.download_path}`);
  if (!downloaded.ok) {
    throw new Error("Support bundle could not be downloaded.");
  }

  return { fileName: payload.file_name, blob: await downloaded.blob() };
}
