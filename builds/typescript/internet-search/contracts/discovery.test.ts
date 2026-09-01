import { describe, expect, it } from "vitest";

import {
  InternetSearchCapabilityDiscoverySchema,
  InternetSearchProviderProfileProjectionSchema,
} from "./discovery.js";

describe("Internet Search discovery contracts", () => {
  it("accepts a generic safe available projection", () => {
    const parsed = InternetSearchCapabilityDiscoverySchema.parse({
      discovery_version: 1,
      operation_id: "web.search@1",
      state: "available",
      callable: true,
      capability: {
        capability_id: "internet-search",
        version: "0.1.0",
        operations: [
          { operation_id: "web.search@1", capability: "web.search", version: 1 },
          { operation_id: "web.read@1", capability: "web.read", version: 1 },
        ],
      },
      provider_profile: {
        profile_id: "local-owner-managed",
        display_name: "Local Internet Search",
        management: "owner_managed_local",
        billing: "none",
        disclosure: {
          last_reviewed_at: "2026-09-01T00:00:00.000Z",
          summary: "Use is mediated by the local owner-managed Internet Search profile.",
        },
      },
      health: { state: "healthy", checked_at: "2026-09-01T00:00:00.000Z" },
      grant: { required: true, authorized: true },
      message: "Internet Search is available.",
    });

    expect(parsed.provider_profile?.profile_id).toBe("local-owner-managed");
  });

  it("rejects endpoint, credential, vault, and path-shaped provider leaks", () => {
    const validProfile = {
      profile_id: "local-owner-managed",
      display_name: "Local Internet Search",
      management: "owner_managed_local" as const,
      billing: "none" as const,
      disclosure: {
        last_reviewed_at: null,
        summary: "Local owner-managed discovery metadata.",
      },
    };

    expect(() => InternetSearchProviderProfileProjectionSchema.parse({
      ...validProfile,
      endpoint_url: "http://127.0.0.1:8080",
    })).toThrow();
    expect(() => InternetSearchProviderProfileProjectionSchema.parse({
      ...validProfile,
      disclosure: { last_reviewed_at: null, summary: "Use vault ref secret/search/key" },
    })).toThrow();
    expect(() => InternetSearchProviderProfileProjectionSchema.parse({
      ...validProfile,
      display_name: "/home/owner/search",
    })).toThrow();
  });

  it("keeps unauthorized projection non-enumerating", () => {
    const projection = InternetSearchCapabilityDiscoverySchema.parse({
      discovery_version: 1,
      operation_id: "web.read@1",
      state: "unauthorized",
      callable: false,
      capability: null,
      provider_profile: null,
      health: null,
      grant: { required: true, authorized: false },
      message: "Capability authorization is required.",
    });

    expect(JSON.stringify(projection)).not.toMatch(/searxng|https?:|localhost|127\.|\bport\b|credential|secret|vault|\/home\//i);
  });
});
