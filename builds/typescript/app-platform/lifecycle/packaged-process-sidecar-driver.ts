import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import {
  SidecarBundleStore,
  assertSidecarDriverBundleResolution,
  type SidecarDriverBundleResolution,
  type SidecarBundleReference,
} from "./sidecar-bundle-store.js";
import { AppPlatformError } from "./errors.js";
import type {
  PrivateSidecarBindingCandidate,
  SidecarHealthResult,
  SidecarRuntimeDriver,
  SidecarRuntimeDriverContext,
} from "./sidecar-supervisor.js";

type LoopbackAllocation = {
  host: string;
  port: number;
};

export type PackagedProcessSidecarDriverOptions = {
  bundleStore: SidecarBundleStore;
  bundleReferenceFor(context: SidecarRuntimeDriverContext): SidecarBundleReference | null | Promise<SidecarBundleReference | null>;
  allocateLoopback?: () => Promise<LoopbackAllocation>;
  maxMemoryMb?: number;
  maxCpuPercent?: number;
  maxDiskMb?: number;
  maxCacheMb?: number;
  outputLimitBytes?: number;
  readinessTimeoutMs?: number;
  stopTimeoutMs?: number;
  waitForExit?: (child: ChildProcess, timeoutMs: number) => Promise<boolean>;
  restartBackoffMs?: [number, number, number];
};

type PackagedProcessRuntimeTarget = Extract<SidecarRuntimeDriverContext["target"], { runtime_kind: "packaged_process" }>;

type RuntimeRecord = {
  context: SidecarRuntimeDriverContext;
  resolution: SidecarDriverBundleResolution;
  child: ChildProcess;
  host: string;
  port: number;
  token: string;
  ready: boolean;
  expectedStop: boolean;
  outputBytes: number;
  outputLimitTriggered: boolean;
};

export type PackagedProcessSidecarDiagnostic = {
  sequence: number;
  action: "start" | "health" | "stop" | "cleanup" | "containment";
  state: "starting" | "running" | "unhealthy" | "stopped" | "failed";
  health: "unknown" | "healthy" | "unhealthy";
  runtime_kind: "packaged_process";
  endpoint_class: "loopback_authenticated" | null;
  error_code: string | null;
  content_stored: false;
  occurred_at: string;
};

export type PackagedProcessSidecarObservation = {
  running: boolean;
  endpoint_class: "loopback_authenticated";
  public_bind: false;
  command_line_exposed: false;
  executable_authority: "verified_staged_entrypoint";
  environment_keys: readonly string[];
};

const SIDECAR_ENVIRONMENT_KEYS = [
  "BRAINDRIVE_SIDECAR_BIND",
  "BRAINDRIVE_SIDECAR_COMPONENT_ID",
  "BRAINDRIVE_SIDECAR_CONNECTION_TOKEN",
  "BRAINDRIVE_INSTALLATION_ID",
  "BRAINDRIVE_PACKAGE_DIGEST",
  "BRAINDRIVE_PACKAGE_ID",
] as const;

const DEFAULT_STOP_TIMEOUT_MS = 5_000;

export class PackagedProcessSidecarDriver implements SidecarRuntimeDriver {
  readonly runtimeKind = "packaged_process" as const;

  private readonly allocateLoopback: NonNullable<PackagedProcessSidecarDriverOptions["allocateLoopback"]>;
  private readonly stopTimeoutMs: number;
  private readonly outputLimitBytes: number;
  private readonly waitForExitHook: PackagedProcessSidecarDriverOptions["waitForExit"];
  private readonly records = new Map<string, RuntimeRecord>();
  private readonly diagnostics = new Map<string, PackagedProcessSidecarDiagnostic[]>();
  private readonly logSummaries = new Map<string, { observed_bytes: number; limit_bytes: number; truncated: boolean; content_stored: false }>();
  private diagnosticSequence = 0;

