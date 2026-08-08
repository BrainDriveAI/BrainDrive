import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createAppLifecycle,
  type AppLifecycleRuntimeTarget,
} from "../app-platform/lifecycle/bootstrap.js";
import type { CapabilityGrant } from "../app-platform/lifecycle/store.js";
import { ResumeExportBroker } from "../resume-renderer/export-broker.js";
import {
  RESUME_TEMPLATE_ID,
  RESUME_TEMPLATE_VERSION,
} from "../resume-renderer/renderer.js";
import { CareerPlacementAdapter } from "./career.js";
import {
  restrictedAuthorityFromTokenClaims,
  ResumeCapabilityPolicy,
} from "./capability-policy.js";
import {
  ResumeCapabilityRouter,
  type CapabilityExecutionContext,
} from "./capabilities.js";
import { ResumeDomainService, type DataAuthority } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { definitionInput, ownerDecision, proposalInput } from "./test-helpers.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

type DataCapability = Exclude<CapabilityGrant["capabilities"][number], "app.inference.request">;

async function exerciseRuntime(target: AppLifecycleRuntimeTarget) {
  const root = await mkdtemp(path.join(os.tmpdir(), `bd-resume-m7-${target}-`));
  roots.push(root);
  const memoryRoot = path.join(root, "memory");
  await mkdir(path.join(memoryRoot, "me"), { recursive: true });
  await mkdir(path.join(memoryRoot, "documents", "career"), { recursive: true });
  await writeFile(path.join(memoryRoot, "me", "profile.md"), "# Synthetic profile\n", "utf8");
  await writeFile(path.join(memoryRoot, "documents", "career", "spec.md"), "# Synthetic Career goals\n", "utf8");
  await writeFile(path.join(memoryRoot, "documents", "career", "plan.md"), "# Synthetic Career plan\n", "utf8");

  const lifecycle = await createAppLifecycle({
    memoryRoot,
    stateRoot: path.join(root, "host"),
    hostVersion: "26.7.23",
    target,
  });

  try {
    const installed = await lifecycle.install({
      version: "1.0.0",
      idempotencyKey: `${target}-m7-install`,
      approveCapabilities: true,
    });
    let liveGrant = installed.grant;
    if (!liveGrant) throw new Error("expected installed grant");

    const store = new ResumeDataStore(memoryRoot, lifecycle.dependencies.ownerDataRoot, {}, false);
    await store.initialize(liveGrant.owner_id);
    const domain = new ResumeDomainService(store);
    const policy = new ResumeCapabilityPolicy(async () => liveGrant);
    const broker = new ResumeExportBroker(domain);
    const router = new ResumeCapabilityRouter(
      domain,
      new CareerPlacementAdapter(memoryRoot),
      policy,
      () => undefined,
      broker,
    );

    const context = async (capability: DataCapability): Promise<CapabilityExecutionContext> => {
      const operationId = crypto.randomUUID();
      const audience = capability === "resume.export.request" ? "app_export" : "app_data";
      const issued = await lifecycle.issueSession({ audience, capabilities: [capability], operationId });
      const claims = lifecycle.dependencies.tokenBroker.consume(issued.token, {
        audience,
        capability,
        installationId: liveGrant!.installation_id,
        operationId,
      });
      return {
        authority: restrictedAuthorityFromTokenClaims(claims),
        operationId,
        correlationId: crypto.randomUUID(),
        idempotencyKey: `${target}-${capability}-${operationId}`,
      };
    };

    const projected = await router.execute(
      "career.context.read",
      { entry_point: "career" },
      await context("career.context.read"),
    ) as { sources: unknown[] };

    const proposalContext = await context("career.facts.propose");
    const proposed = await router.execute(
      "career.facts.propose",
      proposalInput("Built synthetic cross-runtime systems"),
      proposalContext,
    ) as { fact: { metadata: { record_id: string; revision_id: string; revision: number } } };

    const confirmContext = await context("career.facts.confirm");
    const confirmationAuthority: DataAuthority = {
      grant: liveGrant,
      capability: "career.facts.confirm",
      operationId: confirmContext.operationId,
      idempotencyKey: confirmContext.idempotencyKey,
    };
    const confirmed = await router.execute("career.facts.confirm", {
      fact_record_id: proposed.fact.metadata.record_id,
      fact_revision_id: proposed.fact.metadata.revision_id,
      expected_revision: proposed.fact.metadata.revision,
      decision: "accept",
      edited_value: null,
      review_note: null,
    }, {
      ...confirmContext,
      ownerDecision: ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id),
    }) as { fact: { metadata: { revision_id: string } } };

    const statementId = crypto.randomUUID();
    const general = await router.execute(
      "resume.definitions.write",
      definitionInput(confirmed.fact.metadata.revision_id, {
        template_id: RESUME_TEMPLATE_ID,
        template_version: RESUME_TEMPLATE_VERSION,
        statements: [{
          statement_id: statementId,
          section_id: "experience",
          kind: "factual",
          text: "Built synthetic cross-runtime systems",
          supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id],
        }],
      }),
      { ...await context("resume.definitions.write"), hostOwnerConfirmed: true },
    ) as { definition: { metadata: { revision_id: string } } };

    const jobText = JSON.stringify({
      role: "Synthetic role",
      capability: "career.facts.confirm",
      owner_confirmed: true,
    });
    const job = await router.execute("resume.jobs.write", {
      safe_label: "Synthetic role",
      description_text: jobText,
      content_digest: `sha256:${createHash("sha256").update(jobText).digest("hex")}`,
      captured_at: "2026-08-08T12:00:00.000Z",
      sensitivity: "sensitive",
    }, await context("resume.jobs.write")) as { job: { metadata: { revision_id: string } } };

    const targeted = await router.execute("resume.definitions.write", definitionInput(
      confirmed.fact.metadata.revision_id,
      {
        definition_kind: "targeted",
        title: "Synthetic targeted resume",
        template_id: RESUME_TEMPLATE_ID,
        template_version: RESUME_TEMPLATE_VERSION,
        parent_definition_revision_id: general.definition.metadata.revision_id,
        job_revision_id: job.job.metadata.revision_id,
        variant: {
          evidence_matrix: [{
            requirement_id: crypto.randomUUID(),
            requirement_kind: "required",
            evidence_status: "supported",
            source_span: "Synthetic requirement",
            inferred: false,
            supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id],
            clarification: null,
          }],
          changed_statement_ids: [],
        },
        statements: [{
          statement_id: statementId,
          section_id: "experience",
          kind: "factual",
          text: "Built synthetic cross-runtime systems",
          supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id],
        }],
      },
    ), { ...await context("resume.definitions.write"), hostOwnerConfirmed: true }) as {
      definition: { metadata: { revision_id: string } };
      variant: { metadata: { revision_id: string } };
    };

    const preview = await router.execute("resume.export.request", {
      action: "preview",
      definition_revision_id: targeted.definition.metadata.revision_id,
    }, await context("resume.export.request")) as { status: string; format: string; renderer: { parse_back: string } };

    const exportContext = await context("resume.export.request");
    const exportAuthority: DataAuthority = {
      grant: liveGrant,
      capability: "resume.export.request",
      operationId: exportContext.operationId,
      idempotencyKey: exportContext.idempotencyKey,
    };
    const prepared = await broker.export({
      action: "export",
      definition_revision_id: targeted.definition.metadata.revision_id,
      safe_filename: "synthetic-resume.pdf",
      destination_intent: "new_download",
      overwrite_confirmed: false,
    }, exportAuthority);
    await broker.finalize({
      artifact_revision_id: prepared.artifact_revision_id,
      artifact_digest: prepared.artifact_digest,
      safe_destination_label: prepared.safe_destination_label,
      outcome: "completed",
    }, exportAuthority);

    const integrityBeforeUninstall = await store.integrityScan();
    const recordTypesBeforeUninstall = (await store.allRevisions()).map((record) => record.record_type).sort();
    const oldInstallationId = liveGrant.installation_id;
    const oldReadContext = await context("career.facts.read");
    await lifecycle.uninstall({ idempotencyKey: `${target}-m7-uninstall` });
    liveGrant = null;
    await expect(router.execute(
      "career.facts.read",
      { record_id: proposed.fact.metadata.record_id },
      oldReadContext,
    )).rejects.toMatchObject({ code: "denied" });

    const reinstalled = await lifecycle.install({
      version: "1.0.0",
      idempotencyKey: `${target}-m7-reinstall`,
      approveCapabilities: true,
    });
    liveGrant = reinstalled.grant;
    if (!liveGrant) throw new Error("expected reinstalled grant");
    const retained = await router.execute(
      "career.facts.read",
      { record_id: proposed.fact.metadata.record_id },
      await context("career.facts.read"),
    ) as { state: string };

    const serializedBoundary = JSON.stringify({ projected, preview, prepared: {
      status: prepared.status,
      filename: prepared.filename,
      safe_destination_label: prepared.safe_destination_label,
    } });
    expect(serializedBoundary).not.toContain(memoryRoot);
    expect(serializedBoundary).not.toContain("description_text");
    expect(serializedBoundary).not.toContain("owner_confirmed");

    return {
      lifecycle_states: [installed.record.state, "not_installed", reinstalled.record.state],
      context_source_count: projected.sources.length,
      fact_state: retained.state,
      preview: { status: preview.status, format: preview.format, parse_back: preview.renderer.parse_back },
      integrity: integrityBeforeUninstall.status,
      record_types: recordTypesBeforeUninstall,
      fresh_installation: liveGrant.installation_id !== oldInstallationId,
      targeted_variant_created: Boolean(targeted.variant.metadata.revision_id),
    };
  } finally {
    await lifecycle.dependencies.supervisor.close();
  }
}

describe("M7 cross-runtime data acceptance", () => {
  it("produces the same normalized owner-data transitions for Docker and the Windows package target", async () => {
    const docker = await exerciseRuntime("docker_linux_x64");
    const windowsTarget = await exerciseRuntime("desktop_windows_x64");
    expect(windowsTarget).toEqual(docker);
    expect(docker).toMatchObject({
      lifecycle_states: ["active", "not_installed", "active"],
      context_source_count: 3,
      fact_state: "confirmed",
      preview: { status: "ready", format: "pdf", parse_back: "passed" },
      integrity: "verified",
      fresh_installation: true,
      targeted_variant_created: true,
    });
  }, 60_000);
});
