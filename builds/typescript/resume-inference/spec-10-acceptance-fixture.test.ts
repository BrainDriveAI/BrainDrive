import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  SPEC_10_DENSE_CORPUS,
  SPEC_10_DENSE_CORPUS_DIGEST,
  SPEC_10_HOLDOUT_CORPUS,
  SPEC_10_HOLDOUT_CORPUS_DIGEST,
  SPEC_10_GUARDED_INTENTS,
  SPEC_10_RECONCILIATION_POLICY,
  SPEC_10_SAVE_SCENARIOS,
  DeterministicSaveHarness,
  createSpec10InvalidFixtureVariants,
  evaluateSpec10FixtureEligibility,
  fixtureIdentity,
  fixtureSafetyFindings,
  permuteSpec10Fixture,
  reproduceLegacyOneShotSaveRace,
  runSpec10SaveScenario,
  spec10SaveRequest,
} from "./spec-10-acceptance-fixture.js";

function factCounts(fixture: typeof SPEC_10_DENSE_CORPUS): Record<string, number> {
  return fixture.facts.reduce<Record<string, number>>((counts, fact) => {
    counts[fact.fact_kind] = (counts[fact.fact_kind] ?? 0) + 1;
    return counts;
  }, {});
}

function coverageOutcomes(fixture: typeof SPEC_10_DENSE_CORPUS): string[] {
  return fixture.coverage.flatMap((record) => Object.values(record.dimensions).map((dimension) => dimension.outcome));
}

