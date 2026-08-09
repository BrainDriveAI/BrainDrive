import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";

import type { z } from "zod";
import {
  EndpointDescriptorSchema,
  RuntimeDescriptorSchema,
  RuntimeIdentitySchema,
  SupervisorHealthResultSchema,
  SupervisorReadyResultSchema,
  SupervisorStartResultSchema,
  SupervisorStopResultSchema,
} from "../contracts/supervisor.js";
import { AppPlatformError } from "./errors.js";

export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;
export type RuntimeLaunchDescriptor = z.infer<typeof RuntimeDescriptorSchema> & { resolved_entrypoint: string };
export type StopReason = "disable" | "update" | "rollback" | "uninstall" | "revocation" | "shutdown" | "reconcile";
export type AppRuntimeConnection = { runtime: RuntimeIdentity; url: string; authorization: string };

export interface AppSupervisor {
  start(descriptor: RuntimeLaunchDescriptor, role?: "active" | "candidate"): Promise<z.infer<typeof SupervisorStartResultSchema>>;
  promoteCandidate?(runtime: RuntimeIdentity): void;
  awaitReadiness(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorReadyResultSchema>>;
  health(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorHealthResultSchema>>;
  stop(runtime: RuntimeIdentity, reason: StopReason): Promise<z.infer<typeof SupervisorStopResultSchema>>;
  inspect(installationId: string): RuntimeIdentity[];
  connectionFor(installationId: string): AppRuntimeConnection;
  close(): Promise<void>;
}

type RuntimeProcess = {
  descriptor: RuntimeLaunchDescriptor;
  runtime: RuntimeIdentity;
  child: ChildProcess;
  port: number;
  connectionToken: string;
  ready: boolean;
  expectedStop: boolean;
  restartAttempt: number;
  outputBytes: number;
};

type Options = { startupTimeoutMs?: number; stopGraceMs?: number; restartBackoffMs?: [number, number, number]; automaticRecovery?: boolean; healthIntervalMs?: number; audit?: (event: string, details: Record<string, unknown>) => void };

export class ProcessAppSupervisor implements AppSupervisor {
  private readonly records = new Map<string, RuntimeProcess>();
  private readonly candidates = new Map<string, RuntimeProcess>();
  private readonly failures = new Map<string, string>();
  private readonly startupTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly restartBackoffMs: [number, number, number];
  private readonly automaticRecovery: boolean;
  private readonly healthTimer: NodeJS.Timeout;
  private closing = false;
  private readonly audit: NonNullable<Options["audit"]>;
  startCount = 0;
  failNextReadiness = false;

  constructor(options: Options = {}) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
    this.stopGraceMs = options.stopGraceMs ?? 5_000;
    this.restartBackoffMs = options.restartBackoffMs ?? [1_000, 2_000, 4_000];
    this.automaticRecovery = options.automaticRecovery ?? true;
    this.audit = options.audit ?? (() => undefined);
    this.healthTimer = setInterval(() => { void this.checkReadyRuntimes(); }, options.healthIntervalMs ?? 5_000);
    this.healthTimer.unref();
  }

  async start(rawDescriptor: RuntimeLaunchDescriptor, role: "active" | "candidate" = "active"): Promise<z.infer<typeof SupervisorStartResultSchema>> {
    const { resolved_entrypoint, ...candidate } = rawDescriptor;
    const descriptor = RuntimeDescriptorSchema.parse(candidate);
    const records = role === "candidate" ? this.candidates : this.records;
    const prior = records.get(descriptor.installation_id);
    if (prior && prior.child.exitCode === null && prior.child.signalCode === null) {
      if (prior.descriptor.package_digest !== descriptor.package_digest) throw new AppPlatformError("runtime_conflict", "A different runtime already owns this installation");
      return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "already_running", state: prior.ready ? "ready" : "starting", runtime: prior.runtime, error_code: null });
    }
    const port = await allocateLoopbackPort();
    const connectionToken = randomBytes(32).toString("base64url");
    const runtime = RuntimeIdentitySchema.parse({
      runtime_id: randomUUID(), installation_id: descriptor.installation_id, package_digest: descriptor.package_digest,
      runtime_generation: (prior?.runtime.runtime_generation ?? 0) + 1,
      endpoint_token_generation: (prior?.runtime.endpoint_token_generation ?? 0) + 1,
    });
    const child = spawn(process.execPath, [resolved_entrypoint], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: path.dirname(resolved_entrypoint),
      env: {
        BRAINDRIVE_APP_CONNECTION_TOKEN: connectionToken,
        BRAINDRIVE_APP_ID: descriptor.app_id,
        BRAINDRIVE_INSTALLATION_ID: descriptor.installation_id,
        BRAINDRIVE_PACKAGE_DIGEST: descriptor.package_digest,
        BRAINDRIVE_ENDPOINT_BIND: `127.0.0.1:${port}`,
      },
    });
    const record: RuntimeProcess = { descriptor: rawDescriptor, runtime, child, port, connectionToken, ready: false, expectedStop: false, restartAttempt: prior?.restartAttempt ?? 0, outputBytes: 0 };
    const countOutput = (bytes: Buffer) => { record.outputBytes = Math.min(1_048_576, record.outputBytes + bytes.length); };
    child.stdout?.on("data", countOutput);
    child.stderr?.on("data", countOutput);
    records.set(descriptor.installation_id, record);
    child.once("exit", () => {
      const current = records.get(descriptor.installation_id);
      if (!this.closing && this.automaticRecovery && !record.expectedStop && current?.runtime.runtime_id === runtime.runtime_id) {
        this.audit("app.runtime.health_changed", { app_id: descriptor.app_id, installation_id: descriptor.installation_id, package_digest: descriptor.package_digest, runtime_id: runtime.runtime_id, runtime_generation: runtime.runtime_generation, outcome: "failed", error_code: "runtime_unhealthy" });
        void this.recoverRecord(record);
      }
    });
    this.failures.delete(descriptor.installation_id);
    this.startCount += 1;
    this.audit("app.runtime.started", { app_id: descriptor.app_id, installation_id: descriptor.installation_id, package_digest: descriptor.package_digest, runtime_id: runtime.runtime_id, runtime_generation: runtime.runtime_generation, outcome: "allowed", error_code: null });
    return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "started", state: "starting", runtime, error_code: null });
  }

  async awaitReadiness(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorReadyResultSchema>> {
    const record = this.requireRecord(runtime);
    if (this.failNextReadiness) {
      this.failNextReadiness = false;
      await this.stop(runtime, "update");
      throw new AppPlatformError("readiness_failed", "Fixture runtime failed readiness");
    }
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (record.child.exitCode !== null || record.child.signalCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${record.port}/healthz`, { headers: { authorization: `Bearer ${record.connectionToken}` }, signal: AbortSignal.timeout(500) });
        if (await isReadyHealthResponse(response)) {
          record.ready = true;
          const transport = record.descriptor.endpoint_policy.transport;
          const endpoint = EndpointDescriptorSchema.parse({ endpoint_id: randomUUID(), transport, address: `http://${transport === "loopback" ? "127.0.0.1" : "localhost"}:${record.port}`, authentication: "per_installation_token", endpoint_token_generation: runtime.endpoint_token_generation, public_bind: false });
          this.audit("app.runtime.readiness_completed", { app_id: record.descriptor.app_id, installation_id: runtime.installation_id, package_digest: runtime.package_digest, runtime_id: runtime.runtime_id, runtime_generation: runtime.runtime_generation, outcome: "allowed", error_code: null });
          return SupervisorReadyResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ready", state: "ready", runtime, endpoint, error_code: null });
        }
      } catch { /* bounded retry */ }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await this.stop(runtime, "reconcile");
    throw new AppPlatformError("readiness_failed", "Fixture runtime did not become ready before the deadline");
  }

  async health(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorHealthResultSchema>> {
    const record = this.requireRecord(runtime);
    let ready = false;
    if (record.child.exitCode === null && record.child.signalCode === null) {
      try {
        const response = await fetch(`http://127.0.0.1:${record.port}/healthz`, { headers: { authorization: `Bearer ${record.connectionToken}` }, signal: AbortSignal.timeout(500) });
        ready = await isReadyHealthResponse(response);
      } catch { /* health is false */ }
    }
    return SupervisorHealthResultSchema.parse({ supervisor_protocol_version: 1, state: ready ? "ready" : "unhealthy", runtime, restart_attempt: record.restartAttempt, next_backoff_ms: ready || record.restartAttempt >= 3 ? null : this.restartBackoffMs[record.restartAttempt], error_code: ready ? null : "health_failed" });
  }

  async stop(runtime: RuntimeIdentity, _reason: StopReason): Promise<z.infer<typeof SupervisorStopResultSchema>> {
    const owner = this.recordOwner(runtime);
    const record = owner?.get(runtime.installation_id);
    if (!record) {
      if (this.inspect(runtime.installation_id).length > 0) {
        return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: false, runtime, error_code: "ambiguous_runtime_state" });
      }
      return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "already_stopped", termination_acknowledged: true, runtime, error_code: null });
    }
    if (record.runtime.runtime_id !== runtime.runtime_id) {
      return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: false, runtime, error_code: "ambiguous_runtime_state" });
    }
    if (record.child.exitCode !== null || record.child.signalCode !== null) {
      owner!.delete(runtime.installation_id);
      return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "already_stopped", termination_acknowledged: true, runtime, error_code: null });
    }
    record.expectedStop = true;
    record.connectionToken = randomBytes(32).toString("base64url");
    record.child.kill("SIGTERM");
    const graceful = await waitForExit(record.child, this.stopGraceMs);
    let forced = false;
    if (!graceful) {
      record.child.kill("SIGKILL");
      forced = await waitForExit(record.child, this.stopGraceMs);
    }
    if (!graceful && !forced) {
      return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: false, runtime, error_code: "stop_timeout" });
    }
    owner!.delete(runtime.installation_id);
    this.audit("app.runtime.stopped", { app_id: record.descriptor.app_id, installation_id: runtime.installation_id, package_digest: runtime.package_digest, runtime_id: runtime.runtime_id, runtime_generation: runtime.runtime_generation, outcome: "committed", error_code: null });
    return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: graceful ? "stopped_gracefully" : "stopped_forced", termination_acknowledged: true, runtime, error_code: null });
  }

  inspect(installationId: string): RuntimeIdentity[] {
    return [this.records.get(installationId), this.candidates.get(installationId)]
      .filter((record): record is RuntimeProcess => Boolean(record && record.child.exitCode === null && record.child.signalCode === null))
      .map((record) => record.runtime);
  }

  promoteCandidate(runtime: RuntimeIdentity): void {
    const candidate = this.candidates.get(runtime.installation_id);
    if (!candidate || candidate.runtime.runtime_id !== runtime.runtime_id) return;
    const active = this.records.get(runtime.installation_id);
    if (active && active.child.exitCode === null && active.child.signalCode === null) {
      throw new AppPlatformError("runtime_conflict", "The prior runtime must stop before candidate promotion");
    }
    this.candidates.delete(runtime.installation_id);
    this.records.set(runtime.installation_id, candidate);
  }

  connectionFor(installationId: string): AppRuntimeConnection {
    const record = this.records.get(installationId);
    if (!record || !record.ready || record.child.exitCode !== null || record.child.signalCode !== null) {
      throw new AppPlatformError("ambiguous_runtime_state", "Active app runtime connection is unavailable");
    }
    return { runtime: record.runtime, url: `http://127.0.0.1:${record.port}/mcp`, authorization: record.connectionToken };
  }

  async crashForTest(installationId: string): Promise<void> {
    const record = this.records.get(installationId);
    if (!record) return;
    record.expectedStop = false;
    record.child.kill("SIGKILL");
    if (!await waitForExit(record.child, 5_000)) throw new Error("Injected runtime crash did not terminate");
  }

  async recoverCrashesForTest(): Promise<void> {
    for (const [installationId, record] of this.records) {
      if (record.child.exitCode === null && record.child.signalCode === null) continue;
      if (record.expectedStop) { this.records.delete(installationId); continue; }
      await this.recoverRecord(record);
    }
  }

  failureFor(installationId: string): string | null { return this.failures.get(installationId) ?? null; }

  async close(): Promise<void> {
    this.closing = true;
    clearInterval(this.healthTimer);
    for (const runtime of [...this.records.values(), ...this.candidates.values()].map((record) => record.runtime)) await this.stop(runtime, "shutdown");
  }

  private async recoverRecord(record: RuntimeProcess): Promise<void> {
    const installationId = record.descriptor.installation_id;
    if (record.restartAttempt >= 3) {
      if (this.records.get(installationId)?.runtime.runtime_id === record.runtime.runtime_id) this.records.delete(installationId);
      this.failures.set(installationId, "restart_exhausted");
      return;
    }
    const nextAttempt = record.restartAttempt + 1;
    await new Promise((resolve) => setTimeout(resolve, this.restartBackoffMs[record.restartAttempt]));
    const current = this.records.get(installationId);
    if (this.closing || current?.runtime.runtime_id !== record.runtime.runtime_id || (current.child.exitCode === null && current.child.signalCode === null)) return;
    current.restartAttempt = nextAttempt;
    try {
      const result = await this.start(record.descriptor);
      const replacement = this.records.get(installationId)!;
      replacement.restartAttempt = nextAttempt;
      await this.awaitReadiness(result.runtime!);
      this.audit("app.runtime.reconciled", { app_id: record.descriptor.app_id, installation_id: installationId, package_digest: result.runtime!.package_digest, runtime_id: result.runtime!.runtime_id, runtime_generation: result.runtime!.runtime_generation, restart_attempt: nextAttempt, outcome: "committed", error_code: null });
    } catch {
      const failed = this.records.get(installationId);
      if (failed && failed.child.exitCode === null) failed.child.kill("SIGKILL");
      else if (failed) void this.recoverRecord(failed);
    }
  }

  private async checkReadyRuntimes(): Promise<void> {
    if (this.closing) return;
    for (const record of this.records.values()) {
      if (!record.ready || record.expectedStop || record.child.exitCode !== null || record.child.signalCode !== null) continue;
      try {
        const response = await fetch(`http://127.0.0.1:${record.port}/healthz`, { headers: { authorization: `Bearer ${record.connectionToken}` }, signal: AbortSignal.timeout(500) });
        if (await isReadyHealthResponse(response)) continue;
      } catch { /* unhealthy */ }
      record.ready = false;
      record.child.kill("SIGKILL");
    }
  }

  private requireRecord(runtime: RuntimeIdentity): RuntimeProcess {
    const record = this.recordOwner(runtime)?.get(runtime.installation_id);
    if (!record || record.runtime.runtime_id !== runtime.runtime_id) throw new AppPlatformError("ambiguous_runtime_state", "Runtime identity is not supervised");
    return record;
  }

  private recordOwner(runtime: RuntimeIdentity): Map<string, RuntimeProcess> | null {
    if (this.records.get(runtime.installation_id)?.runtime.runtime_id === runtime.runtime_id) return this.records;
    if (this.candidates.get(runtime.installation_id)?.runtime.runtime_id === runtime.runtime_id) return this.candidates;
    return null;
  }
}

