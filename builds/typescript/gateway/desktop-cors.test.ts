import { describe, expect, it } from "vitest";

import { buildDesktopCorsHeaders } from "./server.js";

describe("desktop gateway CORS", () => {
  it("allows the catalog trigger header used by the desktop Apps request", () => {
    const headers = buildDesktopCorsHeaders("http://tauri.localhost", "http://tauri.localhost", true);

    expect(headers["access-control-allow-headers"]?.split(",")).toContain("x-braindrive-catalog-trigger");
  });

  it("does not grant desktop CORS headers to an unconfigured origin", () => {
    expect(buildDesktopCorsHeaders("http://unexpected-origin", "http://tauri.localhost", true)).toEqual({});
  });
});
