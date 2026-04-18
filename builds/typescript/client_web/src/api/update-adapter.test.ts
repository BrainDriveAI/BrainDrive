import { GatewayError } from "./types";
import { getUpdateStatus } from "./update-adapter";

describe("update-adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and normalizes the update status payload", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          channel: "stable",
          current_version: "26.4.18",
          latest_stable_version: "26.4.19",
          update_available: true,
          last_checked_at: "2026-04-18T15:00:00.000Z",
          diagnostic: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getUpdateStatus()).resolves.toEqual({
      channel: "stable",
      current_version: "26.4.18",
      latest_stable_version: "26.4.19",
      update_available: true,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: null,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/updates/status",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Object),
      })
    );
  });

  it("throws GatewayError for non-2xx responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ detail: "upstream unavailable", code: "upstream_error" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        })
      )
    );

    await expect(getUpdateStatus()).rejects.toEqual(
      expect.objectContaining<Partial<GatewayError>>({
        name: "GatewayError",
        message: "upstream unavailable",
        status: 503,
        code: "upstream_error",
      })
    );
  });
});
