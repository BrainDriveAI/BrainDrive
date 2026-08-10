import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertContentFreeAudit, AuditEventSchema } from "../app-platform/contracts/audit.js";
import { OwnerSafeResumeDataStateSchema } from "../app-platform/contracts/data-conformance.js";
import { CapabilityGrantSchema, CapabilityNameSchema } from "../app-platform/contracts/package.js";
import { ensureGitReady } from "../git.js";
import { auditLog, configureAuditFileSink, disableAuditFileSink } from "../logger.js";
import { createSupportBundle } from "../memory/support-bundle.js";
import { ResumeExportBroker } from "../resume-renderer/export-broker.js";
import { RESUME_TEMPLATE_ID, RESUME_TEMPLATE_VERSION } from "../resume-renderer/renderer.js";
import { CareerPlacementAdapter } from "./career.js";
import {
  requireHostOwnerCapabilityAuthorization,
  ResumeCapabilityPolicy,
  type RestrictedCapabilityAuthority,
} from "./capability-policy.js";
import { ResumeCapabilityRouter } from "./capabilities.js";
import { ResumeDomainError } from "./errors.js";
import { ownerSafeCapabilityFailure } from "./owner-safe-state.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";

const execFileAsync = promisify(execFile);

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const now = "2026-08-08T12:00:00.000Z";
const capabilities = CapabilityNameSchema.options.filter((capability) => capability !== "app.inference.request");