  constructor(private readonly options: PackagedProcessSidecarDriverOptions) {
    if (!(options.bundleStore instanceof SidecarBundleStore)) {
      throw new AppPlatformError("denied", "Packaged sidecar driver requires verified sidecar bundle store authority", 403);
    }
    this.allocateLoopback = options.allocateLoopback ?? allocatePrivateLoopback;
    this.stopTimeoutMs = Math.max(1, options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
    this.outputLimitBytes = Math.max(1, options.outputLimitBytes ?? 1_048_576);
    this.waitForExitHook = options.waitForExit;
  }

  async start(context: SidecarRuntimeDriverContext): Promise<PrivateSidecarBindingCandidate> {
    this.assertAdmissibleTarget(context);
    const key = runtimeKey(context.packageId, context.sidecar.component_id);
    const existing = this.records.get(key);
    if (existing && isRunning(existing.child)) {
      return { transport: "loopback", endpoint: `http://${existing.host}:${existing.port}`, authorization: existing.token };
    }

    const reference = await this.options.bundleReferenceFor(context);
    if (!reference) throw new AppPlatformError("ambiguous_runtime_state", "Packaged sidecar bundle reference is unavailable");
    const resolution = assertSidecarDriverBundleResolution(await this.options.bundleStore.resolveForDriver(reference));
    this.assertResolvedEntrypoint(context, resolution);
    this.assertResourceEnvelope(context, resolution);
    await assertExecutable(resolution.entrypoint);

    const bind = await this.allocateLoopback();
    if (bind.host !== "127.0.0.1" || !Number.isInteger(bind.port) || bind.port <= 0 || bind.port > 65_535) {
      throw new AppPlatformError("denied", "Packaged sidecar attempted to bind outside private loopback", 403);
    }

    const token = randomBytes(32).toString("base64url");
    const child = spawn(resolution.entrypoint, [], {
      cwd: path.dirname(resolution.entrypoint),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        BRAINDRIVE_SIDECAR_BIND: `${bind.host}:${bind.port}`,
        BRAINDRIVE_SIDECAR_COMPONENT_ID: context.sidecar.component_id,
        BRAINDRIVE_SIDECAR_CONNECTION_TOKEN: token,
        BRAINDRIVE_INSTALLATION_ID: context.installationId,
        BRAINDRIVE_PACKAGE_DIGEST: context.packageDigest,
        BRAINDRIVE_PACKAGE_ID: context.packageId,
      },
    });
    const record: RuntimeRecord = {
      context,
      resolution,
      child,
      host: bind.host,
      port: bind.port,
      token,
      ready: false,
      expectedStop: false,
      outputBytes: 0,
      outputLimitTriggered: false,
    };
    child.stdout?.on("data", (bytes: Buffer) => this.countOutput(key, record, bytes));
    child.stderr?.on("data", (bytes: Buffer) => this.countOutput(key, record, bytes));
    child.once("exit", () => {
      if (!record.expectedStop && this.records.get(key) === record && !record.outputLimitTriggered) {
        this.recordDiagnostic(key, "health", "failed", "unhealthy", "process_crashed");
      }
    });
    this.records.set(key, record);
    try {
      await waitForSpawn(child, Math.max(1, context.target.resources.startup_timeout_ms));
    } catch {
      this.records.delete(key);
      this.recordDiagnostic(key, "start", "failed", "unhealthy", "start_failed");
      throw new AppPlatformError("start_failed", "Packaged sidecar process could not be launched");
    }
    this.recordDiagnostic(key, "start", "starting", "unknown", null);
    return { transport: "loopback", endpoint: `http://${bind.host}:${bind.port}`, authorization: token };
  }

  async health(context: SidecarRuntimeDriverContext): Promise<SidecarHealthResult> {
    const key = runtimeKey(context.packageId, context.sidecar.component_id);
    const record = this.records.get(key);
    if (!record) return { healthy: false, error_code: "ambiguous_runtime_state" };
    if (context.target.runtime_kind !== "packaged_process") return { healthy: false, error_code: "descriptor_invalid" };
    if (record.outputLimitTriggered) return { healthy: false, error_code: "output_limit_exceeded" };
    if (!isRunning(record.child)) return { healthy: false, error_code: "process_crashed" };
    try {
      const response = await fetch(`http://${record.host}:${record.port}${context.sidecar.health.path}`, {
        headers: { authorization: `Bearer ${record.token}` },
        signal: AbortSignal.timeout(Math.max(1, context.target.resources.health_timeout_ms)),
      });
      const healthy = response.ok && await isOkHealthResponse(response);
      record.ready = healthy;
      this.recordDiagnostic(key, "health", healthy ? "running" : "unhealthy", healthy ? "healthy" : "unhealthy", healthy ? null : "health_failed");
      return { healthy, error_code: healthy ? null : "health_failed" };
    } catch {
      this.recordDiagnostic(key, "health", "unhealthy", "unhealthy", "health_failed");
      return { healthy: false, error_code: "health_failed" };
    }
  }

  async stop(context: SidecarRuntimeDriverContext): Promise<void> {
    const key = runtimeKey(context.packageId, context.sidecar.component_id);
    const record = this.records.get(key);
    if (!record) return;
    await this.stopRecord(key, record, effectiveStopTimeoutMs(record, this.stopTimeoutMs), this.waitForExitHook ?? waitForExit);
  }

