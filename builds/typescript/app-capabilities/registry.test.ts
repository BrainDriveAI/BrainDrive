import { describe, expect, it } from "vitest";

import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import {
  APP_CAPABILITY_REGISTRY,
  assertCapabilityScope,
  resolveAppCapability,
} from "./registry.js";

describe("named capability registry", () => {
  it("freezes the exact capability/version/audience matrix after M5 enables protected inference", () => {
    expect(APP_CAPABILITY_REGISTRY.map(({ name, version, audience, effect }) => ({ name, version, audience, effect }))).toEqual([
      { name: "career.context.read", version: 1, audience: "app_data", effect: "read" },
      { name: "career.facts.read", version: 1, audience: "app_data", effect: "read" },
      { name: "career.facts.propose", version: 1, audience: "app_data", effect: "mutation" },
      { name: "career.facts.confirm", version: 1, audience: "app_data", effect: "mutation" },
      { name: "resume.definitions.read", version: 1, audience: "app_data", effect: "read" },
      { name: "resume.definitions.write", version: 1, audience: "app_data", effect: "mutation" },
      { name: "resume.jobs.read", version: 1, audience: "app_data", effect: "read" },
      { name: "resume.jobs.write", version: 1, audience: "app_data", effect: "mutation" },
      { name: "resume.artifacts.register", version: 1, audience: "app_data", effect: "mutation" },
      { name: "resume.export.request", version: 1, audience: "app_export", effect: "export" },
      { name: "resume.operations.read", version: 1, audience: "app_data", effect: "read" },
      { name: "app.inference.request", version: 1, audience: "app_inference", effect: "inference" },
    ]);
    expect(resolveAppCapability("app.inference.request", 1)).toMatchObject({ audience: "app_inference", effect: "inference" });
    expect(() => resolveAppCapability("career.context.read", 2)).toThrowError(expect.objectContaining({ code: "incompatible_schema" }));
  });

  it("accepts only monotonic record-scope narrowing", () => {
    const installed = Array.from({ length: 8 }, () => crypto.randomUUID());
    for (let mask = 0; mask < 2 ** installed.length; mask += 1) {
      const requested = installed.filter((_scope, index) => (mask & (1 << index)) !== 0);
      expect(() => assertCapabilityScope(installed, requested)).not.toThrow();
    }
    expect(() => assertCapabilityScope(installed, [...installed, crypto.randomUUID()])).toThrowError(
      expect.objectContaining<Partial<AppPlatformError>>({ code: "denied" }),
    );
  });
});
