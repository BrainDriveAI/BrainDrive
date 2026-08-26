import { afterEach, describe, expect, it, vi } from "vitest";

import { secureRandomUuid } from "./browser-crypto";

describe("secureRandomUuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates an RFC 4122 version-4 UUID without crypto.randomUUID", () => {
    const getRandomValues = vi.fn((target: Uint8Array) => {
      target.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return target;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const value = secureRandomUuid();

    expect(value).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f");
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(getRandomValues).toHaveBeenCalledOnce();
  });

  it("fails closed when cryptographic randomness is unavailable", () => {
    vi.stubGlobal("crypto", {});
    expect(() => secureRandomUuid()).toThrow("secure_random_unavailable");
  });
});
