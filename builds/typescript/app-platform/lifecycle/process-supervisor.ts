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
  awaitReadiness(runtime: RuntimeIdentity, deadlineAt?: string): Promise<z.infer<typeof SupervisorReadyResultSchema>>;
  health(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorHealthResultSchema>>;
  stop(runtime: RuntimeIdentity, reason: StopReason, graceDeadlineAt?: string): Promise<z.infer<typeof SupervisorStopResultSchema>>;
  inspect(installationId: string): RuntimeIdentity[];
  connectionFor(installationId: string): AppRuntimeConnection;
  connectionForRuntime?(runtime: RuntimeIdentity): AppRuntimeConnection;
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
  outputLimitTriggered: boolean;
  endpoint: z.infer<typeof EndpointDescriptorSchema> | null;
};

export type RuntimeDiagnostic = {
  sequence: number;
  state: "starting" | "ready" | "unhealthy" | "backoff" | "restarting" | "failed_recoverable" | "stopped";
  action: string;
  runtime_generation: number | null;
  restart_attempt: number;
  backoff_ms: number | null;
  endpoint_class: "container_internal_authenticated" | "loopback_authenticated" | null;
  error_code: string | null;
};

export type ProcessObservation = {
  process_id: number;
  process_group_id: number | null;
  runtime_generation: number;
  application_argument_count: 0;
  environment_keys: readonly string[];
  command_token_exposed: false;
  endpoint_class: "container_internal_authenticated" | "loopback_authenticated";
  public_bind: false;
};