describe("Spec 10 acceptance fixtures", () => {
  it("freezes eligible observed-equivalent and disjoint holdout identities", () => {
    for (const fixture of [SPEC_10_DENSE_CORPUS, SPEC_10_HOLDOUT_CORPUS]) {
      expect(fixture.jobs).toHaveLength(3);
      expect(new Set(fixture.jobs.map((job) => job.role_family)).size).toBe(3);
      expect(fixture.facts).toHaveLength(29);
      expect(factCounts(fixture)).toEqual({
        contact: 2,
        employment: 3,
        project: 2,
        education: 1,
        credential: 1,
        preference: 1,
        job_evidence: 19,
      });
      expect(fixture.coverage).toHaveLength(3);
      expect(coverageOutcomes(fixture).filter((outcome) => outcome === "answered")).toHaveLength(15);
      expect(coverageOutcomes(fixture).filter((outcome) => outcome === "deferred")).toHaveLength(3);
      expect(evaluateSpec10FixtureEligibility(fixture)).toEqual({ eligible: true, reasons: [] });
      expect(fixtureSafetyFindings(fixture)).toEqual([]);
    }

    const denseIds = new Set(fixtureIdentity(SPEC_10_DENSE_CORPUS).revision_ids);
    expect(fixtureIdentity(SPEC_10_HOLDOUT_CORPUS).revision_ids.every((id) => !denseIds.has(id))).toBe(true);
    const denseValues = new Set(SPEC_10_DENSE_CORPUS.facts.map((fact) => fact.value));
    expect(SPEC_10_HOLDOUT_CORPUS.facts.every((fact) => !denseValues.has(fact.value))).toBe(true);
  });

  it("keeps fixture and semantic digests stable across deterministic permutations", () => {
    expect(SPEC_10_DENSE_CORPUS_DIGEST).toBe("sha256:46bb257ce2324228645d48480086cf4d0b6ae9e334a24ac207f82b5f651398e7");
    expect(SPEC_10_HOLDOUT_CORPUS_DIGEST).toBe("sha256:3db0592ed2c1aeaa6bafe546437bc044490a2ca51532c5dcfdce9e9ec2d3a1cd");
    for (const seed of [0, 1, 2, 7, 19, 29]) {
      expect(fixtureIdentity(permuteSpec10Fixture(SPEC_10_DENSE_CORPUS, seed))).toEqual(fixtureIdentity(SPEC_10_DENSE_CORPUS));
      expect(fixtureIdentity(permuteSpec10Fixture(SPEC_10_HOLDOUT_CORPUS, seed))).toEqual(fixtureIdentity(SPEC_10_HOLDOUT_CORPUS));
    }
  });

  it("rejects every frozen stale, foreign, missing, unsupported, malformed, and insufficient variant", () => {
    const variants = createSpec10InvalidFixtureVariants(SPEC_10_DENSE_CORPUS);
    expect(Object.keys(variants).sort()).toEqual([
      "foreign_evidence",
      "insufficient_snapshot",
      "malformed_fact",
      "missing_strategy",
      "stale_strategy",
      "unsupported_coverage",
    ]);
    for (const [name, fixture] of Object.entries(variants)) {
      const result = evaluateSpec10FixtureEligibility(fixture);
      expect(result.eligible, name).toBe(false);
      expect(result.reasons.length, name).toBeGreaterThan(0);
    }
  });

  it("keeps the corrected ordered dense evidence-recovery source contract without fixture recognition", async () => {
    const brokerSource = await readFile(new URL("./broker.ts", import.meta.url), "utf8");
    const branchStart = brokerSource.indexOf('request.purpose === "general_resume_draft" && failureCode === "evidence_validation_failed"');
    const branchEnd = brokerSource.indexOf('let fallback: unknown | null = null;', branchStart);
    expect(branchStart).toBeGreaterThan(0);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const currentEvidenceFailureBranch = brokerSource.slice(branchStart, branchEnd);
    const targetedIndex = currentEvidenceFailureBranch.indexOf("repairResumeDraftFromConfirmedFacts");
    const fullIndex = currentEvidenceFailureBranch.indexOf("deterministicHostFallback");
    expect(targetedIndex).toBeGreaterThan(0);
    expect(fullIndex).toBeGreaterThan(targetedIndex);
    expect(currentEvidenceFailureBranch).not.toContain(SPEC_10_DENSE_CORPUS.fixture_id);
    expect(currentEvidenceFailureBranch).not.toContain(SPEC_10_HOLDOUT_CORPUS.fixture_id);
  });

  it("keeps every M4 production recovery source independent of fixture identities, shapes, and values", async () => {
    const productionFiles = ["./broker.ts", "./repair.ts", "./host-assistance.ts", "./snapshot.ts"];
    const forbiddenLiterals = [
      SPEC_10_DENSE_CORPUS.fixture_id,
      SPEC_10_HOLDOUT_CORPUS.fixture_id,
      SPEC_10_DENSE_CORPUS_DIGEST,
      SPEC_10_HOLDOUT_CORPUS_DIGEST,
      "81000000-",
      "82000000-",
      ...SPEC_10_DENSE_CORPUS.facts.map((fact) => fact.value),
      ...SPEC_10_HOLDOUT_CORPUS.facts.map((fact) => fact.value),
    ];
    for (const relativePath of productionFiles) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      for (const literal of forbiddenLiterals) expect(source, `${relativePath}: ${literal}`).not.toContain(literal);
      expect(source, relativePath).not.toMatch(/facts\.length\s*===\s*29/);
      expect(source, relativePath).not.toMatch(/jobs\.length\s*===\s*3/);
    }
  });

  it("keeps Spec 10 fixture and fault vocabulary outside runtime composition", async () => {
    const runtimeFiles = [
      "../gateway/server.ts",
      "../tools.ts",
      "../main.ts",
      "../app-platform/mcp-host/resume-host-adapter.ts",
      "../app-platform/mcp-host/app-host.ts",
    ];
    for (const relativePath of runtimeFiles) {
      const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
      expect(source, relativePath).not.toContain("spec-10-acceptance-fixture");
      expect(source, relativePath).not.toContain("SPEC_10_SAVE_SCENARIOS");
      expect(source, relativePath).not.toContain(SPEC_10_DENSE_CORPUS.fixture_id);
      expect(source, relativePath).not.toContain(SPEC_10_HOLDOUT_CORPUS.fixture_id);
    }
  });
});

