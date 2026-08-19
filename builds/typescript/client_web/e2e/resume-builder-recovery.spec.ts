import { readFile, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

type RecoveryInput = {
  expected_revision: number | null;
  slot: {
    session_id: string;
    job_fact_revision_id: string | null;
    question_id: string;
    field_id: string;
  };
  value: string;
  value_digest: string;
};

type RecoveryRecord = {
  record_type: "interview_progress";
  metadata: { record_id: string; revision_id: string; revision: number };
  status: "in_progress";
  current_topic: "contact";
  completed_topics: string[];
  skipped_topics: string[];
  draft_state: "declared_draft";
  session_id: string;
  recovery_draft: RecoveryInput["slot"] & {
    slot: RecoveryInput["slot"];
    value: string;
    value_digest: string;
    acknowledged_revision: number;
    saved_at: string;
  };
};

type RecoveryResponse = {
  progress: RecoveryRecord;
  acknowledgement: {
    revision_id: string;
    revision: number;
    saved_at: string;
    value_digest: string;
  };
  reused: false;
};

type RecoveryBinding = {
  slot: RecoveryInput["slot"];
  value: string;
  valueDigest: string;
  expectedRevision: number | null;
  operationId: string;
  editGeneration: number;
};

type RecoverySnapshot = {
  status: string;
  value: string;
  valueDigest: string | null;
  acknowledgementDigest: string | null;
  acknowledgementRevision: number | null;
  operationId: string | null;
  editGeneration: number;
  resourceGeneration: number;
  serverValue: string | null;
  visibleStatus: string;
  retryVisible: boolean;
  discardVisible: boolean;
  localVisible: boolean;
  serverVisible: boolean;
};

type RecoveryHarness = {
  reset(): void;
  activate(value: string, fieldId?: string): Promise<RecoveryInput["slot"]>;
  flush(force?: boolean): Promise<boolean>;
  guard(intent: string, label: string, transition: () => void | Promise<void>): Promise<boolean>;
  binding(): RecoveryBinding;
  digest(value: string): string;
  responseFor(input: { recovery: RecoveryInput }, operationId: string): RecoveryResponse;
  projectionFor(response: RecoveryResponse, operationId: string): unknown;
  pendingProjection(): unknown;
  snapshot(): RecoverySnapshot;
  setStatus(status: string): void;
  reconcile(binding: RecoveryBinding, startedAt: number, generation: number): Promise<{ state: string }>;
  restore(record: RecoveryRecord): void;
  verifyRestored(): Promise<void>;
  dispatchTeardown(): void;
  installBinding(binding: RecoveryBinding): void;
  now(): number;
  advance(ms: number): void;
  clearRecoveryAfterTransition(): void;
};

type HostCapability = (
  name: string,
  input: Record<string, unknown>,
  operationId: string | null,
  timeout: number | null,
) => Promise<unknown>;

type HarnessWindow = Window & typeof globalThis & {
  __resumeRecoveryHarness: RecoveryHarness;
  __resumeHostCapability: HostCapability;
};

const CAPABILITY_SOURCE = "async function capability(name,input,requestOperationId=null,timeout=null){const response=await request(\"capability.call\",{capability:name,input,...(requestOperationId?{request_operation_id:requestOperationId}:{})},{timeout});return response?.result??response}";
const WAIT_RECOVERY_SOURCE = "function waitRecovery(ms,generation){return new Promise(resolve=>{if(generation!==state.resourceGeneration){resolve(false);return}const pending={timer:null,resolve},timer=setTimeout(()=>{state.recoveryPollTimers.delete(pending);resolve(generation===state.resourceGeneration)},Math.max(0,ms));pending.timer=timer;state.recoveryPollTimers.add(pending)})}";

async function loadRecoveryHarness(page: Page): Promise<void> {
  const source = await readFile(new URL("../../../resume_builder/resources/main.html", import.meta.url), "utf8");
  expect(source).toContain(CAPABILITY_SOURCE);
  expect(source).toContain(WAIT_RECOVERY_SOURCE);
  expect(source).toContain("connectBridge().catch(fail);");
  const injectedCapability = "async function capability(name,input,requestOperationId=null,timeout=null){return await window.__resumeHostCapability(name,input,requestOperationId,timeout)}";
  const injectedWait = "function waitRecovery(ms,generation){if(generation!==state.resourceGeneration)return Promise.resolve(false);recoveryHarnessAdvance(Math.max(0,ms));return Promise.resolve(generation===state.resourceGeneration)}";
  const injectedHarness = `
    let recoveryHarnessNow=0;
    function recoveryHarnessAdvance(ms){recoveryHarnessNow+=ms}
    Date.now=()=>recoveryHarnessNow;
    function recoveryHarnessRender(){panel.innerHTML='<div id="recovery-root">'+recoveryStatusMarkup()+'</div>';bindRecoveryActions()}
    function recoveryHarnessReset(){
      cancelRecoveryTimer();cancelRecoveryPolls();
      recoveryHarnessNow=0;state.resourceGeneration=1;state.sessionId="00000000-0000-4000-8000-000000000101";state.topic="contact";state.jobDimension=null;
      state.workspace={interview:[],definitions:[],strategies:[],coverage:[]};
      state.recoveryAttempts.clear();state.recoveryGuards.clear();state.completedRecoveryGuards.clear();
      state.recoveryFieldQueue=Promise.resolve();state.recoveryTransitionQueue=Promise.resolve();state.recovery=emptyRecovery();
      recoveryHarnessRender();
    }
    function recoveryHarnessResponse(input,operationId){
      const recovery=input.recovery,revision=(recovery.expected_revision??0)+1,savedAt="2026-08-15T12:00:00.000Z",revisionId=uuid();
      const progress={record_type:"interview_progress",metadata:{record_id:"00000000-0000-4000-8000-000000000102",revision_id:revisionId,revision},status:"in_progress",current_topic:"contact",completed_topics:[],skipped_topics:[],draft_state:"declared_draft",session_id:recovery.session_id,recovery_draft:{slot:recovery.slot,value:recovery.value,value_digest:recovery.value_digest,acknowledged_revision:revision,saved_at:savedAt}};
      return {progress,acknowledgement:{revision_id:revisionId,revision,saved_at:savedAt,value_digest:recovery.value_digest},reused:false};
    }
    function recoveryHarnessProjection(response,operationId){return {results:[response.progress],recovery_reconciliation:{lifecycle_state:"committed",host_operation_settled:true,operation:{state:"committed",operation_id:operationId,value_digest:response.acknowledgement.value_digest,revision:response.acknowledgement.revision}}}}
    window.__resumeRecoveryHarness={
      reset:recoveryHarnessReset,
      async activate(value,fieldId="answer"){const slot=recoverySlot("contact",fieldId);await activateRecoveryField(slot,value);cancelRecoveryTimer();return slot},
      flush:flushRecovery,
      guard:guardedRecoveryTransitionAfterFields,
      binding(){const recovery=state.recovery,p=progress(),expectedRevision=p.record?.metadata?.revision??null,valueDigest=recovery.valueDigest||recoveryDigest(recovery.value);return {slot:{...recovery.slot},value:recovery.value,valueDigest,expectedRevision,operationId:recoveryOperationId(recovery.slot,valueDigest,expectedRevision),editGeneration:recovery.editGeneration}},
      digest:recoveryDigest,
      responseFor:recoveryHarnessResponse,
      projectionFor:recoveryHarnessProjection,
      pendingProjection(){return {recovery_reconciliation:{lifecycle_state:"pending",host_operation_settled:false,operation:{state:"not_found_within_scope"}}}},
      snapshot(){const recovery=state.recovery;return {status:recovery.status,value:recovery.value,valueDigest:recovery.valueDigest,acknowledgementDigest:recovery.ackValueDigest,acknowledgementRevision:recovery.ackRevision,operationId:recovery.operationId,editGeneration:recovery.editGeneration,resourceGeneration:state.resourceGeneration,serverValue:recovery.serverDraft?.value||null,visibleStatus:document.getElementById("recovery-status")?.textContent||"",retryVisible:Boolean(document.getElementById("recovery-retry")),discardVisible:Boolean(document.getElementById("recovery-discard")),localVisible:Boolean(document.getElementById("recovery-local")),serverVisible:Boolean(document.getElementById("recovery-server"))}},
      setStatus(status){state.recovery.status=status;updateRecoveryStatus()},
      reconcile:reconcileRecovery,
      restore(record){state.workspace.interview=[record];restoreRecovery(record);recoveryHarnessRender()},
      verifyRestored:verifyRestoredRecoveryOperation,
      dispatchTeardown(){window.postMessage({jsonrpc:"2.0",id:"synthetic-teardown",method:"ui/resource-teardown"},"*")},
      installBinding(binding){state.recovery=emptyRecovery({slot:{...binding.slot},value:binding.value,valueDigest:binding.valueDigest,status:"reconciling",operationId:binding.operationId,expectedRevision:binding.expectedRevision,editGeneration:binding.editGeneration});recoveryHarnessRender()},
      now(){return recoveryHarnessNow},
      advance:recoveryHarnessAdvance,
      clearRecoveryAfterTransition(){state.recovery=emptyRecovery();recoveryHarnessRender()}
    };
    recoveryHarnessReset();
  `;
  const instrumented = source
    .replace(CAPABILITY_SOURCE, injectedCapability)
    .replace(WAIT_RECOVERY_SOURCE, injectedWait)
    .replace("connectBridge().catch(fail);", injectedHarness);
  await page.setContent(instrumented, { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.evaluate(() => typeof (window as HarnessWindow).__resumeRecoveryHarness)).toBe("object");
}

test.describe("Resume Builder browser recovery matrix", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    test.skip(isMobile, "The save timing/fault matrix runs once in desktop Chrome; responsive behavior has separate mobile projects.");
    await loadRecoveryHarness(page);
  });

  test("covers timing, loss, idempotency, stale values, terminal choices, and reconnect reconstruction", async ({ page }, testInfo) => {
    test.setTimeout(90_000);

    const timingRows = await page.evaluate(async () => {
      const browser = window as HarnessWindow;
      const harness = browser.__resumeRecoveryHarness;
      const rows = [
        { id: "observed_630ms", commitAt: 630, responseLost: false, maskFirstRead: true },
        { id: "observed_741ms", commitAt: 741, responseLost: false, maskFirstRead: false },
        { id: "later_in_policy", commitAt: 5_000, responseLost: false, maskFirstRead: false },
        { id: "response_loss_after_commit", commitAt: 741, responseLost: true, maskFirstRead: false },
      ];
      const results = [];
      for (const row of rows) {
        harness.reset();
        await harness.activate(`synthetic-${row.id}`);
        let committed: { response: RecoveryResponse; operationId: string } | null = null;
        let operationReads = 0;
        let workspaceReads = 0;
        let writeCalls = 0;
        let commitAt = 0;
        const statuses: string[] = [];
        const observer = new MutationObserver(() => statuses.push(harness.snapshot().visibleStatus));
        observer.observe(document.getElementById("panel")!, { childList: true, subtree: true, characterData: true });
        browser.__resumeHostCapability = async (name, input, operationId) => {
          if (name === "resume.definitions.write") {
            writeCalls += 1;
            const response = harness.responseFor(input as { recovery: RecoveryInput }, operationId!);
            commitAt = harness.now() + row.commitAt;
            harness.advance(row.responseLost ? row.commitAt : 500);
            if (harness.now() >= commitAt) committed = { response, operationId: operationId! };
            throw { error: row.responseLost ? "response_lost" : "deadline_exceeded", ambiguous: true };
          }
          if (name === "resume.operations.read") {
            operationReads += 1;
            if (row.maskFirstRead && operationReads === 1) throw { error: "not_found_within_scope" };
            if (!committed && harness.now() >= commitAt) {
              const binding = harness.binding();
              const response = harness.responseFor({ recovery: {
                expected_revision: binding.expectedRevision,
                slot: binding.slot,
                value: binding.value,
                value_digest: binding.valueDigest,
              } }, binding.operationId);
              committed = { response, operationId: binding.operationId };
            }
            if (!committed) return harness.pendingProjection();
            return harness.projectionFor(committed.response, committed.operationId);
          }
          if (name === "resume.definitions.read") {
            workspaceReads += 1;
            return { interview: committed ? [committed.response.progress] : [] };
          }
          throw new Error(`Unexpected capability ${name}`);
        };
        const startedAt = harness.now();
        const saved = await harness.flush(true);
        observer.disconnect();
        results.push({
          id: row.id,
          saved,
          elapsedMs: harness.now() - startedAt,
          writeCalls,
          operationReads,
          workspaceReads,
          status: harness.snapshot().status,
          sawStillSaving: statuses.some((value) => value.includes("Still saving")),
        });
      }
      return results;
    });

    expect(timingRows).toEqual([
      expect.objectContaining({ id: "observed_630ms", saved: true, writeCalls: 1, operationReads: 2, workspaceReads: 0, status: "saved", sawStillSaving: true }),
      expect.objectContaining({ id: "observed_741ms", saved: true, writeCalls: 1, operationReads: 2, workspaceReads: 0, status: "saved", sawStillSaving: true }),
      expect.objectContaining({ id: "later_in_policy", saved: true, writeCalls: 1, operationReads: 7, workspaceReads: 0, status: "saved", sawStillSaving: true }),
      expect.objectContaining({ id: "response_loss_after_commit", saved: true, writeCalls: 1, operationReads: 1, workspaceReads: 0, status: "saved", sawStillSaving: true }),
    ]);
    expect(timingRows[0].elapsedMs).toBeGreaterThanOrEqual(740);
    expect(timingRows[1].elapsedMs).toBeGreaterThanOrEqual(740);
    expect(timingRows[2].elapsedMs).toBeGreaterThanOrEqual(8_450);

    const guarded = await page.evaluate(async () => {
      const browser = window as HarnessWindow;
      const harness = browser.__resumeRecoveryHarness;
      const intents = ["submit", "save_answer", "complete_for_now", "pause", "back", "stage:fact_review"];
      const results = [];
      for (const intent of intents) {
        harness.reset();
        await harness.activate(`synthetic-${intent}`);
        let writes = 0;
        let transitions = 0;
        browser.__resumeHostCapability = async (name, input, operationId) => {
          if (name !== "resume.definitions.write") throw new Error(`Unexpected capability ${name}`);
          writes += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return harness.responseFor(input as { recovery: RecoveryInput }, operationId!);
        };
        const transition = () => { transitions += 1; };
        const requested = await Promise.all([
          harness.guard(intent, `finishing ${intent}`, transition),
          harness.guard(intent, `finishing ${intent}`, transition),
        ]);
        results.push({ intent, requested: requested.length, successful: requested.filter(Boolean).length, writes, transitions, status: harness.snapshot().status });
      }
      return results;
    });
    expect(guarded).toHaveLength(6);
    for (const row of guarded) expect(row).toMatchObject({ requested: 2, successful: 2, writes: 1, transitions: 1, status: "saved" });

    const staleValue = await page.evaluate(async () => {
      const browser = window as HarnessWindow;
      const harness = browser.__resumeRecoveryHarness;
      harness.reset();
      await harness.activate("synthetic-old-value");
      let firstResolve: ((value: RecoveryResponse) => void) | null = null;
      let firstInput: { recovery: RecoveryInput } | null = null;
      const operations: string[] = [];
      let writes = 0;
      let stateBeforeNewCommit: RecoverySnapshot | null = null;
      browser.__resumeHostCapability = async (name, input, operationId) => {
        if (name !== "resume.definitions.write") throw new Error(`Unexpected capability ${name}`);
        writes += 1;
        operations.push(operationId!);
        if (writes === 1) {
          firstInput = input as { recovery: RecoveryInput };
          return await new Promise<RecoveryResponse>((resolve) => { firstResolve = resolve; });
        }
        stateBeforeNewCommit = harness.snapshot();
        return harness.responseFor(input as { recovery: RecoveryInput }, operationId!);
      };
      const save = harness.flush(true);
      while (!firstResolve || !firstInput) await new Promise((resolve) => setTimeout(resolve, 0));
      await harness.activate("synthetic-new-value");
      firstResolve(harness.responseFor(firstInput, operations[0]));
      const saved = await save;
      return { saved, writes, operations, stateBeforeNewCommit, final: harness.snapshot() };
    });
    expect(staleValue.saved).toBe(true);
    expect(staleValue.writes).toBe(2);
    expect(new Set(staleValue.operations).size).toBe(2);
    expect(staleValue.stateBeforeNewCommit).toMatchObject({ value: "synthetic-new-value", status: "saving", acknowledgementDigest: null });
    expect(staleValue.final).toMatchObject({ value: "synthetic-new-value", status: "saved", acknowledgementRevision: 2 });
    expect(staleValue.final.valueDigest).toBe(staleValue.final.acknowledgementDigest);

    const terminalRows = await page.evaluate(async () => {
      const browser = window as HarnessWindow;
      const harness = browser.__resumeRecoveryHarness;
      const results: Record<string, unknown> = {};

      harness.reset();
      await harness.activate("synthetic-denied-value");
      let deniedTransitions = 0;
      browser.__resumeHostCapability = async () => { throw { error: "denied" }; };
      const denied = await harness.guard("save_answer", "saving this answer", () => { deniedTransitions += 1; });
      await Promise.resolve();
      results.denied = { guard: denied, transitions: deniedTransitions, snapshot: harness.snapshot() };

      harness.reset();
      await harness.activate("synthetic-local-value");
      let conflictTransitions = 0;
      const binding = harness.binding();
      const serverInput = { recovery: { expected_revision: null, slot: binding.slot, value: "synthetic-server-value", value_digest: harness.digest("synthetic-server-value") } };
      const serverRecord = harness.responseFor(serverInput, "00000000-0000-4000-8000-000000000103").progress;
      browser.__resumeHostCapability = async (name) => {
        if (name === "resume.definitions.write") throw { error: "conflict" };
        if (name === "resume.definitions.read") return { interview: [serverRecord] };
        throw new Error(`Unexpected capability ${name}`);
      };
      const conflict = await harness.guard("complete_for_now", "completing for now", () => { conflictTransitions += 1; });
      await Promise.resolve();
      results.conflict = { guard: conflict, transitions: conflictTransitions, snapshot: harness.snapshot() };

      harness.reset();
      await harness.activate("synthetic-cancelled-value");
      let cancelledTransitions = 0;
      browser.__resumeHostCapability = async () => { throw { error: "cancelled" }; };
      const cancelled = await harness.guard("pause", "pausing", () => { cancelledTransitions += 1; });
      results.cancelled = { guard: cancelled, transitions: cancelledTransitions, snapshot: harness.snapshot() };

      harness.reset();
      await harness.activate("synthetic-terminal-value");
      const terminalBinding = harness.binding();
      harness.setStatus("reconciling");
      let terminalReads = 0;
      let terminalWorkspaceReads = 0;
      browser.__resumeHostCapability = async (name) => {
        if (name === "resume.operations.read") {
          terminalReads += 1;
          return { recovery_reconciliation: { lifecycle_state: "failed", host_operation_settled: true, operation: { state: "failed" } } };
        }
        if (name === "resume.definitions.read") {
          terminalWorkspaceReads += 1;
          return { interview: [] };
        }
        throw new Error(`Unexpected capability ${name}`);
      };
      const terminal = await harness.reconcile(terminalBinding, Date.now() - 120_001, harness.snapshot().resourceGeneration);
      results.terminal = { result: terminal, operationReads: terminalReads, workspaceReads: terminalWorkspaceReads, snapshot: harness.snapshot() };
      return results;
    });
    expect(terminalRows.denied).toMatchObject({ guard: false, transitions: 0, snapshot: { status: "not_saved", value: "synthetic-denied-value", retryVisible: true, discardVisible: true } });
    expect(terminalRows.conflict).toMatchObject({ guard: false, transitions: 0, snapshot: { status: "conflict", value: "synthetic-local-value", serverValue: "synthetic-server-value", localVisible: true, serverVisible: true, discardVisible: true } });
    expect(terminalRows.cancelled).toMatchObject({ guard: false, transitions: 0, snapshot: { value: "synthetic-cancelled-value" } });
    expect(terminalRows.terminal).toMatchObject({ result: { state: "not_saved" }, operationReads: 1, workspaceReads: 1, snapshot: { status: "not_saved", value: "synthetic-terminal-value" } });

    const reconnectRows = await page.evaluate(async () => {
      const browser = window as HarnessWindow;
      const harness = browser.__resumeRecoveryHarness;
      harness.reset();
      await harness.activate("synthetic-teardown-value");
      const binding = harness.binding();
      let releaseWrite: ((value: RecoveryResponse) => void) | null = null;
      let recoveryInput: { recovery: RecoveryInput } | null = null;
      let transitionCount = 0;
      browser.__resumeHostCapability = async (name, input) => {
        if (name !== "resume.definitions.write") throw new Error(`Unexpected capability ${name}`);
        recoveryInput = input as { recovery: RecoveryInput };
        return await new Promise<RecoveryResponse>((resolve) => { releaseWrite = resolve; });
      };
      const guardedSave = harness.guard("submit", "submitting", () => { transitionCount += 1; });
      while (!releaseWrite || !recoveryInput) await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 600));
      harness.dispatchTeardown();
      await new Promise((resolve) => setTimeout(resolve, 141));
      const committed = harness.responseFor(recoveryInput, binding.operationId);
      releaseWrite(committed);
      const obsolete = await guardedSave;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const afterTeardown = harness.snapshot();

      harness.installBinding(binding);
      let reconnectReads = 0;
      browser.__resumeHostCapability = async (name) => {
        if (name === "resume.operations.read") {
          reconnectReads += 1;
          if (reconnectReads === 1) throw { error: "not_found_within_scope" };
          return harness.projectionFor(committed, binding.operationId);
        }
        throw new Error(`Unexpected capability ${name}`);
      };
      const reconnected = await harness.reconcile(binding, Date.now(), harness.snapshot().resourceGeneration);

      harness.restore(committed.progress);
      const restoredBinding = harness.binding();
      browser.__resumeHostCapability = async (name) => {
        if (name !== "resume.operations.read") throw new Error(`Unexpected capability ${name}`);
        return harness.projectionFor(committed, restoredBinding.operationId);
      };
      await harness.verifyRestored();
      return { obsolete, transitionCount, afterTeardown, reconnectReads, reconnected, restored: harness.snapshot() };
    });
    expect(reconnectRows).toMatchObject({
      obsolete: false,
      transitionCount: 0,
      afterTeardown: { resourceGeneration: 2 },
      reconnectReads: 2,
      reconnected: { state: "saved" },
      restored: { status: "saved", value: "synthetic-teardown-value" },
    });

    const manifest = {
      evidence_contract_version: 1,
      fixture_scope: "synthetic_browser_recovery_matrix",
      timing_rows: timingRows.map(({ id, writeCalls, operationReads, workspaceReads, status, sawStillSaving }) => ({ id, writeCalls, operationReads, workspaceReads, status, sawStillSaving })),
      guarded_intents: guarded.map(({ intent, requested, writes, transitions, status }) => ({ intent, requested, writes, transitions, status })),
      stale_value: { writeCalls: staleValue.writes, distinctOperationIds: new Set(staleValue.operations).size, terminalStatus: staleValue.final.status, terminalRevision: staleValue.final.acknowledgementRevision },
      terminal_rows: {
        denied: "not_saved",
        conflict: "conflict",
        cancelled_transition_count: 0,
        final_readback: "not_saved",
      },
      topology_rows: { teardown_obsolete_transition_count: reconnectRows.transitionCount, reconnectOperationReads: reconnectRows.reconnectReads, restoredStatus: reconnectRows.restored.status },
      owner_content_retained: false,
      credentials_tokens_endpoints_private_paths_retained: false,
    };
    await writeFile(testInfo.outputPath("spec10-browser-recovery-matrix.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  });

  test("queues Complete for now when it is clicked immediately after submitting an answer", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const browser = window as HarnessWindow;
      const harness = browser.__resumeRecoveryHarness;
      harness.reset();
      await harness.activate("Synthetic evidence submitted quickly");
      const visibleStatuses: string[] = [];
      const observer = new MutationObserver(() => visibleStatuses.push(harness.snapshot().visibleStatus));
      observer.observe(document.getElementById("panel")!, { childList: true, subtree: true, characterData: true });
      browser.__resumeHostCapability = async (name, input, operationId) => {
        if (name !== "resume.definitions.write") throw new Error(`Unexpected capability ${name}`);
        await Promise.resolve();
        return harness.responseFor(input as { recovery: RecoveryInput }, operationId!);
      };
      const transitions: string[] = [];
      const submit = harness.guard("submit", "submitting this evidence", async () => {
        transitions.push("submit");
        harness.clearRecoveryAfterTransition();
      });
      const complete = harness.guard("complete_for_now", "completing for now", async () => {
        transitions.push("complete_for_now");
      });
      const settled = await Promise.all([submit, complete]);
      observer.disconnect();
      return { settled, transitions, visibleStatuses };
    });

    expect(result.settled).toEqual([true, true]);
    expect(result.transitions).toEqual(["submit", "complete_for_now"]);
    expect(result.visibleStatuses.some((status) => /submitting this evidence|completing for now/i.test(status))).toBe(true);
  });
});
