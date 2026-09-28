import { canonicalInputDigest } from "../app-platform/contracts/common.js";

/** Credential-free, synthetic-only acceptance data. Runtime composition must never import this module. */

const DIMENSIONS = ["responsibilities", "accomplishments", "outcomes", "tools", "scope", "progression"] as const;
type EvidenceDimension = typeof DIMENSIONS[number];
type CoverageOutcome = "answered" | "deferred";
type FactKind = "contact" | "employment" | "project" | "education" | "credential" | "preference" | "job_evidence";

export type Spec10SyntheticFact = {
  revision_id: string;
  fact_kind: FactKind;
  value: string;
  job_fact_revision_id: string | null;
  dimension: EvidenceDimension | null;
};

export type Spec10SyntheticCoverage = {
  revision_id: string;
  job_fact_revision_id: string;
  dimensions: Record<EvidenceDimension, { outcome: CoverageOutcome; evidence_revision_ids: string[] }>;
};

export type Spec10SyntheticFixture = {
  fixture_id: string;
  jobs: Array<{ fact_revision_id: string; role_family: string; chronology: number }>;
  facts: Spec10SyntheticFact[];
  coverage: Spec10SyntheticCoverage[];
  strategy: {
    revision_id: string;
    fact_revision_ids: string[];
    coverage_revision_ids: string[];
    fact_snapshot_digest: `sha256:${string}`;
    coverage_snapshot_digest: `sha256:${string}`;
    section_order: string[];
    summary_decision: "include";
  } | null;
};