type Options = {
  startupTimeoutMs?: number;
  stopGraceMs?: number;
  restartBackoffMs?: [number, number, number];
  automaticRecovery?: boolean;
  healthIntervalMs?: number;
  outputLimitBytes?: number;
  maxDiagnosticEntries?: number;
  allocatePort?: () => Promise<number>;
  sleep?: (milliseconds: number) => Promise<void>;
  beforeRestart?: (runtime: RuntimeIdentity) => Promise<void>;
  afterRestart?: (runtime: RuntimeIdentity, endpoint: z.infer<typeof EndpointDescriptorSchema>) => Promise<void>;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

const ENVIRONMENT_KEYS = [
  "BRAINDRIVE_APP_CONNECTION_TOKEN",
  "BRAINDRIVE_APP_ID",
  "BRAINDRIVE_INSTALLATION_ID",
  "BRAINDRIVE_PACKAGE_DIGEST",
  "BRAINDRIVE_ENDPOINT_BIND",
] as const;

export class ProcessAppSupervisor implements AppSupervisor {
  private readonly records = new Map<string, RuntimeProcess>();
  private readonly candidates = new Map<string, RuntimeProcess>();
  private readonly failures = new Map<string, string>();
  private readonly startupTimeoutMs: number;
  private readonly stopGraceMs: number;
  private readonly restartBackoffMs: [number, number, number];
  private readonly automaticRecovery: boolean;
  private readonly outputLimitBytes: number;
  private readonly maxDiagnosticEntries: number;
  private readonly allocatePort: NonNullable<Options["allocatePort"]>;
  private readonly sleep: NonNullable<Options["sleep"]>;
  private readonly beforeRestart: NonNullable<Options["beforeRestart"]>;
  private readonly afterRestart: NonNullable<Options["afterRestart"]>;
  private readonly healthTimer: NodeJS.Timeout;
  private readonly generations = new Map<string, { runtime: number; token: number }>();
  private readonly diagnostics = new Map<string, RuntimeDiagnostic[]>();
  private readonly logSummaries = new Map<string, { observed_bytes: number; limit_bytes: number; truncated: boolean; content_stored: false }>();
  private readonly recoveries = new Set<string>();
  private readonly recoveryPromises = new Map<string, Promise<void>>();
  private diagnosticSequence = 0;
  private closing = false;
  private readonly audit: NonNullable<Options["audit"]>;
  startCount = 0;
  failNextReadiness = false;

  constructor(options: Options = {}) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
    this.stopGraceMs = options.stopGraceMs ?? 5_000;
    this.restartBackoffMs = options.restartBackoffMs ?? [1_000, 2_000, 4_000];
    this.automaticRecovery = options.automaticRecovery ?? true;
    this.outputLimitBytes = options.outputLimitBytes ?? 1_048_576;
    this.maxDiagnosticEntries = options.maxDiagnosticEntries ?? 128;
    this.allocatePort = options.allocatePort ?? allocateLoopbackPort;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.beforeRestart = options.beforeRestart ?? (async () => undefined);
    this.afterRestart = options.afterRestart ?? (async () => undefined);
    this.audit = options.audit ?? (() => undefined);
    this.healthTimer = setInterval(() => { void this.checkReadyRuntimes(); }, options.healthIntervalMs ?? 5_000);
    this.healthTimer.unref();
  }

  async start(rawDescriptor: RuntimeLaunchDescriptor, role: "active" | "candidate" = "active"): Promise<z.infer<typeof SupervisorStartResultSchema>> {
    return this.launch(rawDescriptor, role, 0);
  }

  private async launch(rawDescriptor: RuntimeLaunchDescriptor, role: "active" | "candidate", restartAttempt: number): Promise<z.infer<typeof SupervisorStartResultSchema>> {
    const { resolved_entrypoint, ...candidate } = rawDescriptor;
    const parsed = RuntimeDescriptorSchema.safeParse(candidate);
    if (!parsed.success || !validEnvironmentKeys(candidate.environment_keys)) {
      throw new AppPlatformError("descriptor_invalid", "Runtime descriptor is outside the accepted allowlist");
    }
    const descriptor = parsed.data;
    if (!validEntrypoint(descriptor.verified_entrypoint, resolved_entrypoint)) {
      throw new AppPlatformError("descriptor_invalid", "Runtime entrypoint is not the exact resolved verified script");
    }
    const records = role === "candidate" ? this.candidates : this.records;
    const prior = records.get(descriptor.installation_id);
    if (prior && prior.child.exitCode === null && prior.child.signalCode === null) {
      if (prior.descriptor.package_digest !== descriptor.package_digest) throw new AppPlatformError("runtime_conflict", "A different runtime already owns this installation");
      return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "already_running", state: prior.ready ? "ready" : "starting", runtime: prior.runtime, error_code: null });
    }
    const port = await this.allocatePort();
    const connectionToken = randomBytes(32).toString("base64url");
    const generation = this.generations.get(descriptor.installation_id) ?? { runtime: 0, token: 0 };
    generation.runtime += 1;
    generation.token += 1;
    this.generations.set(descriptor.installation_id, generation);
    const runtime = RuntimeIdentitySchema.parse({
      runtime_id: randomUUID(), installation_id: descriptor.installation_id, package_digest: descriptor.package_digest,
      runtime_generation: generation.runtime,
      endpoint_token_generation: generation.token,
    });
    const child = spawn(process.execPath, [resolved_entrypoint], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: path.dirname(resolved_entrypoint),
      detached: process.platform !== "win32",
      windowsHide: true,
      env: {
        BRAINDRIVE_APP_CONNECTION_TOKEN: connectionToken,
        BRAINDRIVE_APP_ID: descriptor.app_id,
        BRAINDRIVE_INSTALLATION_ID: descriptor.installation_id,
        BRAINDRIVE_PACKAGE_DIGEST: descriptor.package_digest,
        BRAINDRIVE_ENDPOINT_BIND: `127.0.0.1:${port}`,
      },
    });
    const record: RuntimeProcess = {
      descriptor: rawDescriptor,
      runtime,
      child,
      port,
      connectionToken,
      ready: false,
      expectedStop: false,
      restartAttempt,
      outputBytes: 0,
      outputLimitTriggered: false,
      endpoint: null,
    };
    const countOutput = (bytes: Buffer) => {
      record.outputBytes += bytes.length;
      const priorSummary = this.logSummaries.get(descriptor.installation_id);
      this.logSummaries.set(descriptor.installation_id, {
        observed_bytes: Math.min(this.outputLimitBytes, (priorSummary?.observed_bytes ?? 0) + bytes.length),
        limit_bytes: this.outputLimitBytes,
        truncated: record.outputBytes > this.outputLimitBytes || priorSummary?.truncated === true,
        content_stored: false,
      });
      if (record.outputBytes <= this.outputLimitBytes || record.outputLimitTriggered || record.expectedStop) return;
      record.outputLimitTriggered = true;
      record.ready = false;
      this.recordDiagnostic(record, "unhealthy", "contain_output_limit", "output_limit_exceeded");
      this.killExact(record, "SIGKILL");
    };
    child.stdout?.on("data", countOutput);
    child.stderr?.on("data", countOutput);
    records.set(descriptor.installation_id, record);
    try {
      await waitForSpawn(child, 5_000);
    } catch {
      if (records.get(descriptor.installation_id)?.runtime.runtime_id === runtime.runtime_id) records.delete(descriptor.installation_id);
      throw new AppPlatformError("start_failed", "Verified packaged Node runtime could not be spawned");
    }
    child.once("exit", () => {
      const current = records.get(descriptor.installation_id);
      if (!this.closing && this.automaticRecovery && !record.expectedStop && current?.runtime.runtime_id === runtime.runtime_id) {
        this.audit("app.runtime.health_changed", { app_id: descriptor.app_id, installation_id: descriptor.installation_id, package_digest: descriptor.package_digest, runtime_id: runtime.runtime_id, runtime_generation: runtime.runtime_generation, outcome: "failed", error_code: "runtime_unhealthy" });
        this.scheduleRecovery(record);
      }
    });
    if (restartAttempt === 0) this.failures.delete(descriptor.installation_id);
    this.startCount += 1;
    this.recordDiagnostic(record, restartAttempt === 0 ? "starting" : "restarting", restartAttempt === 0 ? "start" : "restart", null);
    this.audit("app.runtime.started", { app_id: descriptor.app_id, installation_id: descriptor.installation_id, package_digest: descriptor.package_digest, runtime_id: runtime.runtime_id, runtime_generation: runtime.runtime_generation, outcome: "allowed", error_code: null });
    return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "started", state: "starting", runtime, error_code: null });
  }

  async awaitReadiness(runtime: RuntimeIdentity, deadlineAt?: string): Promise<z.infer<typeof SupervisorReadyResultSchema>> {
    const record = this.requireRecord(runtime);
    if (this.failNextReadiness) {
      this.failNextReadiness = false;
      await this.stop(runtime, "update");
      throw new AppPlatformError("readiness_failed", "Fixture runtime failed readiness");
    }
    const requestedDeadline = deadlineAt ? Date.parse(deadlineAt) : Number.POSITIVE_INFINITY;
    const deadline = Math.min(Date.now() + this.startupTimeoutMs, requestedDeadline);
    while (Date.now() < deadline) {
      if (record.child.exitCode !== null || record.child.signalCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${record.port}/healthz`, { headers: { authorization: `Bearer ${record.connectionToken}` }, signal: AbortSignal.timeout(500) });
        if (await isReadyHealthResponse(response)) {
          record.ready = true;
          const transport = record.descriptor.endpoint_policy.transport;
          const endpoint = EndpointDescriptorSchema.parse({ endpoint_id: randomUUID(), transport, address: `http://${transport === "loopback" ? "127.0.0.1" : "localhost"}:${record.port}`, authentication: "per_installation_token", endpoint_token_generation: runtime.endpoint_token_generation, public_bind: false });
          record.endpoint = endpoint;
          this.recordDiagnostic(record, "ready", "readiness", null);
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

  async stop(runtime: RuntimeIdentity, _reason: StopReason, graceDeadlineAt?: string): Promise<z.infer<typeof SupervisorStopResultSchema>> {
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
      this.killExact(record, "SIGKILL");
      owner!.delete(runtime.installation_id);
      return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "already_stopped", termination_acknowledged: true, runtime, error_code: null });
    }
    record.expectedStop = true;
    record.connectionToken = randomBytes(32).toString("base64url");
    const requestedGrace = graceDeadlineAt ? Math.max(0, Date.parse(graceDeadlineAt) - Date.now()) : this.stopGraceMs;
    const effectiveGrace = Math.min(this.stopGraceMs, requestedGrace);
    const supportsGracefulSignal = process.platform !== "win32";
    this.killExact(record, supportsGracefulSignal ? "SIGTERM" : "SIGKILL");
    const graceful = supportsGracefulSignal && await waitForExit(record.child, effectiveGrace);
    let forced = false;
    if (!graceful) {
      if (supportsGracefulSignal) this.killExact(record, "SIGKILL");
      forced = await waitForExit(record.child, effectiveGrace);
    }
    if (!graceful && !forced) {
      return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: false, runtime, error_code: "stop_timeout" });
    }
    owner!.delete(runtime.installation_id);
    this.recordDiagnostic(record, "stopped", graceful ? "stop_graceful" : "stop_forced", null);
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

  connectionForRuntime(runtime: RuntimeIdentity): AppRuntimeConnection {
    const record = this.requireRecord(runtime);
    if (!record.ready || record.child.exitCode !== null || record.child.signalCode !== null) {
      throw new AppPlatformError("ambiguous_runtime_state", "App runtime connection is unavailable before readiness");
    }
    return { runtime: record.runtime, url: `http://127.0.0.1:${record.port}/mcp`, authorization: record.connectionToken };
  }

  processObservationFor(installationId: string): ProcessObservation | null {
    const record = this.records.get(installationId);
    if (!record?.child.pid || record.child.exitCode !== null || record.child.signalCode !== null) return null;
    return {
      process_id: record.child.pid,
      process_group_id: process.platform === "win32" ? null : record.child.pid,
      runtime_generation: record.runtime.runtime_generation,
      application_argument_count: 0,
      environment_keys: [...ENVIRONMENT_KEYS],
      command_token_exposed: false,
      endpoint_class: endpointClass(record),
      public_bind: false,
    };
  }

  diagnosticsFor(installationId: string): RuntimeDiagnostic[] {
    return [...(this.diagnostics.get(installationId) ?? [])];
  }

  logSummaryFor(installationId: string) {
    return this.logSummaries.get(installationId) ?? {
      observed_bytes: 0,
      limit_bytes: this.outputLimitBytes,
      truncated: false,
      content_stored: false as const,
    };
  }

  async crashForTest(installationId: string): Promise<void> {
    const record = this.records.get(installationId);
    if (!record) return;
    record.expectedStop = false;
    this.killExact(record, "SIGKILL");
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
    await Promise.allSettled([...this.recoveryPromises.values()]);
  }

  private async recoverRecord(record: RuntimeProcess): Promise<void> {
    const installationId = record.descriptor.installation_id;
    const currentAtFailure = this.records.get(installationId);
    if (currentAtFailure?.runtime.runtime_id !== record.runtime.runtime_id || record.expectedStop) return;
    try {
      await this.beforeRestart(record.runtime);
      this.recordDiagnostic(record, "unhealthy", "revoke_before_restart", record.outputLimitTriggered ? "output_limit_exceeded" : "health_failed");
      this.killExact(record, "SIGKILL");
    } catch {
      this.records.delete(installationId);
      this.failures.set(installationId, "token_revocation_failed");
      this.recordDiagnostic(record, "failed_recoverable", "revoke_failed", "token_revocation_failed");
      return;
    }
    if (record.restartAttempt >= 3) {
      if (this.records.get(installationId)?.runtime.runtime_id === record.runtime.runtime_id) this.records.delete(installationId);
      this.failures.set(installationId, "restart_exhausted");
      this.recordDiagnostic(record, "failed_recoverable", "restart_exhausted", "restart_exhausted");
      return;
    }
    const nextAttempt = record.restartAttempt + 1;
    this.recordDiagnostic(record, "backoff", "restart_backoff", null, this.restartBackoffMs[record.restartAttempt]);
    await this.sleep(this.restartBackoffMs[record.restartAttempt]);
    const current = this.records.get(installationId);
    if (this.closing || current?.runtime.runtime_id !== record.runtime.runtime_id || (current.child.exitCode === null && current.child.signalCode === null)) return;
    this.records.delete(installationId);
    let replacement: RuntimeProcess | undefined;
    try {
      const result = await this.launch(record.descriptor, "active", nextAttempt);
      replacement = this.records.get(installationId)!;
      const ready = await this.awaitReadiness(result.runtime!);
      await this.afterRestart(result.runtime!, ready.endpoint!);
      this.audit("app.runtime.reconciled", { app_id: record.descriptor.app_id, installation_id: installationId, package_digest: result.runtime!.package_digest, runtime_id: result.runtime!.runtime_id, runtime_generation: result.runtime!.runtime_generation, restart_attempt: nextAttempt, outcome: "committed", error_code: null });
    } catch {
      const failed = this.records.get(installationId) ?? replacement;
      if (!failed) {
        this.failures.set(installationId, "start_failed");
        return;
      }
      if (failed.child.exitCode === null && failed.child.signalCode === null) {
        this.killExact(failed, "SIGKILL");
        await waitForExit(failed.child, this.stopGraceMs);
      }
      this.records.set(installationId, failed);
      await this.recoverRecord(failed);
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
      this.killExact(record, "SIGKILL");
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

  private scheduleRecovery(record: RuntimeProcess): void {
    const key = record.descriptor.installation_id;
    if (this.recoveries.has(key)) return;
    this.recoveries.add(key);
    const recovery = this.recoverRecord(record).finally(() => {
      this.recoveries.delete(key);
      if (this.recoveryPromises.get(key) === recovery) this.recoveryPromises.delete(key);
    });
    this.recoveryPromises.set(key, recovery);
  }

  private killExact(record: RuntimeProcess, signal: NodeJS.Signals): void {
    if (!record.child.pid) return;
    try {
      if (process.platform === "win32") {
        if (record.child.exitCode === null && record.child.signalCode === null) record.child.kill(signal);
      }
      else process.kill(-record.child.pid, signal);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
    }
  }

  private recordDiagnostic(record: RuntimeProcess, state: RuntimeDiagnostic["state"], action: string, errorCode: string | null, backoffMs: number | null = null): void {
    const installationId = record.descriptor.installation_id;
    const entries = this.diagnostics.get(installationId) ?? [];
    entries.push({
      sequence: ++this.diagnosticSequence,
      state,
      action,
      runtime_generation: record.runtime.runtime_generation,
      restart_attempt: record.restartAttempt,
      backoff_ms: backoffMs,
      endpoint_class: record.ready ? endpointClass(record) : null,
      error_code: errorCode,
    });
    if (entries.length > this.maxDiagnosticEntries) entries.splice(0, entries.length - this.maxDiagnosticEntries);
    this.diagnostics.set(installationId, entries);
  }
}

export class InMemoryAppSupervisor implements AppSupervisor {
  private readonly runtimes = new Map<string, RuntimeIdentity>();
  private readonly candidates = new Map<string, RuntimeIdentity>();
  private readonly readyRuntimeIds = new Set<string>();
  startCount = 0;
  failNextReadiness = false;

  async start(raw: RuntimeLaunchDescriptor, role: "active" | "candidate" = "active"): Promise<z.infer<typeof SupervisorStartResultSchema>> {
    const { resolved_entrypoint: _resolved, ...candidate } = raw;
    const descriptor = RuntimeDescriptorSchema.parse(candidate);
    const records = role === "candidate" ? this.candidates : this.runtimes;
    const existing = records.get(descriptor.installation_id);
    if (existing) return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "already_running", state: this.readyRuntimeIds.has(existing.runtime_id) ? "ready" : "starting", runtime: existing, error_code: null });
    const runtime = RuntimeIdentitySchema.parse({ runtime_id: randomUUID(), installation_id: descriptor.installation_id, package_digest: descriptor.package_digest, runtime_generation: 1, endpoint_token_generation: 1 });
    records.set(descriptor.installation_id, runtime); this.startCount += 1;
    return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "started", state: "starting", runtime, error_code: null });
  }
  async awaitReadiness(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorReadyResultSchema>> {
    if (this.failNextReadiness) { this.failNextReadiness = false; this.recordOwner(runtime)?.delete(runtime.installation_id); throw new AppPlatformError("readiness_failed", "Injected readiness failure"); }
    if (!this.recordOwner(runtime)) throw new AppPlatformError("ambiguous_runtime_state", "Runtime identity is not supervised");
    this.readyRuntimeIds.add(runtime.runtime_id);
    const endpoint = EndpointDescriptorSchema.parse({ endpoint_id: randomUUID(), transport: "container_internal", address: "http://fixture:8788", authentication: "per_installation_token", endpoint_token_generation: runtime.endpoint_token_generation, public_bind: false });
    return SupervisorReadyResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ready", state: "ready", runtime, endpoint, error_code: null });
  }
  async health(runtime: RuntimeIdentity): Promise<z.infer<typeof SupervisorHealthResultSchema>> { const ready = this.recordOwner(runtime) !== null && this.readyRuntimeIds.has(runtime.runtime_id); return SupervisorHealthResultSchema.parse({ supervisor_protocol_version: 1, state: ready ? "ready" : "unhealthy", runtime, restart_attempt: 0, next_backoff_ms: null, error_code: ready ? null : "health_failed" }); }
  async stop(runtime: RuntimeIdentity, _reason: StopReason): Promise<z.infer<typeof SupervisorStopResultSchema>> { const owner = this.recordOwner(runtime); if (!owner && this.inspect(runtime.installation_id).length > 0) return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: false, runtime, error_code: "ambiguous_runtime_state" }); const existed = owner?.delete(runtime.installation_id) ?? false; this.readyRuntimeIds.delete(runtime.runtime_id); return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: existed ? "stopped_gracefully" : "already_stopped", termination_acknowledged: true, runtime, error_code: null }); }
  inspect(installationId: string): RuntimeIdentity[] { return [this.runtimes.get(installationId), this.candidates.get(installationId)].filter((runtime): runtime is RuntimeIdentity => Boolean(runtime)); }
  promoteCandidate(runtime: RuntimeIdentity): void { const candidate = this.candidates.get(runtime.installation_id); if (!candidate || candidate.runtime_id !== runtime.runtime_id) return; if (this.runtimes.has(runtime.installation_id)) throw new AppPlatformError("runtime_conflict", "The prior runtime must stop before candidate promotion"); this.candidates.delete(runtime.installation_id); this.runtimes.set(runtime.installation_id, candidate); }
  connectionFor(installationId: string): AppRuntimeConnection { const runtime = this.runtimes.get(installationId); if (!runtime || !this.readyRuntimeIds.has(runtime.runtime_id)) throw new AppPlatformError("ambiguous_runtime_state", "Active app runtime connection is unavailable"); return { runtime, url: "http://fixture:8788/mcp", authorization: "in-memory-fixture-authority" }; }
  connectionForRuntime(runtime: RuntimeIdentity): AppRuntimeConnection { if (!this.recordOwner(runtime) || !this.readyRuntimeIds.has(runtime.runtime_id)) throw new AppPlatformError("ambiguous_runtime_state", "App runtime connection is unavailable"); return { runtime, url: "http://fixture:8788/mcp", authorization: "in-memory-fixture-authority" }; }
  async close(): Promise<void> { this.runtimes.clear(); this.candidates.clear(); this.readyRuntimeIds.clear(); }
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