describe("Spec 10 deterministic save timing and fault harness", () => {
  it("freezes the observed initial transition and host-aligned terminal policy", () => {
    expect(SPEC_10_RECONCILIATION_POLICY).toMatchObject({
      initial_ui_transition_ms: 500,
      host_operation_deadline_ms: 120_000,
      final_authoritative_read_ms: 120_000,
      early_poll_elapsed_ms: [625, 750, 1_000, 1_500, 2_500, 4_500, 8_500],
      maximum_poll_interval_ms: 5_000,
    });
  });

  it("reproduces the pre-fix false failure without leaving a failing default assertion", () => {
    expect(reproduceLegacyOneShotSaveRace({ commit_at_ms: 741, visible_at_ms: 741 })).toEqual({
      owner_state_at_500_ms: "not_saved",
      durable_state_at_741_ms: "committed",
      recovery_write_count: 1,
    });
  });

  it("runs every mandatory deterministic row with exact counters, observations, identity, and readback", () => {
    expect(SPEC_10_SAVE_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "fast_ack",
      "observed_630ms",
      "observed_741ms",
      "later_in_policy",
      "response_loss_after_commit",
      "not_found_then_visible",
      "terminal_failure",
      "duplicate_force_flush",
      "new_value_during_pending",
      "conflict",
      "cancellation",
      "teardown_late_commit",
      "reload_saved",
      "iframe_reconnect_pending",
      "app_runtime_restart_saved",
      "app_runtime_restart_pending",
      "app_runtime_restart_conflicted",
      "app_runtime_restart_terminal_failed",
      "mcp_restart_pending",
    ]);
    for (const scenario of SPEC_10_SAVE_SCENARIOS) {
      const result = runSpec10SaveScenario(scenario);
      expect(result.state, scenario.id).toBe(scenario.expected.state);
      expect(result.ui_state, scenario.id).toBe(scenario.expected.ui_state);
      expect(result.counters, scenario.id).toEqual(scenario.expected.counters);
      const observations = result.timeline.map((entry) => entry.observation);
      let cursor = -1;
      for (const observation of scenario.expected.observations) {
        cursor = observations.indexOf(observation, cursor + 1);
        expect(cursor, `${scenario.id}/${observation}`).toBeGreaterThanOrEqual(0);
      }
      expect(result.timeline.filter((entry) => entry.kind === "response").map((entry) => entry.observation), scenario.id).toEqual(scenario.expected.response_dispositions);
      expect(result.timeline.filter((entry) => entry.kind === "topology").map((entry) => entry.observation), scenario.id).toEqual(scenario.expected.topology_observations);
      if (scenario.expected.persisted === "none") expect(result.persisted_readback, scenario.id).toBeNull();
      else if (scenario.expected.persisted === "conflict") expect(result.persisted_readback, scenario.id).toMatchObject({ disposition: "conflict", revision: 1 });
      else {
        const persistedRequest = scenario.requests[scenario.expected.persisted].request;
        expect(result.persisted_readback, scenario.id).toEqual({
          operation_id: persistedRequest.operation_id,
          value_digest: persistedRequest.value_digest,
          revision: persistedRequest.expected_revision + 1,
          disposition: "committed",
        });
      }
      const activeRequest = scenario.id === "new_value_during_pending" ? scenario.requests.newer.request : scenario.requests.primary.request;
      expect(result.active_semantic_identity, scenario.id).toBe(activeRequest.semantic_identity);
      expect(result.active_value_digest, scenario.id).toBe(activeRequest.value_digest);
    }
  });

  it("proves equivalent reuse and changed-value semantic separation", () => {
    const duplicate = runSpec10SaveScenario(SPEC_10_SAVE_SCENARIOS.find((scenario) => scenario.id === "duplicate_force_flush")!);
    expect(duplicate.operations).toHaveLength(1);
    expect(duplicate.counters).toMatchObject({ write_calls: 2, recovery_writes: 1, idempotency_reuses: 1 });

    const changed = runSpec10SaveScenario(SPEC_10_SAVE_SCENARIOS.find((scenario) => scenario.id === "new_value_during_pending")!);
    expect(changed.operations).toHaveLength(2);
    expect(new Set(changed.operations.map((operation) => operation.operation_id)).size).toBe(2);
    expect(new Set(changed.operations.map((operation) => operation.semantic_identity)).size).toBe(2);
    expect(changed.operations).toEqual([
      expect.objectContaining({ state: "committed", committed_revision: 1 }),
      expect.objectContaining({ state: "committed", committed_revision: 2 }),
    ]);
    expect(changed.timeline.map((entry) => entry.observation)).toContain("committed_stale_ignored");
    expect(changed.acknowledged_value_digest).toBe(changed.active_value_digest);
  });

  it("freezes all guarded intents to once-after-save and never-after-conflict/failure/cancel", () => {
    expect(SPEC_10_GUARDED_INTENTS).toEqual(["submit", "save_answer", "complete_for_now", "pause", "back", "stage_navigation"]);
    for (const intent of SPEC_10_GUARDED_INTENTS) {
      const successRequest = spec10SaveRequest(`guarded-success-${intent}`);
      const success = new DeterministicSaveHarness();
      success.requestWrite(successRequest, { commit_at_ms: 400, response_at_ms: 400 });
      success.requestTransition(intent);
      success.requestTransition(intent);
      success.advanceTo(400);
      expect(success.observeResponse(successRequest), intent).toBe("delivered_current");
      success.releaseTransitions();
      success.releaseTransitions();
      expect(success.snapshot().transitions[intent], intent).toEqual({ requested: 2, actual: 1 });
      expect(success.snapshot().counters, intent).toMatchObject({ transition_requests: 2, transitions: 1 });

      const terminalCases = [
        { state: "failed", timing: {}, settle: (harness: DeterministicSaveHarness, request: ReturnType<typeof spec10SaveRequest>) => { harness.advanceTo(120_000); harness.readOperation(request); } },
        { state: "conflict", timing: { conflict_at_ms: 400 }, settle: (harness: DeterministicSaveHarness, request: ReturnType<typeof spec10SaveRequest>) => { harness.advanceTo(400); harness.readOperation(request); } },
        { state: "cancelled", timing: { commit_at_ms: 900 }, settle: (harness: DeterministicSaveHarness, request: ReturnType<typeof spec10SaveRequest>) => harness.cancel(request) },
      ] as const;
      for (const terminal of terminalCases) {
        const request = spec10SaveRequest(`guarded-${terminal.state}-${intent}`);
        const harness = new DeterministicSaveHarness();
        harness.requestWrite(request, terminal.timing);
        harness.requestTransition(intent);
        terminal.settle(harness, request);
        harness.releaseTransitions();
        expect(harness.snapshot().state, `${intent}/${terminal.state}`).toBe(terminal.state);
        expect(harness.snapshot().transitions[intent], `${intent}/${terminal.state}`).toEqual({ requested: 1, actual: 0 });
        expect(harness.snapshot().counters.transitions, `${intent}/${terminal.state}`).toBe(0);
      }
    }
  });

  it("ignores obsolete teardown responses and reconstructs durable truth", () => {
    const result = runSpec10SaveScenario(SPEC_10_SAVE_SCENARIOS.find((scenario) => scenario.id === "teardown_late_commit")!);
    expect(result.timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "topology", observation: "teardown" }),
      expect.objectContaining({ kind: "durable", observation: "committed", revision: 1 }),
      expect.objectContaining({ kind: "response", observation: "ignored_obsolete" }),
      expect.objectContaining({ kind: "topology", observation: "reload" }),
      expect.objectContaining({ kind: "workspace_read", observation: "committed_current", revision: 1 }),
    ]));
    expect(result.ui_state).toBe("saved");
    expect(result.acknowledged_value_digest).toBe(result.persisted_readback?.value_digest);
  });
});
