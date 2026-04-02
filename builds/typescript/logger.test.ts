import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditLog, configureAuditFileSink, disableAuditFileSink } from "./logger.js";

describe("logger audit file sink", () => {
  let tempRoot: string | null = null;
  let stdoutSpy: { mockRestore: () => void } | null = null;
  let stderrSpy: { mockRestore: () => void } | null = null;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "braindrive-logger-"));
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    disableAuditFileSink();
  });

  afterEach(async () => {
    disableAuditFileSink();
    stdoutSpy?.mockRestore();
    stderrSpy?.mockRestore();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes sanitized audit logs to stdout and memory diagnostics jsonl", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    configureAuditFileSink(tempRoot, {
      maxFileBytes: 1024 * 1024,
      retentionDays: 14,
    });

    auditLog("secret.resolve", {
      token: "abc123",
      api_key: "raw-value",
      message: "Bearer sk-abc1234567890 should be redacted",
    });

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(tempRoot, "diagnostics", "audit", `${today}.jsonl`);
    const stored = await readFile(logPath, "utf8");

    expect(stored).toContain("\"event\":\"secret.resolve\"");
    expect(stored).toContain("\"token\":\"[REDACTED]\"");
    expect(stored).toContain("\"api_key\":\"[REDACTED]\"");
    expect(stored).toContain("Bearer [REDACTED]");
    expect(stored).not.toContain("sk-abc1234567890");
  });

  it("rotates jsonl files when the size cap is reached", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    configureAuditFileSink(tempRoot, {
      maxFileBytes: 220,
      retentionDays: 14,
    });

    for (let index = 0; index < 6; index += 1) {
      auditLog("rotation.test", {
        index,
        message: `line-${index}-${"x".repeat(80)}`,
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const basePath = path.join(tempRoot, "diagnostics", "audit", `${today}.jsonl`);
    const rotatedPath = path.join(tempRoot, "diagnostics", "audit", `${today}.1.jsonl`);

    const baseStat = await stat(basePath);
    const rotatedStat = await stat(rotatedPath);

    expect(baseStat.size).toBeGreaterThan(0);
    expect(rotatedStat.size).toBeGreaterThan(0);
  });

  it("removes audit files outside the configured retention window", async () => {
    if (!tempRoot) {
      throw new Error("Missing temp root");
    }

    const auditDir = path.join(tempRoot, "diagnostics", "audit");
    await mkdir(auditDir, { recursive: true });

    const oldDate = formatIsoDateDaysAgo(7);
    const recentDate = formatIsoDateDaysAgo(0);
    await writeFile(path.join(auditDir, `${oldDate}.jsonl`), "{\"event\":\"old\"}\n", "utf8");
    await writeFile(path.join(auditDir, `${recentDate}.jsonl`), "{\"event\":\"new\"}\n", "utf8");

    configureAuditFileSink(tempRoot, {
      maxFileBytes: 1024 * 1024,
      retentionDays: 2,
    });

    await expect(stat(path.join(auditDir, `${oldDate}.jsonl`))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(path.join(auditDir, `${recentDate}.jsonl`))).resolves.toBeTruthy();
  });
});

function formatIsoDateDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}
