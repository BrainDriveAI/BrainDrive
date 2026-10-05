import { execFile, fork } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { ensureGitReady } from "../git.js";
import { canonicalInputDigest } from "../app-platform/contracts/common.js";
import { ResumeDomainService } from "./service.js";
import { ResumeDataStore } from "./store.js";
import { authority, proposalInput, testGrant } from "./test-helpers.js";

const roots: string[] = [];
const workerPath = fileURLToPath(new URL("./resume-data-process-worker.ts", import.meta.url));
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(hooks: ConstructorParameters<typeof ResumeDataStore>[2] = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-m2-"));
  roots.push(root);
  const store = new ResumeDataStore(root, undefined, hooks, false);
  await store.initialize(testGrant().owner_id);
  const service = new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z"));
  return { root, store, service };
}

function recoveryInput(value: string, overrides: Record<string, unknown> = {}) {
  const sessionId = "11000000-0000-4000-8000-000000000001";
  return {
    expected_revision: null,
    session_id: sessionId,
    current_topic: "contact",
    completed_topics: [],
    skipped_topics: [],
    slot: {
      session_id: sessionId,
      job_fact_revision_id: null,
      question_id: "contact-question",
      field_id: "answer",
    },
    value,
    value_digest: canonicalInputDigest(value),
    ...overrides,
  };
}