function validEnvironmentKeys(keys: readonly string[]): boolean {
  return keys.length === ENVIRONMENT_KEYS.length && ENVIRONMENT_KEYS.every((key, index) => keys[index] === key);
}

function validEntrypoint(verifiedEntrypoint: string, resolvedEntrypoint: string): boolean {
  if (!path.isAbsolute(resolvedEntrypoint) || path.normalize(resolvedEntrypoint) !== resolvedEntrypoint) return false;
  const segments = verifiedEntrypoint.split("/");
  if (segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return resolvedEntrypoint.endsWith(`${path.sep}${segments.join(path.sep)}`);
}

function endpointClass(record: RuntimeProcess): "container_internal_authenticated" | "loopback_authenticated" {
  return record.descriptor.endpoint_policy.transport === "loopback"
    ? "loopback_authenticated"
    : "container_internal_authenticated";
}

async function waitForSpawn(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.pid && child.exitCode === null && child.signalCode === null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("spawn acknowledgement timed out")), timeoutMs);
    const done = (action: () => void) => {
      clearTimeout(timer);
      child.off("spawn", onSpawn);
      child.off("error", onError);
      action();
    };
    const onSpawn = () => done(resolve);
    const onError = () => done(() => reject(new Error("spawn failed")));
    child.once("spawn", onSpawn);
    child.once("error", onError);
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