  async uninstall(context: SidecarRuntimeDriverContext): Promise<void> {
    await this.cleanup(context);
  }

  async cleanup(context: SidecarRuntimeDriverContext): Promise<void> {
    const key = runtimeKey(context.packageId, context.sidecar.component_id);
    const record = this.records.get(key);
    if (!record) return;
    await this.forceCleanupRecord(key, record);
  }

  async close(): Promise<void> {
    await Promise.all([...this.records].map(([key, record]) => this.forceCleanupRecord(key, record)));
  }

  async crashForTest(packageId: string, componentId: string): Promise<void> {
    const record = this.records.get(runtimeKey(packageId, componentId));
    if (!record) return;
    killProcessGroup(record.child, "SIGKILL");
    await waitForExit(record.child, 1_000);
  }

  inspectForTest(packageId: string, componentId: string): PackagedProcessSidecarObservation | null {
    const record = this.records.get(runtimeKey(packageId, componentId));
    if (!record) return null;
    return {
      running: isRunning(record.child),
      endpoint_class: "loopback_authenticated",
      public_bind: false,
      command_line_exposed: false,
      executable_authority: "verified_staged_entrypoint",
      environment_keys: SIDECAR_ENVIRONMENT_KEYS,
    };
  }

  diagnosticsFor(packageId: string, componentId: string): PackagedProcessSidecarDiagnostic[] {
    return [...(this.diagnostics.get(runtimeKey(packageId, componentId)) ?? [])];
  }

  logSummaryFor(packageId: string, componentId: string): { observed_bytes: number; limit_bytes: number; truncated: boolean; content_stored: false } | null {
    return this.logSummaries.get(runtimeKey(packageId, componentId)) ?? null;
  }

  private assertAdmissibleTarget(context: SidecarRuntimeDriverContext): asserts context is SidecarRuntimeDriverContext & { target: PackagedProcessRuntimeTarget } {
    const target = context.target;
    if (target.runtime_kind !== "packaged_process" || target.bind !== "loopback" || target.public_network !== false) {
      throw new AppPlatformError("descriptor_invalid", "Packaged sidecar target is outside driver scope");
    }
    if (
      target.network_policy.binding !== "private_random_loopback" ||
      target.network_policy.public_inbound !== false ||
      target.network_policy.self_update !== false
    ) {
      throw new AppPlatformError("denied", "Packaged sidecar network policy is not private loopback", 403);
    }
    if (target.resources.memory_mb > (this.options.maxMemoryMb ?? 512)) {
      throw new AppPlatformError("resource_invalid", "Packaged sidecar memory budget exceeds host policy");
    }
    if (target.resources.cpu_percent > (this.options.maxCpuPercent ?? 100)) {
      throw new AppPlatformError("resource_invalid", "Packaged sidecar CPU budget exceeds host policy");
    }
  }

  private assertResourceEnvelope(context: SidecarRuntimeDriverContext & { target: PackagedProcessRuntimeTarget }, resolution: SidecarDriverBundleResolution): void {
    const resources = context.target.resources;
    if (resources.disk_mb > (this.options.maxDiskMb ?? resources.disk_mb)) {
      throw new AppPlatformError("resource_invalid", "Packaged sidecar disk budget exceeds host policy");
    }
    if (resources.cache_mb > (this.options.maxCacheMb ?? resources.cache_mb)) {
      throw new AppPlatformError("resource_invalid", "Packaged sidecar cache budget exceeds host policy");
    }
    if (resolution.contentBytes > resources.disk_mb * 1024 * 1024) {
      throw new AppPlatformError("resource_invalid", "Packaged sidecar staged content exceeds declared disk budget");
    }
    if (context.target.dependency_bundle.cache.strategy === "content_addressed_immutable" && resolution.contentBytes > resources.cache_mb * 1024 * 1024) {
      throw new AppPlatformError("resource_invalid", "Packaged sidecar staged content exceeds declared cache budget");
    }
  }

  private assertResolvedEntrypoint(context: SidecarRuntimeDriverContext & { target: PackagedProcessRuntimeTarget }, resolution: SidecarDriverBundleResolution): void {
    const contentRoot = path.resolve(resolution.contentRoot);
    const entrypoint = path.resolve(resolution.entrypoint);
    if (
      resolution.packageDigest !== context.packageDigest ||
      resolution.target !== context.target.target ||
      resolution.entrypoint !== path.join(resolution.contentRoot, context.target.entrypoint) ||
      !entrypoint.startsWith(`${contentRoot}${path.sep}`)
    ) {
      throw new AppPlatformError("ambiguous_runtime_state", "Packaged sidecar bundle resolution does not match runtime descriptor");
    }
  }

