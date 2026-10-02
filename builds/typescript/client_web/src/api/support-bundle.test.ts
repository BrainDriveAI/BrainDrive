import { downloadSupportBundle } from "./support-bundle";

const authenticatedFetchMock = vi.fn();

vi.mock("./auth-adapter", () => ({
  authenticatedFetch: (...args: unknown[]) => authenticatedFetchMock(...args),
}));

describe("downloadSupportBundle", () => {
  beforeEach(() => authenticatedFetchMock.mockReset());

  it("creates and downloads the bounded support archive", async () => {
    authenticatedFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        file_name: "support-bundle-123.tar.gz",
        download_path: "/support/bundles/support-bundle-123.tar.gz",
      }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("redacted archive", {
        status: 200,
        headers: { "content-type": "application/gzip" },
      }));

    const result = await downloadSupportBundle();

    expect(result.fileName).toBe("support-bundle-123.tar.gz");
    expect(await result.blob.text()).toBe("redacted archive");
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(1, "/api/support/bundles", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ window_hours: 24 }),
    }));
    expect(authenticatedFetchMock).toHaveBeenNthCalledWith(2, "/api/support/bundles/support-bundle-123.tar.gz");
  });

  it("fails closed when the gateway does not return a valid archive", async () => {
    authenticatedFetchMock.mockResolvedValue(new Response("no", { status: 503 }));

    await expect(downloadSupportBundle()).rejects.toThrow("Support bundle could not be created.");
  });
});