function authorityFor(
  grant: ReturnType<typeof testGrant>,
  capability: (typeof capabilities)[number],
  operationId = crypto.randomUUID(),
  overrides: Partial<RestrictedCapabilityAuthority> = {},
): RestrictedCapabilityAuthority {
  return {
    authority_version: 1,
    context: {
      context_version: 1,
      owner_id: grant.owner_id,
      actor_id: grant.actor_id,
      app_id: grant.app_id,
      publisher_id: grant.publisher_id,
      package_digest: grant.package_digest,
      installation_id: grant.installation_id,
      grant_id: grant.grant_id,
      audience: "resume_data",
      granted_capabilities: [capability],
      record_scope_ids: grant.record_scopes,
      issued_at: "2026-08-08T11:55:00.000Z",
      expires_at: "2026-08-08T12:05:00.000Z",
    },
    grant_revision: grant.grant_revision,
    revocation_generation: grant.revocation_generation,
    token_audience: capability === "resume.export.request" ? "app_export" : "app_data",
    connection_id: crypto.randomUUID(),
    view_id: null,
    operation_id: operationId,
    ...overrides,
  };
}

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-m5-"));
  roots.push(root);
  await mkdir(path.join(root, "me"), { recursive: true });
  await mkdir(path.join(root, "documents", "career"), { recursive: true });
  await writeFile(path.join(root, "me", "profile.md"), "# Synthetic profile\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "spec.md"), "# Synthetic goals\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "plan.md"), "# Synthetic plan\n", "utf8");
  await ensureGitReady(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  let liveGrant = testGrant();
  await store.initialize(liveGrant.owner_id);
  const policy = new ResumeCapabilityPolicy(async () => liveGrant, () => new Date(now));
  const events: Array<{ event: string; details: Record<string, unknown> }> = [];
  const service = new ResumeDomainService(store, () => new Date(now));
  const router = new ResumeCapabilityRouter(
    service,
    new CareerPlacementAdapter(root),
    policy,
    (event, details) => events.push({ event, details }),
    new ResumeExportBroker(service, () => undefined, () => new Date(now)),
  );
  const context = (capability: (typeof capabilities)[number], operationId = crypto.randomUUID()) => ({
    authority: authorityFor(liveGrant, capability, operationId),
    operationId,
    correlationId: crypto.randomUUID(),
    idempotencyKey: `capability-${operationId}`,
  });
  return { root, store, router, events, context, grant: () => liveGrant, setGrant: (grant: ReturnType<typeof testGrant>) => { liveGrant = grant; } };
}

describe("M5 scoped Resume Builder capability policy", () => {
  it("authorizes every named operation only through an exact live installation grant", async () => {
    const grant = testGrant();
    const policy = new ResumeCapabilityPolicy(async () => grant, () => new Date(now));
    for (const capability of capabilities) {
      const operationId = crypto.randomUUID();
      await expect(policy.authorize(capability, authorityFor(grant, capability, operationId), operationId)).resolves.toMatchObject({
        grant_id: grant.grant_id,
        installation_id: grant.installation_id,
      });
      const substituted = capabilities.find((candidate) => candidate !== capability)!;
      await expect(policy.authorize(capability, authorityFor(grant, substituted, operationId), operationId)).rejects.toMatchObject({
        code: "denied",
        statusCode: 403,
      });
    }
  });

  it("dispatches all eleven named data operations through their exact schemas", async () => {
    const harness = await setup();
    await expect(harness.router.execute("career.context.read", { entry_point: "direct" }, harness.context("career.context.read"))).resolves.toMatchObject({ context_version: 1 });

    const proposalOperation = crypto.randomUUID();
    const proposal = await harness.router.execute("career.facts.propose", proposalInput(), harness.context("career.facts.propose", proposalOperation)) as {
      fact: { metadata: { record_id: string; revision_id: string; revision: number } };
    };
    await expect(harness.router.execute("career.facts.read", { record_id: proposal.fact.metadata.record_id }, harness.context("career.facts.read"))).resolves.toMatchObject({ record_type: "career_fact" });

    const confirmContext = harness.context("career.facts.confirm");
    const confirmAuthority = authority("career.facts.confirm", confirmContext.operationId, {
      grant: harness.grant(),
      idempotencyKey: confirmContext.idempotencyKey,
    });
    const confirmed = await harness.router.execute("career.facts.confirm", {
      fact_record_id: proposal.fact.metadata.record_id,
      fact_revision_id: proposal.fact.metadata.revision_id,
      expected_revision: proposal.fact.metadata.revision,
      decision: "accept",
      edited_value: null,
      review_note: null,
    }, { ...confirmContext, ownerDecision: ownerDecision(confirmAuthority, proposal.fact.metadata.revision_id) }) as {
      fact: { metadata: { revision_id: string } };
    };

    const definition = await harness.router.execute(
      "resume.definitions.write",
      definitionInput(confirmed.fact.metadata.revision_id, {
        template_id: RESUME_TEMPLATE_ID,
        template_version: RESUME_TEMPLATE_VERSION,
      }),
      { ...harness.context("resume.definitions.write"), hostOwnerConfirmed: true },
    ) as { definition: { metadata: { record_id: string; revision_id: string }; template_id: string; template_version: string; approval_evidence: { validation_run_id: string } } };
    await expect(harness.router.execute("resume.definitions.read", { record_id: definition.definition.metadata.record_id }, harness.context("resume.definitions.read"))).resolves.toMatchObject({ record_type: "resume_definition" });

    const jobText = "Synthetic M5 scoped job";
    const job = await harness.router.execute("resume.jobs.write", {
      safe_label: "Synthetic role",
      description_text: jobText,
      content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`,
      captured_at: now,
      sensitivity: "standard",
    }, harness.context("resume.jobs.write")) as { job: { metadata: { record_id: string } } };
    await expect(harness.router.execute("resume.jobs.read", { record_id: job.job.metadata.record_id }, harness.context("resume.jobs.read"))).resolves.toMatchObject({ record_type: "job_description" });

    await expect(harness.router.execute("resume.artifacts.register", {
      definition_revision_id: definition.definition.metadata.revision_id,
      template_id: definition.definition.template_id,
      template_version: definition.definition.template_version,
      renderer_id: "synthetic.renderer",
      renderer_version: "1",
      font_manifest_digest: `sha256:${"b".repeat(64)}`,
      validation_run_id: definition.definition.approval_evidence.validation_run_id,
      findings: [],
      artifact_digest: `sha256:${"c".repeat(64)}`,
      format: "pdf",
      accepted: true,
    }, harness.context("resume.artifacts.register"))).resolves.toMatchObject({ artifact: { record_type: "artifact" } });
    await expect(harness.router.execute("resume.export.request", {
      action: "preview",
      definition_revision_id: definition.definition.metadata.revision_id,
    }, harness.context("resume.export.request"))).resolves.toMatchObject({ status: "ready", format: "pdf" });
    await expect(harness.router.execute("resume.operations.read", {
      queried_operation_id: proposalOperation,
    }, harness.context("resume.operations.read"))).resolves.toMatchObject({ record: { operation_id: proposalOperation } });
  });

  it("denies missing, expired, revoked, wrong-audience, forged identity, widened capability, and operation substitution", async () => {
    const grant = testGrant();
    let liveGrant: ReturnType<typeof testGrant> | null = grant;
    const policy = new ResumeCapabilityPolicy(async () => liveGrant, () => new Date(now));
    const capability = "career.facts.read" as const;
    const operationId = crypto.randomUUID();
    const base = authorityFor(grant, capability, operationId);
    const denied = async (candidate: RestrictedCapabilityAuthority, expectedOperationId = operationId) => {
      await expect(policy.authorize(capability, candidate, expectedOperationId)).rejects.toMatchObject({ code: "denied", statusCode: 403 });
    };

    await denied({ ...base, token_audience: "app_export" });
    await denied({ ...base, operation_id: crypto.randomUUID() });
    await expect(policy.authorize(capability, base, operationId, { connectionId: crypto.randomUUID() })).rejects.toMatchObject({ code: "denied" });
    await expect(policy.authorize(capability, base, operationId, { viewId: crypto.randomUUID() })).rejects.toMatchObject({ code: "denied" });
    await denied({ ...base, context: { ...base.context, actor_id: crypto.randomUUID() } });
    await denied({ ...base, context: { ...base.context, installation_id: crypto.randomUUID() } });
    await denied({ ...base, context: { ...base.context, package_digest: `sha256:${"f".repeat(64)}` } });
    await denied({ ...base, context: { ...base.context, granted_capabilities: [capability, "resume.jobs.read"] } });
    await denied({ ...base, context: { ...base.context, expires_at: "2026-08-08T11:59:59.000Z" } });
    liveGrant = CapabilityGrantSchema.parse({ ...grant, grant_revision: 2, revocation_generation: 1, revoked_at: "2026-08-08T11:59:00.000Z" });
    await denied(base);
    liveGrant = null;
    await denied(base);
  });

  it("leaves no side effect when the live installation grant is revoked", async () => {
    const harness = await setup();
    const revoked = CapabilityGrantSchema.parse({
      ...harness.grant(),
      grant_revision: 2,
      revocation_generation: 1,
      revoked_at: "2026-08-08T11:59:00.000Z",
    });
    harness.setGrant(revoked);
    const jobText = "This write must remain invisible";
    await expect(harness.router.execute("resume.jobs.write", {
      safe_label: "Denied role",
      description_text: jobText,
      content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`,
      captured_at: now,
      sensitivity: "standard",
    }, harness.context("resume.jobs.write"))).rejects.toMatchObject({ code: "denied" });
    await expect(harness.store.list("job_description")).resolves.toEqual([]);
  });

  it("keeps record types and existing/nonexistent out-of-scope probes indistinguishable", async () => {
    const harness = await setup();
    const proposalOperation = crypto.randomUUID();
    const proposed = await harness.router.execute("career.facts.propose", proposalInput(), harness.context("career.facts.propose", proposalOperation)) as {
      fact: { metadata: { record_id: string } };
    };
    const jobText = "Untrusted synthetic job text";
    const job = await harness.router.execute("resume.jobs.write", {
      safe_label: "Synthetic role",
      description_text: jobText,
      content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`,
      captured_at: now,
      sensitivity: "standard",
    }, harness.context("resume.jobs.write")) as { job: { metadata: { record_id: string } } };
    const definition = await harness.router.execute("resume.definitions.write", definitionInput(crypto.randomUUID(), {
      status: "proposed",
      statements: [{
        statement_id: crypto.randomUUID(),
        section_id: "summary",
        kind: "presentation",
        text: "Synthetic presentation-only draft",
        supporting_confirmed_fact_revision_ids: [],
      }],
      section_order: ["summary"],
    }), harness.context("resume.definitions.write")) as { definition: { metadata: { record_id: string } } };

    await expect(harness.router.execute("career.facts.read", { record_id: job.job.metadata.record_id }, harness.context("career.facts.read"))).rejects.toMatchObject({
      code: "not_found_within_scope",
      statusCode: 404,
    });

    const scopedGrant = testGrant({ record_scopes: [crypto.randomUUID()] });
    harness.setGrant(scopedGrant);
    const probes = [
      ["career.facts.read", proposed.fact.metadata.record_id],
      ["resume.definitions.read", definition.definition.metadata.record_id],
      ["resume.jobs.read", job.job.metadata.record_id],
    ] as const;
    for (const [capability, recordId] of probes) {
      const existing = harness.router.execute(capability, { record_id: recordId }, harness.context(capability));
      const absent = harness.router.execute(capability, { record_id: crypto.randomUUID() }, harness.context(capability));
      const [existingFailure, absentFailure] = await Promise.all([
        existing.catch((error) => error),
        absent.catch((error) => error),
      ]);
      const existingError = existingFailure as ResumeDomainError;
      const absentError = absentFailure as ResumeDomainError;
      expect({ code: existingError.code, statusCode: existingError.statusCode, message: existingError.message }).toEqual({
        code: absentError.code,
        statusCode: absentError.statusCode,
        message: absentError.message,
      });
    }
  });

  it("binds operation lookup to actor, installation, original capability, and record scope", async () => {
    const harness = await setup();
    const operationId = crypto.randomUUID();
    const proposed = await harness.router.execute("career.facts.propose", proposalInput(), harness.context("career.facts.propose", operationId)) as {
      fact: { metadata: { record_id: string } };
    };
    await expect(harness.router.execute("resume.operations.read", { queried_operation_id: operationId }, harness.context("resume.operations.read"))).resolves.toMatchObject({
      record: { operation_id: operationId, capability: "career.facts.propose" },
    });

    const original = harness.grant();
    const actorId = crypto.randomUUID();
    harness.setGrant(testGrant({
      actor_id: actorId,
      decision: { ...original.decision, decided_by_actor_id: actorId },
      capabilities: ["resume.operations.read", "career.facts.propose"],
    }));
    await expect(harness.router.execute("resume.operations.read", { queried_operation_id: operationId }, harness.context("resume.operations.read"))).rejects.toMatchObject({ code: "not_found_within_scope" });

    harness.setGrant(testGrant({ capabilities: ["resume.operations.read"] }));
    await expect(harness.router.execute("resume.operations.read", { queried_operation_id: operationId }, harness.context("resume.operations.read"))).rejects.toMatchObject({ code: "not_found_within_scope" });

    harness.setGrant(testGrant({ capabilities: ["resume.operations.read", "career.facts.propose"], record_scopes: [crypto.randomUUID()] }));
    await expect(harness.router.execute("resume.operations.read", { queried_operation_id: operationId }, harness.context("resume.operations.read"))).rejects.toMatchObject({ code: "not_found_within_scope" });
    expect(proposed.fact.metadata.record_id).toBeTruthy();
  });

  it("rejects app-supplied authority fields and emits a schema-valid content-free audit", async () => {
    const harness = await setup();
    const sentinel = "PRIVATE_M5_SENTINEL";
    await expect(harness.router.execute("career.facts.propose", { ...proposalInput(), grant_id: crypto.randomUUID() }, harness.context("career.facts.propose"))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(harness.router.execute("career.facts.propose", { oversized: "x".repeat(262_145) }, harness.context("career.facts.propose"))).rejects.toMatchObject({ code: "invalid_input", statusCode: 413 });
    await harness.router.execute("career.facts.propose", proposalInput(sentinel), harness.context("career.facts.propose"));
    const event = harness.events.at(-1)!;
    const fullEvent = { event_name: event.event, ...event.details };
    expect(() => assertContentFreeAudit(fullEvent)).not.toThrow();
    expect(AuditEventSchema.safeParse(fullEvent).success).toBe(true);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(harness.root);
    expect(serialized).not.toContain("permissions");
    expect(serialized).not.toContain("description_text");

    configureAuditFileSink(harness.root);
    try {
      auditLog(event.event, event.details);
    } finally {
      disableAuditFileSink();
    }
    const bundle = await createSupportBundle(harness.root, {
      windowHours: 24,
      appVersion: "m5-test",
      installMode: "local",
      installLocation: "local",
      authMode: "local",
      actorId: crypto.randomUUID(),
    });
    const extracted = path.join(harness.root, "support-bundle-extracted");
    await mkdir(extracted, { recursive: true });
    await execFileAsync("tar", ["-xzf", bundle.archive_path, "-C", extracted]);
    const auditFile = path.join(extracted, "memory", "diagnostics", "audit", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const bundledAudit = await readFile(auditFile, "utf8");
    expect(bundledAudit).toContain("app.capability.completed");
    expect(bundledAudit).not.toContain(sentinel);
    expect(bundledAudit).not.toContain(harness.root);
    expect(bundledAudit).not.toContain("permissions");
    expect(bundledAudit).not.toContain("description_text");
  });

  it("rejects serialized or structurally forged host-owner authorization", () => {
    expect(() => requireHostOwnerCapabilityAuthorization({ authenticatedActorId: () => "owner" })).toThrowError(/not active/);
  });

  it("maps stable errors to owner-safe conflict, cancellation, incompatibility, and recovery states", () => {
    const correlationId = crypto.randomUUID();
    const conflict = ownerSafeCapabilityFailure(
      new ResumeDomainError("conflict", "private stale detail", 409, { currentRevision: 3 }),
      correlationId,
    );
    expect(conflict.error).toMatchObject({ code: "conflict", correlation_id: correlationId, retryable: false });
    expect(conflict.owner_state).toMatchObject({
      state: "conflict",
      current_revision: 3,
      proposal_preserved: true,
      refresh_required: true,
    });
    expect(OwnerSafeResumeDataStateSchema.safeParse(conflict.owner_state).success).toBe(true);
    expect(JSON.stringify(conflict)).not.toContain("private stale detail");

    expect(ownerSafeCapabilityFailure(new ResumeDomainError("cancelled", "private", 409), correlationId).owner_state.state).toBe("cancelled");
    expect(ownerSafeCapabilityFailure(new ResumeDomainError("incompatible_schema", "private", 409), correlationId).owner_state.state).toBe("incompatible");
    expect(ownerSafeCapabilityFailure(new Error("private"), correlationId).owner_state.state).toBe("recoverable_failure");
  });
});