function runWorker(root: string, operationId: string, value: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [root, operationId, value], {
      execArgv: ["--import", "tsx"],
      silent: true,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}: ${stderr}`)));
  });
}

describe("Resume data M2 atomic record store", () => {
  it("creates and verifies an empty manifest and catalog for missing state", async () => {
    const { store } = await setup();
    expect(JSON.parse(await readFile(path.join(store.namespaceRoot, "manifest.json"), "utf8"))).toEqual({
      active_catalog: "catalog.json",
      data_schema_version: 4,
      integrity_algorithm: "sha256",
      manifest_version: 1,
      records_directory: "records",
      transactions_directory: "transactions",
    });
    expect(await store.integrityScan()).toEqual({
      status: "verified",
      generation: 0,
      revision_count: 0,
      operation_count: 0,
      orphan_revision_count: 0,
      staged_transaction_count: 0,
    });
  });

  it("serializes catalog generations across separate processes", async () => {
    const { root, store } = await setup();
    await Promise.all([
      runWorker(root, crypto.randomUUID(), "process one"),
      runWorker(root, crypto.randomUUID(), "process two"),
    ]);

    const reopened = new ResumeDataStore(root, undefined, {}, false);
    await reopened.initialize(testGrant().owner_id);
    expect(await reopened.list("career_fact")).toHaveLength(2);
    expect((await reopened.catalog()).generation).toBe(2);
    expect((await store.integrityScan()).status).toBe("verified");
  }, 15_000);

  it("rejects a live lease and reclaims stale and expired leases without exposing lease metadata", async () => {
    const { root, store } = await setup();
    const leasePath = path.join(store.namespaceRoot, ".store.lock");
    const lease = {
      lease_version: 1,
      lease_id: crypto.randomUUID(),
      owner_pid: process.pid,
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    await writeFile(leasePath, `${JSON.stringify(lease)}\n`, "utf8");

    const blocked = new ResumeDataStore(root, undefined, { leaseWaitMs: 20, leaseRetryMs: 5 }, false);
    await expect(blocked.initialize(testGrant().owner_id)).rejects.toMatchObject({ code: "recoverable_internal_failure" });

    await writeFile(leasePath, `${JSON.stringify({ ...lease, expires_at: new Date(Date.now() - 1_000).toISOString() })}\n`, "utf8");
    const recovered = new ResumeDataStore(root, undefined, { leaseWaitMs: 100, leaseRetryMs: 5 }, false);
    await recovered.initialize(testGrant().owner_id);
    expect((await recovered.integrityScan()).status).toBe("verified");

    await writeFile(leasePath, `${JSON.stringify({ ...lease, owner_pid: 999_999_999 })}\n`, "utf8");
    const staleRecovered = new ResumeDataStore(root, undefined, { leaseWaitMs: 100, leaseRetryMs: 5 }, false);
    await staleRecovered.initialize(testGrant().owner_id);
    expect((await staleRecovered.integrityScan()).status).toBe("verified");
  });

  it("reclaims a lease from an earlier runtime instance even when its PID was reused", async () => {
    const { root, store } = await setup();
    const leasePath = path.join(store.namespaceRoot, ".store.lock");
    await writeFile(leasePath, `${JSON.stringify({
      lease_version: 2,
      lease_id: crypto.randomUUID(),
      owner_pid: process.pid,
      owner_instance_id: crypto.randomUUID(),
      owner_process_start_ticks: null,
      acquired_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 120_000).toISOString(),
    })}\n`, "utf8");

    const recovered = new ResumeDataStore(root, undefined, { leaseWaitMs: 100, leaseRetryMs: 5 }, false);
    await recovered.initialize(testGrant().owner_id);
    expect((await recovered.integrityScan()).status).toBe("verified");
  });

  it.each([
    ["afterTransactionStaged"],
    ["beforeRecordPromote"],
    ["afterRecordsPromoted"],
    ["beforeCatalogCommit"],
  ] as const)("keeps the prior generation and reconciles a %s fault", async (faultPoint) => {
    let fail = true;
    const { root, store, service } = await setup({
      [faultPoint]: async () => {
        if (fail) {
          fail = false;
          throw new Error(`synthetic ${faultPoint}`);
        }
      },
    });
    const operationId = crypto.randomUUID();
    await expect(service.proposeFact(proposalInput(), authority("career.facts.propose", operationId))).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    expect((await store.catalog()).generation).toBe(0);

    const reopened = new ResumeDataStore(root, undefined, {}, false);
    await reopened.initialize(testGrant().owner_id);
    expect((await reopened.catalog()).generation).toBe(0);
    expect(await reopened.list("career_fact")).toHaveLength(0);
    expect(await readdir(path.join(reopened.namespaceRoot, "transactions"))).toHaveLength(0);
    expect((await reopened.integrityScan()).orphan_revision_count).toBe(0);
  });

  it("recovers the committed result after a post-switch fault without duplicating it", async () => {
    let fail = true;
    const { store, service } = await setup({
      afterCatalogCommit: async () => {
        if (fail) {
          fail = false;
          throw new Error("synthetic post-switch crash");
        }
      },
    });
    const operationId = crypto.randomUUID();
    const auth = authority("career.facts.propose", operationId);
    await expect(service.proposeFact(proposalInput(), auth)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    const replay = await service.proposeFact(proposalInput(), auth);
    expect(replay.reused).toBe(true);
    expect((await store.catalog()).generation).toBe(1);
    expect(await store.list("career_fact")).toHaveLength(1);
  });

  it("reconciles a response-lost recovery save to exactly one acknowledged revision", async () => {
    let fail = true;
    const { store, service } = await setup({
      afterCatalogCommit: async () => {
        if (fail) {
          fail = false;
          throw new Error("synthetic recovery response loss");
        }
      },
    });
    const operationId = crypto.randomUUID();
    const operationAuthority = authority("resume.definitions.write", operationId);
    const input = recoveryInput("exact response-lost value\nRésumé 🚀");

    await expect(service.saveInterviewRecovery(input, operationAuthority)).rejects.toMatchObject({ code: "recoverable_internal_failure" });
    const queried = await store.operation(operationId, testGrant().installation_id);
    const replay = await service.saveInterviewRecovery(input, operationAuthority);

    expect(queried).toMatchObject({ record: { status: "committed", result_ref: replay.progress.metadata.revision_id } });
    expect(replay).toMatchObject({ reused: true, acknowledgement: { revision: 1, value_digest: canonicalInputDigest(input.value) } });
    expect(await store.list("interview_progress")).toHaveLength(1);
    expect((await store.catalog()).generation).toBe(1);
  });

  it("preserves the prior acknowledged recovery snapshot when a replacement fails before the switch", async () => {
    let failReplacement = false;
    const { root, store, service } = await setup({
      beforeCatalogCommit: async () => {
        if (failReplacement) throw new Error("synthetic recovery pre-switch crash");
      },
    });
    const first = await service.saveInterviewRecovery(recoveryInput("prior acknowledged value"), authority("resume.definitions.write"));
    failReplacement = true;

    await expect(service.saveInterviewRecovery(recoveryInput("uncommitted replacement", {
      record_id: first.progress.metadata.record_id,
      expected_revision: 1,
    }), authority("resume.definitions.write"))).rejects.toMatchObject({ code: "recoverable_internal_failure" });

    const reopened = new ResumeDataStore(root, undefined, {}, false);
    await reopened.initialize(testGrant().owner_id);
    expect(await reopened.readHead(first.progress.metadata.record_id)).toMatchObject({
      metadata: { revision: 1 },
      recovery_draft: { value: "prior acknowledged value", acknowledged_revision: 1 },
    });
    expect((await reopened.catalog()).generation).toBe(1);
    expect(await store.list("interview_progress")).toHaveLength(1);
  });

  it("binds a committed operation identity to its installation", async () => {
    const { service } = await setup();
    const operationId = crypto.randomUUID();
    await service.proposeFact(proposalInput(), authority("career.facts.propose", operationId));
    await expect(service.proposeFact(
      proposalInput(),
      authority("career.facts.propose", operationId, {
        grant: testGrant({ installation_id: crypto.randomUUID() }),
      }),
    )).rejects.toMatchObject({ code: "idempotency_conflict" });
  });

  it("leaves the active generation unchanged when cancellation arrives before the switch", async () => {
    let cancelled = false;
    const { store, service } = await setup({ beforeCatalogCommit: async () => { cancelled = true; } });
    const operationId = crypto.randomUUID();
    await expect(service.proposeFact(
      proposalInput(),
      authority("career.facts.propose", operationId, { isCancelled: () => cancelled }),
    )).rejects.toMatchObject({ code: "cancelled" });
    expect((await store.catalog()).generation).toBe(0);
    await expect(store.operation(operationId, testGrant().installation_id)).rejects.toMatchObject({ code: "not_found_within_scope" });
  });

  it("returns the committed identity when cancellation arrives after the switch", async () => {
    let cancelled = false;
    const { store, service } = await setup({ afterCatalogCommit: async () => { cancelled = true; } });
    const operationId = crypto.randomUUID();
    const result = await service.proposeFact(
      proposalInput(),
      authority("career.facts.propose", operationId, { isCancelled: () => cancelled }),
    );
    expect(result.reused).toBe(false);
    expect((await store.operation(operationId, testGrant().installation_id)).record).toMatchObject({
      status: "committed",
      commit_outcome: "committed",
      result_ref: result.fact.metadata.revision_id,
    });
  });

  it("fails closed when catalog or immutable revision integrity does not verify", async () => {
    const { store, service } = await setup();
    const result = await service.proposeFact(proposalInput(), authority("career.facts.propose"));
    const catalog = await store.catalog();
    const locator = catalog.revisions[result.fact.metadata.revision_id]!;
    const revisionPath = path.join(store.namespaceRoot, locator.relative_path);
    const revision = JSON.parse(await readFile(revisionPath, "utf8"));
    await writeFile(revisionPath, `${JSON.stringify({ ...revision, updated_at: "2026-08-08T12:00:00.000Z" })}\n`, "utf8");
    await expect(store.integrityScan()).rejects.toMatchObject({ code: "validation_failed" });

    const catalogPath = path.join(store.namespaceRoot, "catalog.json");
    const rawCatalog = JSON.parse(await readFile(catalogPath, "utf8"));
    await writeFile(catalogPath, `${JSON.stringify({ ...rawCatalog, generation: 99 })}\n`, "utf8");
    await expect(store.catalog()).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("treats Git checkpoint failure as redacted best-effort evidence after commit", async () => {
    const diagnostics: Array<{ event: string; details: Record<string, unknown> }> = [];
    const { root, store, service } = await setup({
      gitCheckpoint: async (memoryRoot) => {
        const namespaceRoot = path.join(memoryRoot, "apps", "resume-builder");
        await expect(access(path.join(namespaceRoot, ".store.lock"))).rejects.toMatchObject({ code: "ENOENT" });
        expect(await readdir(path.join(namespaceRoot, "transactions"))).toHaveLength(0);
        throw Object.assign(new Error("secret content at /private/owner/file"), { code: "EIO" });
      },
      onDiagnostic: (event, details) => { diagnostics.push({ event, details }); },
    });
    diagnostics.length = 0;
    await service.proposeFact(proposalInput("must never appear in diagnostics"), authority("career.facts.propose"));
    expect((await store.catalog()).generation).toBe(1);
    expect(diagnostics).toEqual([{ event: "resume_data_git_checkpoint_failed", details: { error_code: "EIO" } }]);
    expect(JSON.stringify(diagnostics)).not.toContain(root);
    expect(JSON.stringify(diagnostics)).not.toContain("must never appear");
  });

  it("checkpoints committed state without tracking the lease or transaction stage", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "bd-resume-m2-git-"));
    roots.push(root);
    await Promise.all(["conversations", "documents", "preferences"].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
    await ensureGitReady(root);
    const store = new ResumeDataStore(root);
    await store.initialize(testGrant().owner_id);
    const service = new ResumeDomainService(store, () => new Date("2026-08-07T12:00:00.000Z"));
    await service.proposeFact(proposalInput(), authority("career.facts.propose"));

    const git = async (...args: string[]) => (await execFileAsync("git", ["-c", `safe.directory=${root}`, "-C", root, ...args])).stdout;
    const tracked = await git("ls-files");
    expect(tracked).toContain("apps/resume-builder/catalog.json");
    expect(tracked).toContain("apps/resume-builder/manifest.json");
    expect(tracked).toContain("apps/resume-builder/records/");
    expect(tracked).not.toContain(".store.lock");
    expect(tracked).not.toContain("/transactions/");
    expect(await git("status", "--porcelain")).toBe("");
  });

  it("removes invalid transaction stages and invisible orphan revisions during restart", async () => {
    const { root, store } = await setup();
    const transactionId = crypto.randomUUID();
    const transactionRoot = path.join(store.namespaceRoot, "transactions", transactionId);
    const orphanPath = path.join(store.namespaceRoot, "records", "source", crypto.randomUUID(), `${crypto.randomUUID()}.json`);
    await mkdir(transactionRoot, { recursive: true });
    await writeFile(path.join(transactionRoot, "transaction.json"), "{partial", "utf8");
    await mkdir(path.dirname(orphanPath), { recursive: true });
    await writeFile(orphanPath, "{}\n", "utf8");

    const reopened = new ResumeDataStore(root, undefined, {}, false);
    await reopened.initialize(testGrant().owner_id);
    expect((await reopened.integrityScan()).orphan_revision_count).toBe(0);
    expect(await readdir(path.join(reopened.namespaceRoot, "transactions"))).toHaveLength(0);
  });

  it("fails closed on a partial active catalog pointer", async () => {
    const { root, store } = await setup();
    await writeFile(path.join(store.namespaceRoot, "catalog.json"), "{partial", "utf8");
    const reopened = new ResumeDataStore(root, undefined, {}, false);
    await expect(reopened.initialize(testGrant().owner_id)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("preserves the active generation on a real transaction-filesystem error", async () => {
    const { store, service } = await setup();
    const transactionsPath = path.join(store.namespaceRoot, "transactions");
    await rm(transactionsPath, { recursive: true, force: true });
    await writeFile(transactionsPath, "not-a-directory\n", "utf8");

    const error = await service.proposeFact(proposalInput(), authority("career.facts.propose")).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "recoverable_internal_failure" });
    expect(String((error as Error).message)).not.toContain(store.namespaceRoot);
    expect((await store.catalog()).generation).toBe(0);
  });
});
