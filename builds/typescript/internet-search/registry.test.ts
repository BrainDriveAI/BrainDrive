import { describe, expect, it } from "vitest";

import {
  INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
  InternetSearchCapabilityRegistry,
  createDefaultInternetSearchCapabilityRegistry,
  type InstalledInternetSearchCapabilityRegistration,
} from "./registry.js";

function registryWith(overrides: Partial<InstalledInternetSearchCapabilityRegistration> = {}) {
  const registration: InstalledInternetSearchCapabilityRegistration = {
    ...INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
    lifecycle_state: "available",
    health: { state: "healthy", checked_at: "2026-09-01T00:00:00.000Z" },
    safe_message: "Internet Search is available.",
    ...overrides,
  };
  return new InternetSearchCapabilityRegistry([registration]);
}

function assertNoProviderLeak(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/searxng|https?:|localhost|127\.|0\.0\.0\.0|\bport\b|credential|secret|vault|\/(?:home|tmp|etc|var|Users)\//i);
}

describe("Internet Search installed capability registry", () => {
  it("discovers healthy Search and Read as generic available operations", () => {
    const registry = registryWith();

    for (const operationId of ["web.search@1", "web.read@1"] as const) {
      const projection = registry.discover(operationId, { authorized: true });
      expect(projection).toMatchObject({
        operation_id: operationId,
        state: "available",
        callable: true,
        capability: { capability_id: "internet-search" },
        provider_profile: { profile_id: "local-owner-managed", management: "owner_managed_local", billing: "none" },
        grant: { required: true, authorized: true },
      });
      assertNoProviderLeak(projection);
    }
  });

  it("returns an explicit unavailable projection when the capability is missing", () => {
    const registry = new InternetSearchCapabilityRegistry([]);

    expect(registry.discover("web.search@1", { authorized: true })).toMatchObject({
      state: "unavailable",
      callable: false,
      capability: null,
      provider_profile: null,
      health: null,
      message: "Internet Search is not installed.",
    });
  });

  it("keeps disabled, unhealthy, and not-ready unavailable states distinct", () => {
    expect(registryWith({ enabled: false }).discover("web.search@1", { authorized: true })).toMatchObject({
      state: "disabled",
      callable: false,
      message: "Internet Search is disabled.",
    });

    expect(registryWith({
      health: { state: "unhealthy", checked_at: "2026-09-01T00:00:00.000Z" },
      safe_message: "Internet Search needs attention.",
    }).discover("web.search@1", { authorized: true })).toMatchObject({
      state: "unhealthy",
      callable: false,
      message: "Internet Search needs attention.",
    });

    expect(registryWith({
      lifecycle_state: "unavailable",
      health: { state: "unknown", checked_at: null },
      safe_message: "Internet Search is installed but not ready.",
    }).discover("web.read@1", { authorized: true })).toMatchObject({
      state: "unavailable",
      callable: false,
      message: "Internet Search is installed but not ready.",
    });
  });

  it("returns unauthorized before exposing whether a provider record exists", () => {
    const installed = registryWith().discover("web.search@1", { authorized: false });
    const missing = new InternetSearchCapabilityRegistry([]).discover("web.search@1", { authorized: false });

    expect(installed).toEqual(missing);
    expect(installed).toMatchObject({
      state: "unauthorized",
      callable: false,
      capability: null,
      provider_profile: null,
      health: null,
      grant: { required: true, authorized: false },
    });
    assertNoProviderLeak(installed);
  });

  it("rejects duplicate operation authority and unsafe provider projections", () => {
    expect(() => new InternetSearchCapabilityRegistry([
      INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
      INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
    ])).toThrowError(/duplicated/i);

    expect(() => new InternetSearchCapabilityRegistry([{
      ...INTERNET_SEARCH_LOCAL_V1_REGISTRATION,
      provider: {
        ...INTERNET_SEARCH_LOCAL_V1_REGISTRATION.provider,
        projection: {
          ...INTERNET_SEARCH_LOCAL_V1_REGISTRATION.provider.projection,
          display_name: "http://127.0.0.1:8080",
        },
      },
    }])).toThrowError(/unsafe|provider internals/i);
  });

  it("defaults to registered but unavailable until lifecycle work lands", () => {
    const projection = createDefaultInternetSearchCapabilityRegistry().discover("web.search@1", { authorized: true });

    expect(projection).toMatchObject({
      state: "unavailable",
      callable: false,
      capability: { capability_id: "internet-search" },
      provider_profile: { profile_id: "local-owner-managed" },
    });
    assertNoProviderLeak(projection);
  });
});