function revisionId(namespace: "81" | "82" | "89", index: number): string {
  return `${namespace}000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function coreFact(revision_id: string, fact_kind: Exclude<FactKind, "job_evidence">, value: string): Spec10SyntheticFact {
  return { revision_id, fact_kind, value, job_fact_revision_id: null, dimension: null };
}

type FixtureSeed = {
  namespace: "81" | "82";
  fixtureId: string;
  contacts: [string, string];
  jobs: Array<{ roleFamily: string; title: string; employer: string }>;
  projects: [string, string];
  education: string;
  credential: string;
  preference: string;
};

function buildFixture(seed: FixtureSeed): Spec10SyntheticFixture {
  const jobIds = [revisionId(seed.namespace, 3), revisionId(seed.namespace, 4), revisionId(seed.namespace, 5)];
  const facts: Spec10SyntheticFact[] = [
    coreFact(revisionId(seed.namespace, 1), "contact", seed.contacts[0]),
    coreFact(revisionId(seed.namespace, 2), "contact", seed.contacts[1]),
    ...seed.jobs.map((job, index) => coreFact(
      jobIds[index]!,
      "employment",
      JSON.stringify({ format: "resume_job_v1", title: job.title, employer: job.employer, chronology: 3 - index }),
    )),
    coreFact(revisionId(seed.namespace, 6), "project", seed.projects[0]),
    coreFact(revisionId(seed.namespace, 7), "project", seed.projects[1]),
    coreFact(revisionId(seed.namespace, 8), "education", seed.education),
    coreFact(revisionId(seed.namespace, 9), "credential", seed.credential),
    coreFact(revisionId(seed.namespace, 10), "preference", seed.preference),
  ];

  const coverage: Spec10SyntheticCoverage[] = [];
  let evidenceIndex = 11;
  for (let jobIndex = 0; jobIndex < jobIds.length; jobIndex += 1) {
    const jobId = jobIds[jobIndex]!;
    const dimensions = {} as Spec10SyntheticCoverage["dimensions"];
    for (let dimensionIndex = 0; dimensionIndex < DIMENSIONS.length; dimensionIndex += 1) {
      const dimension = DIMENSIONS[dimensionIndex]!;
      const deferred = jobIndex === 2 && dimensionIndex >= 3;
      const evidenceIds: string[] = [];
      if (!deferred) {
        const evidencePerDimension = (jobIndex === 0 && dimensionIndex === 0) || (jobIndex === 2 && dimensionIndex < 3) ? 2 : 1;
        for (let unit = 0; unit < evidencePerDimension; unit += 1) {
          const evidenceId = revisionId(seed.namespace, evidenceIndex);
          evidenceIndex += 1;
          evidenceIds.push(evidenceId);
          facts.push({
            revision_id: evidenceId,
            fact_kind: "job_evidence",
            value: `${seed.fixtureId} synthetic ${dimension} evidence ${jobIndex + 1}.${unit + 1}`,
            job_fact_revision_id: jobId,
            dimension,
          });
        }
      }
      dimensions[dimension] = { outcome: deferred ? "deferred" : "answered", evidence_revision_ids: evidenceIds };
    }
    coverage.push({ revision_id: revisionId(seed.namespace, 101 + jobIndex), job_fact_revision_id: jobId, dimensions });
  }
  if (facts.length !== 29 || evidenceIndex !== 30) throw new Error("Spec 10 fixture fact distribution drifted");

  const sortedFacts = canonicalFacts(facts);
  const sortedCoverage = canonicalCoverage(coverage);
  return {
    fixture_id: seed.fixtureId,
    jobs: seed.jobs.map((job, index) => ({ fact_revision_id: jobIds[index]!, role_family: job.roleFamily, chronology: 3 - index })),
    facts,
    coverage,
    strategy: {
      revision_id: revisionId(seed.namespace, 200),
      fact_revision_ids: facts.map((fact) => fact.revision_id),
      coverage_revision_ids: coverage.map((item) => item.revision_id),
      fact_snapshot_digest: canonicalInputDigest(sortedFacts),
      coverage_snapshot_digest: canonicalInputDigest(sortedCoverage),
      section_order: ["contact", "summary", "experience", "projects", "education", "credentials"],
      summary_decision: "include",
    },
  };
}

export const SPEC_10_DENSE_CORPUS = buildFixture({
  namespace: "81",
  fixtureId: "spec-10-dense-synthetic-v1",
  contacts: ["Riley Moss | Alder Ridge | riley@fixture.test", "555-010-8101"],
  jobs: [
    { roleFamily: "logistics", title: "Fleet Dispatch Coordinator", employer: "Blue Quarry Transit" },
    { roleFamily: "community_support", title: "Community Support Lead", employer: "Cedar Lantern Network" },
    { roleFamily: "learning_programs", title: "Digital Learning Program Planner", employer: "Marble Kite Institute" },
  ],
  projects: ["Designed a synthetic route-audit workbook.", "Coordinated a synthetic neighborhood resource fair."],
  education: "Associate degree in applied systems from Fixture Valley College.",
  credential: "Synthetic workplace safety certificate.",
  preference: "Prefers a chronological general resume with concise evidence-backed bullets.",
});

export const SPEC_10_HOLDOUT_CORPUS = buildFixture({
  namespace: "82",
  fixtureId: "spec-10-holdout-synthetic-v1",
  contacts: ["Morgan Vale | Juniper Harbor | morgan@holdout.test", "555-010-8202"],
  jobs: [
    { roleFamily: "field_services", title: "Field Service Scheduler", employer: "Copper Finch Utilities" },
    { roleFamily: "museum_operations", title: "Museum Operations Steward", employer: "Tidal Glass Museum" },
    { roleFamily: "food_programs", title: "Community Food Program Analyst", employer: "Pine Orbit Cooperative" },
  ],
  projects: ["Built a synthetic exhibit-maintenance tracker.", "Mapped a synthetic pantry delivery cycle."],
  education: "Certificate program in service analytics from Holdout Shore Institute.",
  credential: "Synthetic accessibility fundamentals badge.",
  preference: "Prefers a compact general resume that separates each confirmed role.",
});

function canonicalFacts(facts: readonly Spec10SyntheticFact[]): Spec10SyntheticFact[] {
  return [...facts].sort((left, right) => left.revision_id.localeCompare(right.revision_id));
}

function canonicalCoverage(coverage: readonly Spec10SyntheticCoverage[]): Spec10SyntheticCoverage[] {
  return [...coverage]
    .map((item) => ({
      ...item,
      dimensions: Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, {
        ...item.dimensions[dimension],
        evidence_revision_ids: [...item.dimensions[dimension].evidence_revision_ids].sort(),
      }])) as Spec10SyntheticCoverage["dimensions"],
    }))
    .sort((left, right) => left.revision_id.localeCompare(right.revision_id));
}

export function fixtureIdentity(fixture: Spec10SyntheticFixture) {
  const facts = canonicalFacts(fixture.facts);
  const coverage = canonicalCoverage(fixture.coverage);
  const jobs = [...fixture.jobs].sort((left, right) => left.fact_revision_id.localeCompare(right.fact_revision_id));
  const strategy = fixture.strategy === null ? null : {
    ...fixture.strategy,
    fact_revision_ids: [...fixture.strategy.fact_revision_ids].sort(),
    coverage_revision_ids: [...fixture.strategy.coverage_revision_ids].sort(),
  };
  const revision_ids = [
    ...facts.map((fact) => fact.revision_id),
    ...coverage.map((item) => item.revision_id),
    ...(strategy ? [strategy.revision_id] : []),
  ].sort();
  return {
    fixture_digest: canonicalInputDigest({ fixture_id: fixture.fixture_id, jobs, facts, coverage, strategy }),
    fact_snapshot_digest: canonicalInputDigest(facts),
    coverage_snapshot_digest: canonicalInputDigest(coverage),
    strategy_digest: canonicalInputDigest(strategy),
    revision_ids,
  };
}

export const SPEC_10_DENSE_CORPUS_DIGEST = fixtureIdentity(SPEC_10_DENSE_CORPUS).fixture_digest;
export const SPEC_10_HOLDOUT_CORPUS_DIGEST = fixtureIdentity(SPEC_10_HOLDOUT_CORPUS).fixture_digest;

export function permuteSpec10Fixture(fixture: Spec10SyntheticFixture, seed: number): Spec10SyntheticFixture {
  const rotate = <T>(values: readonly T[], offset: number): T[] => {
    if (values.length === 0) return [];
    const normalized = Math.abs(offset) % values.length;
    return [...values.slice(normalized), ...values.slice(0, normalized)];
  };
  const clone = structuredClone(fixture);
  clone.jobs = rotate(clone.jobs, seed);
  clone.facts = rotate(clone.facts, seed * 3 + 1);
  clone.coverage = rotate(clone.coverage, seed * 5 + 2);
  if (clone.strategy) {
    clone.strategy.fact_revision_ids = rotate(clone.strategy.fact_revision_ids, seed * 7 + 3);
    clone.strategy.coverage_revision_ids = rotate(clone.strategy.coverage_revision_ids, seed * 11 + 4);
  }
  return clone;
}

export function fixtureSafetyFindings(fixture: Spec10SyntheticFixture): string[] {
  const serialized = JSON.stringify(fixture).toLowerCase();
  const forbidden = ["private_owner_canary", "private_prompt_canary", "sk-", "api_key", "secret_ref", "http://", "https://", "/home/", "@example.com"];
  return forbidden.filter((canary) => serialized.includes(canary));
}

export function evaluateSpec10FixtureEligibility(fixture: Spec10SyntheticFixture): { eligible: boolean; reasons: string[] } {
  const reasons = new Set<string>();
  const facts = canonicalFacts(fixture.facts);
  const coverage = canonicalCoverage(fixture.coverage);
  const factIds = new Set(facts.map((fact) => fact.revision_id));
  const coverageIds = new Set(coverage.map((item) => item.revision_id));
  if (factIds.size !== facts.length || coverageIds.size !== coverage.length) reasons.add("duplicate_revision");
  if (fixture.jobs.length !== 3 || new Set(fixture.jobs.map((job) => job.role_family)).size !== 3) reasons.add("insufficient_job_shape");
  if (facts.length !== 29 || facts.filter((fact) => fact.fact_kind === "job_evidence").length !== 19) reasons.add("insufficient_fact_distribution");
  if (facts.some((fact) => fact.value.trim().length === 0)) reasons.add("malformed_fact");
  if (coverage.length !== 3 || coverage.some((item) => Object.keys(item.dimensions).length !== DIMENSIONS.length)) reasons.add("unsupported_coverage");
  const coverageDimensions = coverage.flatMap((item) => DIMENSIONS.map((dimension) => ({ record: item, dimension, value: item.dimensions[dimension] })));
  if (coverageDimensions.some(({ value }) => value.outcome !== "answered" && value.outcome !== "deferred")) reasons.add("unsupported_coverage");
  for (const { record, dimension, value } of coverageDimensions) {
    if (value.outcome === "deferred" && value.evidence_revision_ids.length > 0) reasons.add("deferred_has_evidence");
    if (value.outcome === "answered" && value.evidence_revision_ids.length === 0) reasons.add("answered_missing_evidence");
    for (const evidenceId of value.evidence_revision_ids) {
      const evidence = facts.find((fact) => fact.revision_id === evidenceId);
      if (!evidence || evidence.fact_kind !== "job_evidence" || evidence.job_fact_revision_id !== record.job_fact_revision_id || evidence.dimension !== dimension) reasons.add("foreign_evidence");
    }
  }
  if (coverageDimensions.filter(({ value }) => value.outcome === "answered").length !== 15 || coverageDimensions.filter(({ value }) => value.outcome === "deferred").length !== 3) reasons.add("coverage_distribution");
  if (!fixture.strategy) reasons.add("missing_strategy");
  else {
    if (new Set(fixture.strategy.fact_revision_ids).size !== factIds.size || fixture.strategy.fact_revision_ids.some((id) => !factIds.has(id))) reasons.add("stale_strategy");
    if (new Set(fixture.strategy.coverage_revision_ids).size !== coverageIds.size || fixture.strategy.coverage_revision_ids.some((id) => !coverageIds.has(id))) reasons.add("stale_strategy");
    if (fixture.strategy.fact_snapshot_digest !== canonicalInputDigest(facts) || fixture.strategy.coverage_snapshot_digest !== canonicalInputDigest(coverage)) reasons.add("stale_strategy");
  }
  if (fixtureSafetyFindings(fixture).length > 0) reasons.add("unsafe_content");
  return { eligible: reasons.size === 0, reasons: [...reasons].sort() };
}

export function createSpec10InvalidFixtureVariants(fixture: Spec10SyntheticFixture): Record<string, Spec10SyntheticFixture> {
  const variants: Record<string, Spec10SyntheticFixture> = {};
  variants.stale_strategy = structuredClone(fixture);
  variants.stale_strategy.strategy!.fact_revision_ids[0] = revisionId("89", 1);
  variants.foreign_evidence = structuredClone(fixture);
  variants.foreign_evidence.coverage[0]!.dimensions.responsibilities.evidence_revision_ids = [revisionId("89", 2)];
  variants.missing_strategy = structuredClone(fixture);
  variants.missing_strategy.strategy = null;
  variants.unsupported_coverage = structuredClone(fixture);
  (variants.unsupported_coverage.coverage[0]!.dimensions.responsibilities as { outcome: string }).outcome = "unknown";
  variants.malformed_fact = structuredClone(fixture);
  variants.malformed_fact.facts[0]!.value = "";
  variants.insufficient_snapshot = structuredClone(fixture);
  const retainedJob = variants.insufficient_snapshot.jobs[0]!.fact_revision_id;
  variants.insufficient_snapshot.jobs = variants.insufficient_snapshot.jobs.slice(0, 1);
  variants.insufficient_snapshot.facts = variants.insufficient_snapshot.facts.filter((fact) => fact.job_fact_revision_id === null || fact.job_fact_revision_id === retainedJob);
  variants.insufficient_snapshot.coverage = variants.insufficient_snapshot.coverage.filter((item) => item.job_fact_revision_id === retainedJob);
  return variants;
}

export const SPEC_10_RECONCILIATION_POLICY = Object.freeze({
  initial_ui_transition_ms: 500,
  host_operation_deadline_ms: 120_000,
  final_authoritative_read_ms: 120_000,
  early_poll_elapsed_ms: [625, 750, 1_000, 1_500, 2_500, 4_500, 8_500] as const,
  maximum_poll_interval_ms: 5_000,
});

type SaveHarnessState = "idle" | "pending" | "committed" | "conflict" | "cancelled" | "failed";
type UiSaveState = "idle" | "pending" | "saved" | "conflict" | "not_saved" | "cancelled" | "detached" | "reconstructing";
export const SPEC_10_GUARDED_INTENTS = ["submit", "save_answer", "complete_for_now", "pause", "back", "stage_navigation"] as const;
export type Spec10GuardedIntent = typeof SPEC_10_GUARDED_INTENTS[number];

export type Spec10SaveRequest = {
  operation_id: string;
  semantic_identity: `sha256:${string}`;
  slot_identity: string;
  value_digest: `sha256:${string}`;
  expected_revision: number;
};

type SaveTiming = {
  commit_at_ms?: number;
  visible_at_ms?: number;
  response_at_ms?: number;
  response_lost?: boolean;
  first_read_misses?: number;
  conflict_at_ms?: number;
};

type SaveHarnessCounters = {
  write_calls: number;
  recovery_writes: number;
  idempotency_reuses: number;
  operation_reads: number;
  workspace_reads: number;
  response_observations: number;
  transition_requests: number;
  transitions: number;
  cancellations: number;
  stale_acknowledgements_ignored: number;
  teardowns: number;
  reloads: number;
  iframe_reconnects: number;
  app_runtime_restarts: number;
  mcp_restarts: number;
  reconstructions: number;
};

type TimelineEntry = {
  elapsed_ms: number;
  kind: "write" | "durable" | "operation_read" | "workspace_read" | "response" | "transition" | "topology";
  observation: string;
  operation_id: string | null;
  value_digest: string | null;
  revision: number | null;
};

type PersistedReadback = { operation_id: string | null; value_digest: string; revision: number; disposition: "committed" | "conflict" };
type OperationState = {
  request: Spec10SaveRequest;
  timing: SaveTiming;
  state: SaveHarnessState;
  remainingMisses: number;
  requestGeneration: number;
  committedRevision: number | null;
};

function emptyCounters(overrides: Partial<SaveHarnessCounters> = {}): SaveHarnessCounters {
  return {
    write_calls: 0, recovery_writes: 0, idempotency_reuses: 0, operation_reads: 0,
    workspace_reads: 0, response_observations: 0, transition_requests: 0, transitions: 0,
    cancellations: 0, stale_acknowledgements_ignored: 0, teardowns: 0, reloads: 0,
    iframe_reconnects: 0, app_runtime_restarts: 0, mcp_restarts: 0, reconstructions: 0,
    ...overrides,
  };
}

function deterministicOperationId(identity: `sha256:${string}`): string {
  const hex = identity.slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function spec10SaveRequest(label: string, expectedRevision = 0): Spec10SaveRequest {
  const slot_identity = "synthetic-session/contact-question/answer";
  const value_digest = canonicalInputDigest({ synthetic_value_label: label });
  const semantic_identity = canonicalInputDigest({ slot_identity, value_digest, expected_revision: expectedRevision });
  return { operation_id: deterministicOperationId(semantic_identity), semantic_identity, slot_identity, value_digest, expected_revision: expectedRevision };
}

export class DeterministicSaveHarness {
  private nowMs = 0;
  private generation = 0;
  private attached = true;
  private uiState: UiSaveState = "idle";
  private activeIdentity: string | null = null;
  private acknowledgedDigest: string | null = null;
  private persisted: PersistedReadback | null = null;
  private conflictReadback: PersistedReadback | null = null;
  private readonly operations = new Map<string, OperationState>();
  private readonly counters = emptyCounters();
  private readonly timeline: TimelineEntry[] = [];
  private readonly requestedIntents = new Map<Spec10GuardedIntent, number>();
  private readonly actualIntents = new Map<Spec10GuardedIntent, number>();

  requestWrite(request: Spec10SaveRequest, timing: SaveTiming = {}): void {
    this.counters.write_calls += 1;
    this.activeIdentity = request.semantic_identity;
    this.uiState = "pending";
    const existing = this.operations.get(request.semantic_identity);
    if (existing) {
      this.counters.idempotency_reuses += 1;
      this.record("write", "equivalent_reused", request, existing.committedRevision);
      return;
    }
    this.operations.set(request.semantic_identity, {
      request,
      timing,
      state: "pending",
      remainingMisses: timing.first_read_misses ?? 0,
      requestGeneration: this.generation,
      committedRevision: null,
    });
    this.record("write", "semantic_operation_created", request, null);
  }

  requestTransition(intent: Spec10GuardedIntent): void {
    this.counters.transition_requests += 1;
    this.requestedIntents.set(intent, (this.requestedIntents.get(intent) ?? 0) + 1);
    this.record("transition", `requested:${intent}`, this.activeOperation()?.request ?? null, null);
  }

  releaseTransitions(): void {
    const active = this.activeOperation();
    for (const intent of SPEC_10_GUARDED_INTENTS) {
      if ((this.requestedIntents.get(intent) ?? 0) === 0 || (this.actualIntents.get(intent) ?? 0) > 0) continue;
      if (active?.state === "committed" && this.acknowledgedDigest === active.request.value_digest && this.uiState === "saved") {
        this.actualIntents.set(intent, 1);
        this.counters.transitions += 1;
        this.record("transition", `executed:${intent}`, active.request, active.committedRevision);
      } else {
        this.record("transition", `blocked:${intent}:${active?.state ?? "idle"}`, active?.request ?? null, active?.committedRevision ?? null);
      }
    }
  }

  advanceTo(elapsedMs: number): void {
    if (elapsedMs < this.nowMs) throw new Error("Spec 10 deterministic clock cannot move backwards");
    this.nowMs = elapsedMs;
    const pending = [...this.operations.values()]
      .filter((operation) => operation.state === "pending")
      .sort((left, right) => (left.timing.commit_at_ms ?? Number.MAX_SAFE_INTEGER) - (right.timing.commit_at_ms ?? Number.MAX_SAFE_INTEGER));
    for (const operation of pending) {
      if (operation.timing.conflict_at_ms !== undefined && elapsedMs >= operation.timing.conflict_at_ms) {
        operation.state = "conflict";
        this.conflictReadback = {
          operation_id: null,
          value_digest: canonicalInputDigest({ synthetic_conflict_for: operation.request.operation_id }),
          revision: operation.request.expected_revision + 1,
          disposition: "conflict",
        };
        this.record("durable", "conflict", operation.request, this.conflictReadback.revision);
      } else if (operation.timing.commit_at_ms !== undefined && elapsedMs >= operation.timing.commit_at_ms) {
        operation.state = "committed";
        operation.committedRevision = operation.request.expected_revision + 1;
        this.persisted = {
          operation_id: operation.request.operation_id,
          value_digest: operation.request.value_digest,
          revision: operation.committedRevision,
          disposition: "committed",
        };
        this.counters.recovery_writes += 1;
        this.record("durable", "committed", operation.request, operation.committedRevision);
      } else if (elapsedMs >= SPEC_10_RECONCILIATION_POLICY.host_operation_deadline_ms) {
        operation.state = "failed";
        this.record("durable", "failed_no_commit", operation.request, null);
      }
    }
  }

  readOperation(request: Spec10SaveRequest = this.requireActiveRequest()): string {
    this.counters.operation_reads += 1;
    const operation = this.operations.get(request.semantic_identity);
    if (!operation) return this.record("operation_read", "not_found", request, null);
    if (operation.remainingMisses > 0) {
      operation.remainingMisses -= 1;
      return this.record("operation_read", "not_found", request, null);
    }
    if (operation.state === "committed" && this.nowMs < (operation.timing.visible_at_ms ?? operation.timing.commit_at_ms ?? 0)) {
      return this.record("operation_read", "not_found", request, null);
    }
    if (operation.state === "committed") {
      if (this.activeIdentity !== request.semantic_identity) {
        this.counters.stale_acknowledgements_ignored += 1;
        return this.record("operation_read", "committed_stale_ignored", request, operation.committedRevision);
      }
      this.applyCommittedReadback(request, operation.committedRevision!);
      return this.record("operation_read", "committed_current", request, operation.committedRevision);
    }
    if (operation.state === "conflict") this.uiState = "conflict";
    if (operation.state === "failed") this.uiState = "not_saved";
    if (operation.state === "cancelled") this.uiState = "cancelled";
    return this.record("operation_read", operation.state === "pending" ? "not_found" : operation.state, request, operation.committedRevision);
  }

  readWorkspace(): string {
    this.counters.workspace_reads += 1;
    const active = this.activeOperation();
    if (active?.state === "conflict" && this.conflictReadback) {
      this.uiState = "conflict";
      return this.record("workspace_read", "conflict_readback", active.request, this.conflictReadback.revision);
    }
    if (this.persisted) {
      const matching = active?.request.value_digest === this.persisted.value_digest;
      if (matching) this.applyCommittedReadback(active.request, this.persisted.revision);
      return this.record("workspace_read", matching ? "committed_current" : "committed_other", active?.request ?? null, this.persisted.revision);
    }
    if (active?.state === "failed") this.uiState = "not_saved";
    if (active?.state === "cancelled") this.uiState = "cancelled";
    return this.record("workspace_read", "no_commit", active?.request ?? null, null);
  }

  observeResponse(request: Spec10SaveRequest = this.requireActiveRequest()): string {
    this.counters.response_observations += 1;
    const operation = this.operations.get(request.semantic_identity);
    if (!operation || this.nowMs < (operation.timing.response_at_ms ?? operation.timing.commit_at_ms ?? Number.MAX_SAFE_INTEGER)) {
      return this.record("response", "pending", request, null);
    }
    if (operation.timing.response_lost) return this.record("response", "lost", request, operation.committedRevision);
    if (!this.attached || operation.requestGeneration !== this.generation) return this.record("response", "ignored_obsolete", request, operation.committedRevision);
    if (operation.state === "committed" && this.activeIdentity === request.semantic_identity) {
      this.applyCommittedReadback(request, operation.committedRevision!);
      return this.record("response", "delivered_current", request, operation.committedRevision);
    }
    if (operation.state === "committed") {
      this.counters.stale_acknowledgements_ignored += 1;
      return this.record("response", "delivered_stale_ignored", request, operation.committedRevision);
    }
    return this.record("response", operation.state, request, operation.committedRevision);
  }

  cancel(request: Spec10SaveRequest = this.requireActiveRequest()): void {
    this.counters.cancellations += 1;
    const operation = this.operations.get(request.semantic_identity);
    if (operation?.state === "pending") operation.state = "cancelled";
    if (this.activeIdentity === request.semantic_identity) this.uiState = "cancelled";
    this.record("durable", "cancelled_no_commit", request, null);
  }

  topology(kind: "teardown" | "reload" | "iframe_reconnect" | "app_runtime_restart" | "mcp_restart"): void {
    this.generation += 1;
    if (kind === "teardown") {
      this.attached = false;
      this.uiState = "detached";
      this.counters.teardowns += 1;
    } else {
      this.attached = true;
      this.uiState = "reconstructing";
      if (kind === "reload") this.counters.reloads += 1;
      if (kind === "iframe_reconnect") this.counters.iframe_reconnects += 1;
      if (kind === "app_runtime_restart") this.counters.app_runtime_restarts += 1;
      if (kind === "mcp_restart") this.counters.mcp_restarts += 1;
    }
    this.record("topology", kind, this.activeOperation()?.request ?? null, null);
  }

  reconstruct(source: "operation" | "workspace"): string {
    this.counters.reconstructions += 1;
    return source === "operation" ? this.readOperation() : this.readWorkspace();
  }

  snapshot() {
    const active = this.activeOperation();
    return {
      state: active?.state ?? "idle",
      ui_state: this.uiState,
      active_semantic_identity: active?.request.semantic_identity ?? null,
      active_value_digest: active?.request.value_digest ?? null,
      acknowledged_value_digest: this.acknowledgedDigest,
      persisted_readback: this.persisted ?? this.conflictReadback,
      operations: [...this.operations.values()].map((operation) => ({
        operation_id: operation.request.operation_id,
        semantic_identity: operation.request.semantic_identity,
        value_digest: operation.request.value_digest,
        expected_revision: operation.request.expected_revision,
        state: operation.state,
        committed_revision: operation.committedRevision,
      })),
      counters: { ...this.counters },
      transitions: Object.fromEntries(SPEC_10_GUARDED_INTENTS.map((intent) => [intent, {
        requested: this.requestedIntents.get(intent) ?? 0,
        actual: this.actualIntents.get(intent) ?? 0,
      }])),
      timeline: [...this.timeline],
    };
  }

  private activeOperation(): OperationState | null {
    return this.activeIdentity ? this.operations.get(this.activeIdentity) ?? null : null;
  }

  private requireActiveRequest(): Spec10SaveRequest {
    const request = this.activeOperation()?.request;
    if (!request) throw new Error("Spec 10 save harness has no active operation");
    return request;
  }

  private applyCommittedReadback(request: Spec10SaveRequest, revision: number): void {
    if (!this.attached || this.activeIdentity !== request.semantic_identity) return;
    this.acknowledgedDigest = request.value_digest;
    this.uiState = "saved";
    this.persisted = { operation_id: request.operation_id, value_digest: request.value_digest, revision, disposition: "committed" };
  }

  private record(kind: TimelineEntry["kind"], observation: string, request: Spec10SaveRequest | null, revision: number | null): string {
    this.timeline.push({ elapsed_ms: this.nowMs, kind, observation, operation_id: request?.operation_id ?? null, value_digest: request?.value_digest ?? null, revision });
    return observation;
  }
}

type NamedRequest = "primary" | "newer";
type ScenarioStep =
  | { action: "write"; request: NamedRequest }
  | { action: "transition"; intent: Spec10GuardedIntent }
  | { action: "advance"; elapsed_ms: number }
  | { action: "operation_read" | "response" | "cancel"; request: NamedRequest }
  | { action: "workspace_read" | "release_transitions" }
  | { action: "topology"; kind: "teardown" | "reload" | "iframe_reconnect" | "app_runtime_restart" | "mcp_restart" }
  | { action: "reconstruct"; source: "operation" | "workspace" };

type ScenarioExpected = {
  state: SaveHarnessState;
  ui_state: UiSaveState;
  counters: SaveHarnessCounters;
  observations: string[];
  response_dispositions: string[];
  topology_observations: string[];
  persisted: "primary" | "newer" | "conflict" | "none";
};

export type Spec10SaveScenario = {
  id: string;
  requests: Record<NamedRequest, { request: Spec10SaveRequest; timing: SaveTiming }>;
  steps: ScenarioStep[];
  expected: ScenarioExpected;
};

const PRIMARY = spec10SaveRequest("primary-value", 0);
const NEWER = spec10SaveRequest("newer-value", 1);
const defaultRequests = (primary: SaveTiming, newer: SaveTiming = {}): Spec10SaveScenario["requests"] => ({
  primary: { request: PRIMARY, timing: primary },
  newer: { request: NEWER, timing: newer },
});
const expected = (state: SaveHarnessState, ui_state: UiSaveState, counters: Partial<SaveHarnessCounters>, observations: string[], persisted: ScenarioExpected["persisted"], response_dispositions: string[] = [], topology_observations: string[] = []): ScenarioExpected => ({
  state, ui_state, counters: emptyCounters(counters), observations, response_dispositions, topology_observations, persisted,
});
const write = (request: NamedRequest): ScenarioStep => ({ action: "write", request });
const advance = (elapsed_ms: number): ScenarioStep => ({ action: "advance", elapsed_ms });
const operationRead = (request: NamedRequest): ScenarioStep => ({ action: "operation_read", request });

export const SPEC_10_SAVE_SCENARIOS: Spec10SaveScenario[] = [
  { id: "fast_ack", requests: defaultRequests({ commit_at_ms: 400, visible_at_ms: 400, response_at_ms: 400 }), steps: [write("primary"), advance(400), { action: "response", request: "primary" }, { action: "workspace_read" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, response_observations: 1, workspace_reads: 1 }, ["delivered_current", "committed_current"], "primary", ["delivered_current"]) },
  { id: "observed_630ms", requests: defaultRequests({ commit_at_ms: 630, visible_at_ms: 630 }), steps: [write("primary"), { action: "transition", intent: "submit" }, advance(625), operationRead("primary"), advance(750), operationRead("primary"), { action: "release_transitions" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, operation_reads: 2, transition_requests: 1, transitions: 1 }, ["not_found", "committed_current", "executed:submit"], "primary") },
  { id: "observed_741ms", requests: defaultRequests({ commit_at_ms: 741, visible_at_ms: 741 }), steps: [write("primary"), advance(625), operationRead("primary"), advance(750), operationRead("primary")], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, operation_reads: 2 }, ["not_found", "committed_current"], "primary") },
  { id: "later_in_policy", requests: defaultRequests({ commit_at_ms: 5_000, visible_at_ms: 5_000 }), steps: [write("primary"), ...[625, 750, 1_000, 1_500, 2_500, 4_500, 8_500].flatMap((elapsed): ScenarioStep[] => [advance(elapsed), operationRead("primary")])], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, operation_reads: 7 }, ["not_found", "committed_current"], "primary") },
  { id: "response_loss_after_commit", requests: defaultRequests({ commit_at_ms: 741, visible_at_ms: 741, response_at_ms: 741, response_lost: true }), steps: [write("primary"), advance(750), { action: "response", request: "primary" }, operationRead("primary")], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, response_observations: 1, operation_reads: 1 }, ["lost", "committed_current"], "primary", ["lost"]) },
  { id: "not_found_then_visible", requests: defaultRequests({ commit_at_ms: 630, visible_at_ms: 750, first_read_misses: 1 }), steps: [write("primary"), advance(750), operationRead("primary"), advance(1_000), operationRead("primary")], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, operation_reads: 2 }, ["not_found", "committed_current"], "primary") },
  { id: "terminal_failure", requests: defaultRequests({}), steps: [write("primary"), { action: "transition", intent: "save_answer" }, advance(120_000), operationRead("primary"), { action: "workspace_read" }, { action: "release_transitions" }], expected: expected("failed", "not_saved", { write_calls: 1, operation_reads: 1, workspace_reads: 1, transition_requests: 1 }, ["failed", "no_commit", "blocked:save_answer:failed"], "none") },
  { id: "duplicate_force_flush", requests: defaultRequests({ commit_at_ms: 741 }), steps: [write("primary"), write("primary"), { action: "transition", intent: "submit" }, { action: "transition", intent: "submit" }, advance(750), operationRead("primary"), { action: "release_transitions" }, { action: "release_transitions" }], expected: expected("committed", "saved", { write_calls: 2, recovery_writes: 1, idempotency_reuses: 1, operation_reads: 1, transition_requests: 2, transitions: 1 }, ["equivalent_reused", "committed_current", "executed:submit"], "primary") },
  { id: "new_value_during_pending", requests: defaultRequests({ commit_at_ms: 741, visible_at_ms: 741 }, { commit_at_ms: 900, visible_at_ms: 900 }), steps: [write("primary"), advance(600), write("newer"), advance(750), operationRead("primary"), operationRead("newer"), advance(900), operationRead("newer"), { action: "workspace_read" }], expected: expected("committed", "saved", { write_calls: 2, recovery_writes: 2, operation_reads: 3, workspace_reads: 1, stale_acknowledgements_ignored: 1 }, ["committed_stale_ignored", "not_found", "committed_current"], "newer") },
  { id: "conflict", requests: defaultRequests({ conflict_at_ms: 700 }), steps: [write("primary"), { action: "transition", intent: "complete_for_now" }, advance(700), operationRead("primary"), { action: "workspace_read" }, { action: "release_transitions" }], expected: expected("conflict", "conflict", { write_calls: 1, operation_reads: 1, workspace_reads: 1, transition_requests: 1 }, ["conflict", "conflict_readback", "blocked:complete_for_now:conflict"], "conflict") },
  { id: "cancellation", requests: defaultRequests({ commit_at_ms: 900 }), steps: [write("primary"), { action: "transition", intent: "pause" }, advance(600), { action: "cancel", request: "primary" }, operationRead("primary"), { action: "workspace_read" }, { action: "release_transitions" }], expected: expected("cancelled", "cancelled", { write_calls: 1, operation_reads: 1, workspace_reads: 1, transition_requests: 1, cancellations: 1 }, ["cancelled", "no_commit", "blocked:pause:cancelled"], "none") },
  { id: "teardown_late_commit", requests: defaultRequests({ commit_at_ms: 741, response_at_ms: 741 }), steps: [write("primary"), advance(600), { action: "topology", kind: "teardown" }, advance(750), { action: "response", request: "primary" }, { action: "topology", kind: "reload" }, { action: "reconstruct", source: "workspace" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, response_observations: 1, workspace_reads: 1, teardowns: 1, reloads: 1, reconstructions: 1 }, ["ignored_obsolete", "committed_current"], "primary", ["ignored_obsolete"], ["teardown", "reload"]) },
  { id: "reload_saved", requests: defaultRequests({ commit_at_ms: 400 }), steps: [write("primary"), advance(400), { action: "topology", kind: "reload" }, { action: "reconstruct", source: "workspace" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, workspace_reads: 1, reloads: 1, reconstructions: 1 }, ["committed_current"], "primary", [], ["reload"]) },
  { id: "iframe_reconnect_pending", requests: defaultRequests({ commit_at_ms: 741, visible_at_ms: 741 }), steps: [write("primary"), advance(600), { action: "topology", kind: "iframe_reconnect" }, { action: "reconstruct", source: "operation" }, advance(750), { action: "reconstruct", source: "operation" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, operation_reads: 2, iframe_reconnects: 1, reconstructions: 2 }, ["not_found", "committed_current"], "primary", [], ["iframe_reconnect"]) },
  { id: "app_runtime_restart_saved", requests: defaultRequests({ commit_at_ms: 400 }), steps: [write("primary"), advance(400), { action: "topology", kind: "app_runtime_restart" }, { action: "reconstruct", source: "workspace" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, workspace_reads: 1, app_runtime_restarts: 1, reconstructions: 1 }, ["committed_current"], "primary", [], ["app_runtime_restart"]) },
  { id: "app_runtime_restart_pending", requests: defaultRequests({ commit_at_ms: 741 }), steps: [write("primary"), advance(600), { action: "topology", kind: "app_runtime_restart" }, { action: "reconstruct", source: "operation" }, advance(750), { action: "reconstruct", source: "operation" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, operation_reads: 2, app_runtime_restarts: 1, reconstructions: 2 }, ["not_found", "committed_current"], "primary", [], ["app_runtime_restart"]) },
  { id: "app_runtime_restart_conflicted", requests: defaultRequests({ conflict_at_ms: 700 }), steps: [write("primary"), advance(700), { action: "topology", kind: "app_runtime_restart" }, { action: "reconstruct", source: "operation" }, { action: "workspace_read" }], expected: expected("conflict", "conflict", { write_calls: 1, operation_reads: 1, workspace_reads: 1, app_runtime_restarts: 1, reconstructions: 1 }, ["conflict", "conflict_readback"], "conflict", [], ["app_runtime_restart"]) },
  { id: "app_runtime_restart_terminal_failed", requests: defaultRequests({}), steps: [write("primary"), advance(120_000), { action: "topology", kind: "app_runtime_restart" }, { action: "reconstruct", source: "operation" }, { action: "workspace_read" }], expected: expected("failed", "not_saved", { write_calls: 1, operation_reads: 1, workspace_reads: 1, app_runtime_restarts: 1, reconstructions: 1 }, ["failed", "no_commit"], "none", [], ["app_runtime_restart"]) },
  { id: "mcp_restart_pending", requests: defaultRequests({ commit_at_ms: 741 }), steps: [write("primary"), advance(600), { action: "topology", kind: "mcp_restart" }, { action: "reconstruct", source: "operation" }, advance(750), { action: "reconstruct", source: "operation" }], expected: expected("committed", "saved", { write_calls: 1, recovery_writes: 1, operation_reads: 2, mcp_restarts: 1, reconstructions: 2 }, ["not_found", "committed_current"], "primary", [], ["mcp_restart"]) },
];

export function runSpec10SaveScenario(input: Spec10SaveScenario) {
  const harness = new DeterministicSaveHarness();
  for (const step of input.steps) {
    const selected = "request" in step ? input.requests[step.request] : null;
    switch (step.action) {
      case "write": harness.requestWrite(selected!.request, selected!.timing); break;
      case "transition": harness.requestTransition(step.intent); break;
      case "advance": harness.advanceTo(step.elapsed_ms); break;
      case "operation_read": harness.readOperation(selected!.request); break;
      case "response": harness.observeResponse(selected!.request); break;
      case "cancel": harness.cancel(selected!.request); break;
      case "workspace_read": harness.readWorkspace(); break;
      case "release_transitions": harness.releaseTransitions(); break;
      case "topology": harness.topology(step.kind); break;
      case "reconstruct": harness.reconstruct(step.source); break;
    }
  }
  return harness.snapshot();
}

export function reproduceLegacyOneShotSaveRace(input: { commit_at_ms: number; visible_at_ms: number }) {
  const request = spec10SaveRequest("legacy-one-shot");
  const harness = new DeterministicSaveHarness();
  harness.requestWrite(request, { commit_at_ms: input.commit_at_ms, visible_at_ms: input.visible_at_ms });
  harness.advanceTo(SPEC_10_RECONCILIATION_POLICY.initial_ui_transition_ms);
  const firstRead = harness.readOperation(request);
  const owner_state_at_500_ms = firstRead === "committed_current" ? "saved" : "not_saved";
  harness.advanceTo(input.commit_at_ms);
  return { owner_state_at_500_ms, durable_state_at_741_ms: harness.snapshot().state, recovery_write_count: harness.snapshot().counters.recovery_writes };
}