  private countOutput(key: string, record: RuntimeRecord, bytes: Buffer): void {
    record.outputBytes += bytes.byteLength;
    const outputLimitBytes = Math.min(
      this.outputLimitBytes,
      record.context.target.runtime_kind === "packaged_process" ? record.context.target.resources.max_output_event_bytes : this.outputLimitBytes,
      record.context.target.runtime_kind === "packaged_process" ? record.context.target.resources.log_bytes : this.outputLimitBytes,
    );
    const priorSummary = this.logSummaries.get(key);
    this.logSummaries.set(key, {
      observed_bytes: Math.min(outputLimitBytes, (priorSummary?.observed_bytes ?? 0) + bytes.byteLength),
      limit_bytes: outputLimitBytes,
      truncated: record.outputBytes > outputLimitBytes || priorSummary?.truncated === true,
      content_stored: false,
    });
    if (record.outputBytes <= outputLimitBytes || record.outputLimitTriggered || record.expectedStop) return;
    record.outputLimitTriggered = true;
    this.recordDiagnostic(key, "containment", "failed", "unhealthy", "output_limit_exceeded");
    killProcessGroup(record.child, "SIGKILL");
  }

  private async stopRecord(
    key: string,
    record: RuntimeRecord,
    timeoutMs: number,
    wait: (child: ChildProcess, timeoutMs: number) => Promise<boolean>,
  ): Promise<void> {
    record.expectedStop = true;
    killProcessGroup(record.child, "SIGTERM");
    if (!await wait(record.child, timeoutMs)) {
      killProcessGroup(record.child, "SIGKILL");
      if (!await wait(record.child, timeoutMs)) {
        this.recordDiagnostic(key, "stop", "failed", "unhealthy", "stop_timeout");
        throw new Error("stop_timeout");
      }
    }
    this.records.delete(key);
    this.recordDiagnostic(key, "stop", "stopped", "unknown", null);
  }

  private async forceCleanupRecord(key: string, record: RuntimeRecord): Promise<void> {
    record.expectedStop = true;
    killProcessGroup(record.child, "SIGKILL");
    await waitForExit(record.child, 1_000);
    this.records.delete(key);
    this.recordDiagnostic(key, "cleanup", "stopped", "unknown", null);
  }

  private recordDiagnostic(
    key: string,
    action: PackagedProcessSidecarDiagnostic["action"],
    state: PackagedProcessSidecarDiagnostic["state"],
    health: PackagedProcessSidecarDiagnostic["health"],
    errorCode: string | null,
  ): void {
    const next = {
      sequence: ++this.diagnosticSequence,
      action,
      state,
      health,
      runtime_kind: "packaged_process" as const,
      endpoint_class: action === "cleanup" ? null : "loopback_authenticated" as const,
      error_code: errorCode,
      content_stored: false as const,
      occurred_at: new Date().toISOString(),
    };
    this.diagnostics.set(key, [...(this.diagnostics.get(key) ?? []), next]);
  }
}

async function allocatePrivateLoopback(): Promise<LoopbackAllocation> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new AppPlatformError("resource_invalid", "Private loopback port allocation failed");
  return { host: "127.0.0.1", port: address.port };
}

async function assertExecutable(entrypoint: string): Promise<void> {
  try {
    await access(entrypoint, constants.R_OK | constants.X_OK);
  } catch {
    throw new Error("os_security_block");
  }
}

async function isOkHealthResponse(response: Response): Promise<boolean> {
  try {
    const payload = await response.json() as { status?: unknown };
    return payload.status === "ok";
  } catch {
    return false;
  }
}

function waitForSpawn(child: ChildProcess, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("start_failed"));
    }, timeoutMs);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      child.off("spawn", onSpawn);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("start_failed"));
    };
    const onExit = () => {
      cleanup();
      reject(new Error("start_failed"));
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isRunning(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(!isRunning(child));
    }, timeoutMs);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onExit);
    };
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    child.once("exit", onExit);
    child.once("error", onExit);
  });
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid || !isRunning(child)) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch { /* already stopped */ }
  }
}

function effectiveStopTimeoutMs(record: RuntimeRecord, hostMaximumMs: number): number {
  return Math.max(1, Math.min(hostMaximumMs, record.context.target.runtime_kind === "packaged_process"
    ? record.context.target.resources.stop_timeout_ms
    : hostMaximumMs));
}

function isRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function runtimeKey(packageId: string, componentId: string): string {
  return `${packageId}\n${componentId}`;
}