export class InMemoryAppSupervisor implements AppSupervisor {
  private readonly runtimes = new Map<string, RuntimeIdentity>();
  private readonly candidates = new Map<string, RuntimeIdentity>();
  startCount = 0;
  failNextReadiness = false;

  async start(raw: RuntimeLaunchDescriptor, role: "active" | "candidate" = "active"): Promise<z.infer<typeof SupervisorStartResultSchema>> {
    const { resolved_entrypoint: _resolved, ...candidate } = raw;
    const descriptor = RuntimeDescriptorSchema.parse(candidate);
    const records = role === "candidate" ? this.candidates : this.runtimes;
    const existing = records.get(descriptor.installation_id);
    if (existing) return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "already_running", state: "ready", runtime: existing, error_code: null });
    const runtime = RuntimeIdentitySchema.parse({ runtime_id: randomUUID(), installation_id: descriptor.installation_id, package_digest: descriptor.package_digest, runtime_generation: 1, endpoint_token_generation: 1 });
    records.set(descriptor.installation_id, runtime); this.startCount += 1;
    return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "started", state: "starting", runtime, error_code: null });
  }
  async awaitReadiness(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorReadyResultSchema>> {
    if (this.failNextReadiness) { this.failNextReadiness = false; this.recordOwner(runtime)?.delete(runtime.installation_id); throw new AppPlatformError("readiness_failed", "Injected readiness failure"); }
    const endpoint = EndpointDescriptorSchema.parse({ endpoint_id: randomUUID(), transport: "container_internal", address: "http://fixture:8788", authentication: "per_installation_token", endpoint_token_generation: runtime.endpoint_token_generation, public_bind: false });
    return SupervisorReadyResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ready", state: "ready", runtime, endpoint, error_code: null });
  }
  async health(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorHealthResultSchema>> { return SupervisorHealthResultSchema.parse({ supervisor_protocol_version: 1, state: this.runtimes.has(runtime.installation_id) ? "ready" : "unhealthy", runtime, restart_attempt: 0, next_backoff_ms: null, error_code: this.runtimes.has(runtime.installation_id) ? null : "health_failed" }); }
  async stop(runtime: RuntimeIdentity, _reason: StopReason): Promise<z.infer<typeof SupervisorStopResultSchema>> { const owner = this.recordOwner(runtime); if (!owner && this.inspect(runtime.installation_id).length > 0) return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: false, runtime, error_code: "ambiguous_runtime_state" }); const existed = owner?.delete(runtime.installation_id) ?? false; return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: existed ? "stopped_gracefully" : "already_stopped", termination_acknowledged: true, runtime, error_code: null }); }
  inspect(installationId: string): RuntimeIdentity[] { return [this.runtimes.get(installationId), this.candidates.get(installationId)].filter((runtime): runtime is RuntimeIdentity => Boolean(runtime)); }
  promoteCandidate(runtime: RuntimeIdentity): void { const candidate = this.candidates.get(runtime.installation_id); if (!candidate || candidate.runtime_id !== runtime.runtime_id) return; if (this.runtimes.has(runtime.installation_id)) throw new AppPlatformError("runtime_conflict", "The prior runtime must stop before candidate promotion"); this.candidates.delete(runtime.installation_id); this.runtimes.set(runtime.installation_id, candidate); }
  connectionFor(installationId: string): AppRuntimeConnection { const runtime = this.runtimes.get(installationId); if (!runtime) throw new AppPlatformError("ambiguous_runtime_state", "Active app runtime connection is unavailable"); return { runtime, url: "http://fixture:8788/mcp", authorization: "in-memory-fixture-authority" }; }
  async close(): Promise<void> { this.runtimes.clear(); this.candidates.clear(); }
  private recordOwner(runtime: RuntimeIdentity): Map<string, RuntimeIdentity> | null { if (this.runtimes.get(runtime.installation_id)?.runtime_id === runtime.runtime_id) return this.runtimes; if (this.candidates.get(runtime.installation_id)?.runtime_id === runtime.runtime_id) return this.candidates; return null; }
}

async function allocateLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") { server.close(); reject(new Error("Failed to allocate loopback port")); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

async function isReadyHealthResponse(response: Response): Promise<boolean> {
  if (!response.ok) return false;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) return false;
  try {
    const body = await response.json() as { status?: unknown };
    return body !== null && typeof body === "object" && body.status === "ok";
  } catch {
    return false;
  }
}
