import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ensureGitReady } from "../git.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { CareerPlacementAdapter } from "./career.js";
import { ResumeCapabilityPolicy, type ResumeDataCapability } from "./capability-policy.js";
import { ResumeCapabilityRouter } from "./capabilities.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, definitionInput, ownerDecision, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-capabilities-")); roots.push(root);
  await mkdir(path.join(root, "me"), { recursive: true });
  await mkdir(path.join(root, "documents", "career"), { recursive: true });
  await writeFile(path.join(root, "me", "profile.md"), "# Synthetic profile\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "spec.md"), "# Synthetic goals\n", "utf8");
  await writeFile(path.join(root, "documents", "career", "plan.md"), "# Synthetic plan\n", "utf8");
  await ensureGitReady(root);
  const store = new ResumeDataStore(root, undefined, {}, false);
  const grant = testGrant();
  await store.initialize(grant.owner_id);
  return { root, store, grant, router: new ResumeCapabilityRouter(new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z")), new CareerPlacementAdapter(root), new ResumeCapabilityPolicy(async () => grant)) };
}

function context(grant: ReturnType<typeof testGrant>, operationId = crypto.randomUUID(), capability: ResumeDataCapability = "career.context.read") {
  const issuedAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
  return {
    authority: {
      authority_version: 1 as const,
      context: {
        context_version: 1 as const,
        owner_id: grant.owner_id,
        actor_id: grant.actor_id,
        app_id: grant.app_id,
        publisher_id: grant.publisher_id,
        package_digest: grant.package_digest,
        installation_id: grant.installation_id,
        grant_id: grant.grant_id,
        audience: "resume_data" as const,
        granted_capabilities: [capability],
        record_scope_ids: grant.record_scopes,
        issued_at: issuedAt,
        expires_at: expiresAt,
      },
      grant_revision: grant.grant_revision,
      revocation_generation: grant.revocation_generation,
      token_audience: capability === "resume.export.request" ? "app_export" as const : "app_data" as const,
      connection_id: crypto.randomUUID(),
      view_id: null,
      operation_id: operationId,
    },
    operationId,
    correlationId: crypto.randomUUID(),
    idempotencyKey: `capability-${operationId}`,
  };
}

describe("named Resume Builder data capabilities", () => {
  it("routes explicit coverage transitions with content-free yield and friction diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-coverage-capability-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(
      new ResumeDomainService(store, () => new Date("2026-08-11T12:00:00.000Z")),
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => grant),
      (event, details) => events.push({ event, details }),
    );
    const privateSentinel = "PRIVATE_COVERAGE_RESPONSIBILITY_SENTINEL";
    const jobValue = JSON.stringify({ format: "resume_job_v1", title: "Coordinator", employer: "Synthetic Org", responsibilities: privateSentinel });
    const proposed = await router.domain.proposeFact({
      ...proposalInput(jobValue),
      fact: { ...proposalInput().fact, fact_kind: "employment", value: jobValue },
    }, authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await router.domain.confirmFact({
      fact_record_id: proposed.fact.metadata.record_id,
      fact_revision_id: proposed.fact.metadata.revision_id,
      expected_revision: 1,
      decision: "accept",
      edited_value: null,
      review_note: null,
    }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
    const initialized = await router.execute("resume.definitions.write", {
      kind: "job_evidence_coverage",
      coverage: { action: "initialize", job_fact_revision_id: confirmed.fact.metadata.revision_id },
    }, context(grant, undefined, "resume.definitions.write")) as { coverage: { metadata: { record_id: string; revision: number }; job_fact_revision_id: string } };
    const opportunityId = "51000000-0000-4000-8000-000000000071";
    const presented = await router.execute("resume.definitions.write", {
      kind: "job_evidence_coverage",
      coverage: {
        action: "opportunity_presented",
        coverage_record_id: initialized.coverage.metadata.record_id,
        expected_revision: initialized.coverage.metadata.revision,
        job_fact_revision_id: confirmed.fact.metadata.revision_id,
        opportunity: { opportunity_id: opportunityId, dimension: "accomplishments", opportunity_kind: "qualitative", value_category: "distinct_accomplishment", context_digest: canonicalInputDigest({ job: confirmed.fact.metadata.revision_id, dimension: "accomplishments" }) },
      },
    }, context(grant, undefined, "resume.definitions.write")) as { coverage: { metadata: { record_id: string; revision: number } } };
    const recorded = await router.execute("resume.definitions.write", {
      kind: "job_evidence_coverage",
      coverage: {
        action: "record",
        coverage_record_id: presented.coverage.metadata.record_id,
        expected_revision: presented.coverage.metadata.revision,
        job_fact_revision_id: confirmed.fact.metadata.revision_id,
        dimension: "accomplishments",
        state: "unknown",
        evidence_revision_ids: [],
        opportunity: { opportunity_id: opportunityId, dimension: "accomplishments", opportunity_kind: "qualitative", value_category: "distinct_accomplishment", context_digest: canonicalInputDigest({ job: confirmed.fact.metadata.revision_id, dimension: "accomplishments" }) },
      },
    }, context(grant, undefined, "resume.definitions.write")) as { coverage: { metadata: { record_id: string; revision: number } } };
    await router.execute("resume.definitions.write", {
      kind: "job_evidence_coverage",
      coverage: { action: "complete_for_now", coverage_record_id: recorded.coverage.metadata.record_id, expected_revision: recorded.coverage.metadata.revision, job_fact_revision_id: confirmed.fact.metadata.revision_id },
    }, context(grant, undefined, "resume.definitions.write"));

    expect(events.map(({ event }) => event)).toEqual([
      "app.resume_coverage.transitioned",
      "app.resume_opportunity.updated",
      "app.resume_coverage.transitioned",
      "app.resume_coverage.transitioned",
    ]);
    expect(events[0]).toMatchObject({ details: { target_category: "resume_coverage", job_revision_id: confirmed.fact.metadata.revision_id, item_count: 6, timing_class: "human" } });
    expect(events[1]).toMatchObject({ details: { opportunity_id: opportunityId, opportunity_state: "available", item_count: 1, timing_class: "automation" } });
    expect(events[2]).toMatchObject({ details: { coverage_state: "unknown", opportunity_state: "suppressed", timing_class: "human" } });
    expect(events[3]).toMatchObject({ details: { coverage_state: "deferred", item_count: 4, timing_class: "human" } });
    expect(JSON.stringify(events)).not.toContain(privateSentinel);
  });

  it("routes the revision transaction and keeps request content out of capability diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-revision-capability-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(
      new ResumeDomainService(store, () => new Date("2026-08-10T12:00:00.000Z")),
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => grant),
      (event, details) => events.push({ event, details }),
    );
    const proposed = await router.domain.proposeFact(proposalInput(), authority("career.facts.propose"));
    const confirmAuthority = authority("career.facts.confirm");
    const confirmed = await router.domain.confirmFact({ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, confirmAuthority, ownerDecision(confirmAuthority, proposed.fact.metadata.revision_id));
    const source = await router.domain.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id), authority("resume.definitions.write"), true);
    await expect(router.execute("resume.definitions.write", {
      kind: "revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "resume", target_id: null },
      request_text: "x".repeat(8_193),
    }, context(grant, undefined, "resume.definitions.write"))).rejects.toMatchObject({ code: "invalid_input" });
    const sentinel = "PRIVATE_REVISION_REQUEST_SENTINEL";
    const submitted = await router.execute("resume.definitions.write", {
      kind: "revision_request",
      source_definition_revision_id: source.definition.metadata.revision_id,
      target: { scope: "resume", target_id: null },
      request_text: `Shorten wording ${sentinel}`,
    }, context(grant, undefined, "resume.definitions.write")) as { request: { metadata: { record_id: string; revision_id: string; revision: number } } };
    const classified = await router.execute("resume.definitions.write", {
      kind: "revision_outcome",
      request_record_id: submitted.request.metadata.record_id,
      expected_revision: 1,
      classification: "presentation",
      state: "generating",
      clarification: null,
      resulting_definition_revision_id: null,
      owner_outcome: null,
    }, context(grant, undefined, "resume.definitions.write")) as { request: { metadata: { record_id: string; revision_id: string; revision: number } } };
    const statement = source.definition.record_type === "resume_definition" ? source.definition.statements[0]! : null;
    if (!statement) throw new Error("expected source statement");
    const result = await router.execute("resume.definitions.write", {
      kind: "revision_proposal",
      request_record_id: classified.request.metadata.record_id,
      expected_revision: classified.request.metadata.revision,
      draft: {
        source_definition_revision_id: source.definition.metadata.revision_id,
        revision_request_revision_id: classified.request.metadata.revision_id,
        title: source.definition.record_type === "resume_definition" ? source.definition.title : "Resume",
        statements: [{ ...statement, text: "Statement: Synthetic supported" }],
        changed_statement_ids: [statement.statement_id],
        section_order: ["experience"],
      },
    }, context(grant, undefined, "resume.definitions.write")) as { definition: { status: string }; request: { state: string } };
    expect(result).toMatchObject({ definition: { status: "proposed" }, request: { state: "proposed" } });
    expect(JSON.stringify(events)).not.toContain(sentinel);
    expect(JSON.stringify(events)).not.toContain("x".repeat(128));
    expect(events[0]).toMatchObject({ event: "app.resume_revision.submitted", details: { outcome: "failed", error_code: "invalid_input" } });
    expect(events).toHaveLength(4);
  });
  it("returns a bounded path-free context through the declared read capability", async () => {
    const { root, grant, router } = await setup();
    const result = await router.execute("career.context.read", { entry_point: "direct" }, context(grant, undefined, "career.context.read"));
    expect(JSON.stringify(result)).not.toContain(root);
    expect(result).toMatchObject({ context_version: 1, entry_point: "direct" });
  });

  it("rejects raw-path fields and app-forged confirmation deterministically", async () => {
    const { grant, router } = await setup();
    await expect(router.execute("career.facts.propose", { ...proposalInput(), raw_path: "/tmp/forbidden" }, context(grant, undefined, "career.facts.propose"))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(router.execute("career.facts.propose", { ...proposalInput(), provider_profile_id: "app-selected-provider", model_id: "app-selected-model" }, context(grant, undefined, "career.facts.propose"))).rejects.toMatchObject({ code: "invalid_input" });
    const proposed = await router.execute("career.facts.propose", proposalInput(), context(grant, undefined, "career.facts.propose")) as { fact: { metadata: { record_id: string; revision_id: string } } };
    await expect(router.execute("career.facts.confirm", { fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, context(grant, undefined, "career.facts.confirm"))).rejects.toMatchObject({ code: "denied" });
  });

  it("does not reveal whether an out-of-scope record exists", async () => {
    const { grant, router } = await setup();
    const proposed = await router.execute("career.facts.propose", proposalInput(), context(grant, undefined, "career.facts.propose")) as { fact: { metadata: { record_id: string } } };
    const scoped = testGrant({ record_scopes: [crypto.randomUUID()] });
    const scopedRouter = new ResumeCapabilityRouter(router.domain, router.career, new ResumeCapabilityPolicy(async () => scoped));
    await expect(scopedRouter.execute("career.facts.read", { record_id: proposed.fact.metadata.record_id }, context(scoped, undefined, "career.facts.read"))).rejects.toMatchObject({ code: "not_found_within_scope", statusCode: 404 });
  });

  it("keeps inference outside data routing and fails closed when the M6 export broker is absent", async () => {
    const { grant, router } = await setup();
    await expect(router.execute("app.inference.request", {}, context(testGrant({ capabilities: [...grant.capabilities, "app.inference.request"] })))).rejects.toMatchObject({ code: "denied" });
    await expect(router.execute("resume.export.request", { action: "preview", definition_revision_id: crypto.randomUUID() }, context(grant, undefined, "resume.export.request"))).rejects.toMatchObject({ code: "recoverable_internal_failure" });
  });

  it("routes read-only remembered impact through the bounded definition-read operation", async () => {
    const { grant, router } = await setup();
    const proposed = await router.domain.proposeFact(proposalInput("Original supported detail"), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await router.domain.confirmFact({
      fact_record_id: proposed.fact.metadata.record_id,
      fact_revision_id: proposed.fact.metadata.revision_id,
      expected_revision: 1,
      decision: "accept",
      edited_value: null,
      review_note: null,
    }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
    const statementId = "50000000-0000-4000-8000-000000000061";
    const source = await router.domain.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      statements: [{ statement_id: statementId, section_id: "experience", kind: "factual", text: confirmed.fact.value, supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id] }],
    }), authority("resume.definitions.write"), true);
    const correctionAuthority = authority("career.facts.confirm");
    const correction = await router.domain.confirmFact({
      fact_record_id: confirmed.fact.metadata.record_id,
      fact_revision_id: confirmed.fact.metadata.revision_id,
      expected_revision: confirmed.fact.metadata.revision,
      decision: "edit_and_accept",
      edited_value: "Corrected supported detail",
      review_note: null,
    }, correctionAuthority, ownerDecision(correctionAuthority, confirmed.fact.metadata.revision_id, "edit_and_accept"));
    await router.domain.writeDefinition(definitionInput(correction.fact.metadata.revision_id, {
      status: "proposed",
      statements: [{ statement_id: statementId, section_id: "experience", kind: "factual", text: correction.fact.value, supporting_confirmed_fact_revision_ids: [correction.fact.metadata.revision_id] }],
      parent_definition_revision_id: source.definition.metadata.revision_id,
      successor_context: {
        successor_version: 1,
        kind: "remembered_information",
        source_definition_revision_id: source.definition.metadata.revision_id,
        revision_request_revision_id: null,
        changed_fact_revision_ids: [correction.fact.metadata.revision_id],
        stale_tailored_variant_revision_ids: [],
        quality_report_digest: null,
      },
    }), authority("resume.definitions.write"), false);

    await expect(router.execute("resume.definitions.read", {
      kind: "impact_analysis",
      source_definition_revision_id: source.definition.metadata.revision_id,
      changed_fact_revision_ids: [correction.fact.metadata.revision_id],
    }, context(grant, undefined, "resume.definitions.read"))).resolves.toMatchObject({
      affected_statements: [{ statement_id: statementId, change: "corrected" }],
      stale_tailored_variants: [],
    });
  });

  it("authorizes before comparison lookup and routes an exact read-only comparison with content-free diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-compare-audit-")); roots.push(root);
    await mkdir(path.join(root, "documents", "career"), { recursive: true });
    await writeFile(path.join(root, "documents", "career", "spec.md"), "# Unchanged comparison spec\n", "utf8");
    await writeFile(path.join(root, "documents", "career", "plan.md"), "# Unchanged comparison plan\n", "utf8");
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(
      new ResumeDomainService(store, () => new Date("2026-08-10T12:00:00.000Z")),
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => grant),
      (event, details) => events.push({ event, details }),
    );
    const proposed = await router.domain.proposeFact(proposalInput("Comparison-safe supported statement"), authority("career.facts.propose"));
    const confirmationAuthority = authority("career.facts.confirm");
    const confirmed = await router.domain.confirmFact({
      fact_record_id: proposed.fact.metadata.record_id,
      fact_revision_id: proposed.fact.metadata.revision_id,
      expected_revision: 1,
      decision: "accept",
      edited_value: null,
      review_note: null,
    }, confirmationAuthority, ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id));
    const first = await router.domain.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      statements: [{
        statement_id: crypto.randomUUID(),
        section_id: "experience",
        kind: "factual",
        text: confirmed.fact.value,
        supporting_confirmed_fact_revision_ids: [confirmed.fact.metadata.revision_id],
      }],
    }), authority("resume.definitions.write"), true);
    const second = await router.domain.writeDefinition(definitionInput(confirmed.fact.metadata.revision_id, {
      status: "proposed",
      parent_definition_revision_id: first.definition.metadata.revision_id,
      statements: first.definition.record_type === "resume_definition" ? first.definition.statements : [],
    }), authority("resume.definitions.write"), false);
    const before = canonicalInputDigest(await store.allRevisions());
    const careerBefore = await Promise.all([
      readFile(path.join(root, "documents", "career", "spec.md"), "utf8"),
      readFile(path.join(root, "documents", "career", "plan.md"), "utf8"),
    ]);

    await expect(router.execute("resume.definitions.read", {
      kind: "compare_definitions",
      left_revision_id: first.definition.metadata.revision_id,
      right_revision_id: second.definition.metadata.revision_id,
    }, context(grant, undefined, "resume.definitions.read"))).resolves.toMatchObject({
      result: "available",
      relation: "related",
      observable_summary: ["No observable changes."],
    });
    await expect(router.execute("resume.definitions.read", { view: "workspace" }, context(grant, undefined, "resume.definitions.read"))).resolves.toMatchObject({
      definition_history: expect.arrayContaining([
        expect.objectContaining({ metadata: expect.objectContaining({ revision_id: first.definition.metadata.revision_id }) }),
        expect.objectContaining({ metadata: expect.objectContaining({ revision_id: second.definition.metadata.revision_id }) }),
      ]),
      job_history: [],
    });
    expect(canonicalInputDigest(await store.allRevisions())).toBe(before);
    await expect(Promise.all([
      readFile(path.join(root, "documents", "career", "spec.md"), "utf8"),
      readFile(path.join(root, "documents", "career", "plan.md"), "utf8"),
    ])).resolves.toEqual(careerBefore);
    expect(events.filter((event) => event.event === "app.resume_comparison.completed").at(-1)).toMatchObject({
      event: "app.resume_comparison.completed",
      details: expect.objectContaining({
        left_definition_revision_id: first.definition.metadata.revision_id,
        right_definition_revision_id: second.definition.metadata.revision_id,
        comparison_relation: "related",
        comparison_result: "available",
        added_count: 0,
        removed_count: 0,
        changed_count: 0,
        moved_count: 0,
        evidence_change_count: 0,
      }),
    });
    expect(JSON.stringify(events)).not.toContain("Comparison-safe supported statement");

    await expect(router.execute("resume.definitions.read", {
      kind: "compare_definitions",
      left_revision_id: "not-a-revision",
      right_revision_id: first.definition.metadata.revision_id,
    }, context(grant, undefined, "resume.definitions.read"))).rejects.toMatchObject({ code: "invalid_input", statusCode: 400 });

    const deniedGrant = testGrant({ capabilities: grant.capabilities.filter((capability) => capability !== "resume.definitions.read") });
    const deniedRouter = new ResumeCapabilityRouter(router.domain, router.career, new ResumeCapabilityPolicy(async () => deniedGrant));
    await expect(deniedRouter.execute("resume.definitions.read", {
      kind: "compare_definitions",
      left_revision_id: crypto.randomUUID(),
      right_revision_id: crypto.randomUUID(),
    }, context(deniedGrant, undefined, "resume.definitions.read"))).rejects.toMatchObject({ code: "denied", statusCode: 403 });
  });

  it("emits content-free capability diagnostics", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-audit-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(new ResumeDomainService(store), new CareerPlacementAdapter(root), new ResumeCapabilityPolicy(async () => grant), (event, details) => events.push({ event, details }));
    const sentinel = "PRIVATE_RESUME_SENTINEL";
    const capabilityContext = context(grant, undefined, "career.facts.propose");
    await router.execute("career.facts.propose", proposalInput(sentinel), { ...capabilityContext, idempotencyDecision: "created" });
    await router.execute("career.facts.propose", proposalInput(sentinel), { ...capabilityContext, idempotencyDecision: "created" });
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("content_digest");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: "app.capability.completed", details: { capability: "career.facts.propose", outcome: "committed", idempotency_decision: "created" } });
    expect(events[1]).toMatchObject({ event: "app.capability.completed", details: { capability: "career.facts.propose", outcome: "committed", idempotency_decision: "reused" } });
  });

  it("emits a content-free remembered-match diagnostic without persisting the owner description", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-remembered-audit-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(new ResumeDomainService(store), new CareerPlacementAdapter(root), new ResumeCapabilityPolicy(async () => grant), (event, details) => events.push({ event, details }));
    const sentinel = "PRIVATE_REMEMBERED_DESCRIPTION_SENTINEL";
    await router.execute("resume.definitions.read", {
      kind: "remembered_match",
      explicit_job_fact_revision_id: null,
      description: sentinel,
    }, context(grant, undefined, "resume.definitions.read"));

    expect(JSON.stringify(events)).not.toContain(sentinel);
    expect(events).toEqual([expect.objectContaining({
      event: "app.resume_remembered.match",
      details: expect.objectContaining({ match_method: "none", result_class: "none", fact_revision_id: null }),
    })]);
  });

  it("routes owner-visible interview turns into durable provenance without exposing their content in audit events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-turn-audit-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(new ResumeDomainService(store), new CareerPlacementAdapter(root), new ResumeCapabilityPolicy(async () => grant), (event, details) => events.push({ event, details }));
    const sentinel = "PRIVATE_INTERVIEW_ANSWER_SENTINEL";
    const turn = {
      transcript_version: 1,
      turn_id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      prompt_version: "resume-interview-3.2.2",
      topic: "education",
      question: "What education or training would you like to include?",
      answer: sentinel,
      follow_up: null,
      action: "answered",
      occurred_at: "2026-08-07T12:00:00.000Z",
    };
    const result = await router.execute("resume.definitions.write", {
      kind: "interview_turn",
      turn,
      sensitivity: "standard",
      linked_confirmed_fact_revision_id: null,
    }, context(grant, undefined, "resume.definitions.write")) as { turn: { extensions: { interview_turn: unknown } } };

    expect(result.turn.extensions.interview_turn).toEqual(turn);
    expect(JSON.stringify(events)).not.toContain(sentinel);
    expect(events.at(-1)).toMatchObject({ event: "app.capability.completed", details: { capability: "resume.definitions.write", outcome: "committed" } });
  });

  it("routes recovery save, restore, conflict, and discard with content-free state-change events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-recovery-audit-")); roots.push(root);
    const store = new ResumeDataStore(root, undefined, {}, false);
    const grant = testGrant();
    await store.initialize(grant.owner_id);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const router = new ResumeCapabilityRouter(
      new ResumeDomainService(store, () => new Date("2026-08-10T12:00:00.000Z")),
      new CareerPlacementAdapter(root),
      new ResumeCapabilityPolicy(async () => grant),
      (event, details) => events.push({ event, details }),
    );
    const sentinel = "PRIVATE_RECOVERY_SENTINEL résumé 東京 🚀";
    const sessionId = crypto.randomUUID();
    const save = {
      expected_revision: null,
      session_id: sessionId,
      current_topic: "contact",
      completed_topics: [],
      skipped_topics: [],
      slot: { session_id: sessionId, job_fact_revision_id: null, question_id: "contact-question", field_id: "answer" },
      value: sentinel,
      value_digest: canonicalInputDigest(sentinel),
    };
    const saved = await router.execute("resume.definitions.write", {
      kind: "interview_recovery_save",
      recovery: save,
    }, context(grant, undefined, "resume.definitions.write")) as { progress: { metadata: { record_id: string } } };

    const workspace = await router.execute("resume.definitions.read", { view: "workspace" }, context(grant, undefined, "resume.definitions.read")) as { interview: unknown[] };
    expect(workspace.interview).toHaveLength(1);

    await expect(router.execute("resume.definitions.write", {
      kind: "interview_recovery_save",
      recovery: { ...save, record_id: saved.progress.metadata.record_id, expected_revision: 99 },
    }, context(grant, undefined, "resume.definitions.write"))).rejects.toMatchObject({ code: "conflict" });

    await router.execute("resume.definitions.write", {
      kind: "interview_recovery_discard",
      progress: { record_id: saved.progress.metadata.record_id, expected_revision: 1 },
    }, context(grant, undefined, "resume.definitions.write"));

    expect(events.map(({ event }) => event)).toEqual([
      "app.resume_recovery.save",
      "app.resume_recovery.restore",
      "app.resume_recovery.conflict",
      "app.resume_recovery.discard",
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(sentinel);
    expect(serialized).not.toContain(root);
    expect(serialized).not.toContain("value_digest");
    expect(events[0]).toMatchObject({ details: { target_category: "resume_recovery", outcome: "committed" } });
    expect(events[2]).toMatchObject({ details: { target_category: "resume_recovery", outcome: "conflict", error_code: "conflict" } });
  });

  it("places only confirmed stable-fact references into a Career return", async () => {
    const { root, grant, router } = await setup();
    const proposed = await router.execute("career.facts.propose", proposalInput(), context(grant, undefined, "career.facts.propose")) as { fact: { metadata: { record_id: string; revision_id: string } } };
    const rejectedSummary = { summary_version: 1 as const, status: "review_needed" as const, outcome_summary: "Synthetic review", approved_reference: null, stable_fact_proposals: [{ fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, safe_summary: "Synthetic fact", proposed_placement: "owner_profile" as const }], next_career_action: null, updated_at: "2026-08-07T12:00:00.000Z" };
    await expect(router.placeCareerReturn(rejectedSummary, "career", crypto.randomUUID(), grant)).rejects.toMatchObject({ code: "validation_failed" });

    const confirmationContext = context(grant, undefined, "career.facts.confirm");
    const confirmationAuthority = authority("career.facts.confirm", confirmationContext.operationId, { grant, idempotencyKey: confirmationContext.idempotencyKey });
    const confirmed = await router.execute("career.facts.confirm", { fact_record_id: proposed.fact.metadata.record_id, fact_revision_id: proposed.fact.metadata.revision_id, expected_revision: 1, decision: "accept", edited_value: null, review_note: null }, { ...confirmationContext, ownerDecision: ownerDecision(confirmationAuthority, proposed.fact.metadata.revision_id) }) as { fact: { metadata: { record_id: string; revision_id: string } } };
    const acceptedSummary = { ...rejectedSummary, status: "completed" as const, stable_fact_proposals: [{ ...rejectedSummary.stable_fact_proposals[0]!, fact_revision_id: confirmed.fact.metadata.revision_id }] };
    await expect(router.placeCareerReturn(acceptedSummary, "career", crypto.randomUUID(), grant)).resolves.toMatchObject({ committed: true, reused: false });
    expect(await readFile(path.join(root, "documents", "career", "journal.md"), "utf8")).toContain("Synthetic fact");
  });
});
