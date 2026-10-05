import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { AppPlatformError } from "../app-platform/lifecycle/errors.js";
import {
  CapabilityRegistry,
  assertCapabilityScope,
} from "./registry.js";
import { APP_CAPABILITY_REGISTRY, resolveAppCapability } from "./resume-registry.js";
import { CapabilityDispatcher } from "./dispatcher.js";

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
    expect(resolveAppCapability("app.inference.request", 1)).toMatchObject({
      inputSchemaId: "app.inference.request.input.v1",
      resultSchemaId: "app.inference.request.result.v1",
      confirmation: "none",
      auditProjectionId: "app.inference.request.audit.v1",
      retryPolicy: "idempotent_only",
      idempotencyPolicy: "required",
      ownerComponentId: "resume-inference",
      maxCallsPerMinute: 60,
    });
    expect(Object.isFrozen(resolveAppCapability("app.inference.request", 1))).toBe(true);
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

  it("keys reviewed handlers by app, name, and version and keeps confirmation host-authored", async () => {
    const resumeHandler = vi.fn(async (input: { record_id: string }) => ({ app: "resume" as const, record_id: input.record_id }));
    const briefHandler = vi.fn(async (input: { record_id: string }) => ({ app: "brief" as const, record_id: input.record_id }));
    const registrations = [
      {
        appId: "ai.braindrive.resume-builder", name: "records.read", version: 1,
        audience: "app_data" as const, effect: "read" as const,
        inputSchema: z.object({ record_id: z.string().uuid() }).strict(),
        resultSchema: z.object({ app: z.literal("resume"), record_id: z.string().uuid() }).strict(),
        limits: { maxInputBytes: 4096, maxDurationMs: 10_000, maxCallsPerMinute: 30 },
        confirmation: "none" as const, confirmationProjection: null,
        auditProjectionId: "resume.records.read.audit.v1", retryPolicy: "idempotent_only" as const,
        idempotencyPolicy: "optional" as const, ownerComponentId: "resume.domain", handler: resumeHandler,
      },
      {
        appId: "ai.braindrive.brief-builder", name: "records.read", version: 1,
        audience: "app_data" as const, effect: "read" as const,
        inputSchema: z.object({ record_id: z.string().uuid() }).strict(),
        resultSchema: z.object({ app: z.literal("brief"), record_id: z.string().uuid() }).strict(),
        limits: { maxInputBytes: 4096, maxDurationMs: 10_000, maxCallsPerMinute: 30 },
        confirmation: "none" as const, confirmationProjection: null,
        auditProjectionId: "brief.records.read.audit.v1", retryPolicy: "idempotent_only" as const,
        idempotencyPolicy: "optional" as const, ownerComponentId: "brief.domain", handler: briefHandler,
      },
    ];
    const confirmationHandler = vi.fn(async () => ({ status: "written" as const }));
    const confirmationRegistration = {
      ...registrations[1]!, name: "records.write", effect: "mutation" as const,
      inputSchema: z.object({ record_id: z.string().uuid(), confirmation_text: z.string().optional() }).strict(),
      resultSchema: z.object({ status: z.literal("written") }).strict(),
      confirmation: "owner_confirmation" as const,
      confirmationProjection: { title: "Approve brief update", actionLabel: "Approve update" },
      handler: confirmationHandler,
    };
    const registry = new CapabilityRegistry([...registrations, confirmationRegistration]);
    expect(registry.resolve("ai.braindrive.resume-builder", "records.read", 1).handler).toBe(resumeHandler);
    expect(registry.resolve("ai.braindrive.brief-builder", "records.read", 1).handler).toBe(briefHandler);
    expect(() => registry.resolve("ai.braindrive.brief-builder", "records.read", 2)).toThrowError(expect.objectContaining({ code: "incompatible_schema" }));
    expect(() => registry.resolve("ai.braindrive.unknown", "records.read", 1)).toThrowError(expect.objectContaining({ code: "denied" }));
    expect(() => new CapabilityRegistry([...registrations, registrations[0]!])).toThrowError(expect.objectContaining({ code: "duplicate_identity" }));
    expect(() => new CapabilityRegistry([{ ...registrations[0]!, handler: undefined } as never])).toThrowError(expect.objectContaining({ code: "descriptor_invalid" }));
    expect(Object.isFrozen(registry.resolve("ai.braindrive.resume-builder", "records.read", 1))).toBe(true);

    const audit = vi.fn();
    const dispatcher = new CapabilityDispatcher(registry, Date.now, audit);
    const recordId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const base = {
      appId: "ai.braindrive.resume-builder", installationId: crypto.randomUUID(), packageDigest: `sha256:${"a".repeat(64)}` as const,
      manifestRequests: [{ name: "records.read", version: 1 }], operationId: crypto.randomUUID(), idempotencyKey: "resume-records-read-0001", deadlineAt: Date.now() + 10_000,
    };
    await expect(dispatcher.execute("records.read", 1, { record_id: recordId }, {
      ...base,
      grant: { app_id: base.appId, installation_id: base.installationId, package_digest: base.packageDigest, capabilities: ["records.read"], revoked_at: null, expires_at: expiresAt },
    })).resolves.toEqual({ app: "resume", record_id: recordId });
    await expect(dispatcher.execute("records.read", 1, { record_id: recordId }, {
      ...base, appId: "ai.braindrive.brief-builder", idempotencyKey: "brief-records-read-0001",
      grant: { app_id: base.appId, installation_id: base.installationId, package_digest: base.packageDigest, capabilities: ["records.read"], revoked_at: null, expires_at: expiresAt },
    })).rejects.toMatchObject({ code: "denied" });
    await expect(dispatcher.execute("records.write", 1, { record_id: recordId, confirmation_text: "Use app wording" }, {
      ...base, appId: "ai.braindrive.brief-builder", idempotencyKey: "brief-records-write-0001",
      manifestRequests: [{ name: "records.write", version: 1 }],
      grant: { app_id: "ai.braindrive.brief-builder", installation_id: base.installationId, package_digest: base.packageDigest, capabilities: ["records.write"], revoked_at: null, expires_at: expiresAt },
    })).rejects.toMatchObject({
      code: "denied",
      details: { confirmation: { title: "Approve brief update", actionLabel: "Approve update" } },
    });
    expect(confirmationHandler).not.toHaveBeenCalled();
    expect(resumeHandler).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(new RegExp(`${recordId}|Use app wording`));
  });
});
