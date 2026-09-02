import type { z } from "zod";

import type { SidecarDescriptor } from "../contracts/package-components.js";
import {
  SidecarLifecycleDiagnosticEventSchema,
  SidecarRuntimeBindingProjectionSchema,
} from "../contracts/supervisor.js";
import { AppPlatformError } from "./errors.js";
import type { InstalledPackageRecord, InstalledPackageStore } from "./installed-package-store.js";

export type SidecarOperationAuthority =
  | { kind: "host" }
  | { kind: "component"; componentId: string };

export type SidecarRuntimeDriverContext = {
  packageId: string;
  installationId: string;
  packageDigest: `sha256:${string}`;
  sidecar: SidecarDescriptor;
  target: SidecarDescriptor["targets"][number];
};

export type PrivateSidecarBindingCandidate = {
  transport: "container_internal" | "loopback" | "ipc";
  endpoint?: string;
  authorization?: string;
  ipcName?: string;
  publicBind?: boolean;
  hostPath?: string;
  processId?: string;
  containerId?: string;
};

export type SidecarHealthResult = {
  healthy: boolean;
  error_code?: string | null;
};

export interface SidecarRuntimeDriver {
  readonly runtimeKind: "container" | "packaged_process";
  start(context: SidecarRuntimeDriverContext): Promise<PrivateSidecarBindingCandidate>;
  health(context: SidecarRuntimeDriverContext): Promise<SidecarHealthResult>;
  stop(context: SidecarRuntimeDriverContext): Promise<void>;
  uninstall(context: SidecarRuntimeDriverContext): Promise<void>;
  cleanup(context: SidecarRuntimeDriverContext): Promise<void>;
}

export type SidecarRuntimeBindingProjection = z.infer<typeof SidecarRuntimeBindingProjectionSchema>;
export type SidecarLifecycleDiagnosticEvent = z.infer<typeof SidecarLifecycleDiagnosticEventSchema>;

export type PrivateSidecarRuntimeBinding = SidecarRuntimeBindingProjection & {
  endpoint?: string;
  authorization?: string;
  ipcName?: string;
};

export type SidecarLifecycleSnapshot = {
  package_id: string;
  installation_id: string;
  component_id: string;
  owner_component_id: string;
  state: "starting" | "running" | "stopped" | "uninstalled" | "unavailable" | "failed";
  health: "unknown" | "healthy" | "unhealthy";
  restart_attempt: number;
  target: SidecarRuntimeBindingProjection["target"] | null;
  runtime_kind: "container" | "packaged_process" | null;
  binding: SidecarRuntimeBindingProjection | null;
  safe_message: string;
  updated_at: string;
};

type SidecarRuntimeRecord = {
  packageRecord: InstalledPackageRecord;
  sidecar: SidecarDescriptor;
  target: SidecarDescriptor["targets"][number];
  driver: SidecarRuntimeDriver;
  runtimeId: string;
  restartAttempt: number;
  state: SidecarLifecycleSnapshot["state"];
  health: SidecarLifecycleSnapshot["health"];
  binding: PrivateSidecarRuntimeBinding;
  updatedAt: string;
};

type SidecarSupervisorOptions = {
  store: InstalledPackageStore;
  target: SidecarRuntimeBindingProjection["target"];
  drivers: readonly SidecarRuntimeDriver[];
  bindingService?: SidecarRuntimeBindingService;
  ids?: { next(): string };
  clock?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  readinessTimeoutMs?: number;
  readinessPollMs?: number;
  audit?: (event: string, details: Record<string, unknown>) => void;
};

type SidecarActionInput = {
  packageId: string;
  componentId: string;
  authority: SidecarOperationAuthority;
};

const SAFE_ERROR_PATTERN = /^[a-z0-9_]{1,64}$/;
const UNSAFE_ERROR_PATTERN = /https?:|localhost|127\.|0\.0\.0\.0|secret|token|credential|bearer|\/|\\|:/i;

export class SidecarRuntimeBindingService {
  private readonly bindings = new Map<string, PrivateSidecarRuntimeBinding>();
  private readonly generations = new Map<string, number>();

  constructor(
    private readonly ids: { next(): string } = { next: () => crypto.randomUUID() },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  create(input: {
    packageRecord: InstalledPackageRecord;
    sidecar: SidecarDescriptor;
    target: SidecarDescriptor["targets"][number];
    runtimeId: string;
    candidate: PrivateSidecarBindingCandidate;
  }): PrivateSidecarRuntimeBinding {
    validateBindingCandidate(input.sidecar, input.target, input.candidate);
    const key = bindingKey(input.packageRecord.package_id, input.sidecar.component_id);
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    const projection = SidecarRuntimeBindingProjectionSchema.parse({
      binding_version: 1,
      binding_id: this.ids.next(),
      package_id: input.packageRecord.package_id,
      installation_id: input.packageRecord.installation_id,
      component_id: input.sidecar.component_id,
      owner_component_id: input.sidecar.owner_component_id,
      runtime_id: input.runtimeId,
      binding_generation: generation,
      target: input.target.target,
      transport: input.sidecar.binding.transport,
      endpoint_class: endpointClass(input.sidecar.binding.transport),
      audience: input.sidecar.binding.visibility,
      public_bind: false,
      created_at: this.clock().toISOString(),
    });
    const binding = {
      ...projection,
      endpoint: input.candidate.endpoint,
      authorization: input.candidate.authorization,
      ipcName: input.candidate.ipcName,
    };
    this.bindings.set(key, binding);
    return binding;
  }

  bindingForProviderAdapter(packageId: string, componentId: string, requesterComponentId: string): PrivateSidecarRuntimeBinding {
    const binding = this.requireBinding(packageId, componentId);
    if (binding.audience !== "provider_adapter_only" || binding.owner_component_id !== requesterComponentId) {
      throw new AppPlatformError("denied", "Sidecar binding is not visible to this provider adapter", 403);
    }
    return binding;
  }

  bindingForOwningApp(packageId: string, componentId: string, requesterComponentId: string): PrivateSidecarRuntimeBinding {
    const binding = this.requireBinding(packageId, componentId);
    if (binding.audience !== "owning_app_private" || binding.owner_component_id !== requesterComponentId) {
      throw new AppPlatformError("denied", "Sidecar binding is not visible to this app component", 403);
    }
    return binding;
  }

  bindingForConsumer(_packageId: string, _componentId: string): never {
    throw new AppPlatformError("denied", "Consumers cannot read sidecar runtime bindings", 403);
  }

  safeProjection(packageId: string, componentId: string): SidecarRuntimeBindingProjection | null {
    const binding = this.bindings.get(bindingKey(packageId, componentId));
    if (!binding) return null;
    return SidecarRuntimeBindingProjectionSchema.parse(withoutPrivateBindingFields(binding));
  }

  cleanup(packageId: string, componentId: string): void {
    this.bindings.delete(bindingKey(packageId, componentId));
  }

  private requireBinding(packageId: string, componentId: string): PrivateSidecarRuntimeBinding {
    const binding = this.bindings.get(bindingKey(packageId, componentId));
    if (!binding) throw new AppPlatformError("ambiguous_runtime_state", "Sidecar binding is unavailable");
    return binding;
  }
}

export class GenericSidecarSupervisor {
  readonly bindingService: SidecarRuntimeBindingService;
  private readonly drivers: Map<SidecarRuntimeDriver["runtimeKind"], SidecarRuntimeDriver>;
  private readonly ids: { next(): string };
  private readonly clock: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;
  private readonly audit: NonNullable<SidecarSupervisorOptions["audit"]>;
  private readonly records = new Map<string, SidecarRuntimeRecord>();
  private readonly diagnostics = new Map<string, SidecarLifecycleDiagnosticEvent[]>();
  private diagnosticSequence = 0;

  constructor(private readonly options: SidecarSupervisorOptions) {
    this.drivers = new Map(options.drivers.map((driver) => [driver.runtimeKind, driver]));
    this.ids = options.ids ?? { next: () => crypto.randomUUID() };
    this.clock = options.clock ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? 30_000;
    this.readinessPollMs = options.readinessPollMs ?? 250;
    this.audit = options.audit ?? (() => undefined);
    this.bindingService = options.bindingService ?? new SidecarRuntimeBindingService(this.ids, this.clock);
  }

  async start(input: SidecarActionInput): Promise<SidecarLifecycleSnapshot> {
    this.assertHostAuthority(input.authority);
    const existing = this.records.get(runtimeKey(input.packageId, input.componentId));
    if (existing && existing.state !== "stopped" && existing.state !== "uninstalled") return snapshot(existing);
    const selected = await this.selectSidecar(input.packageId, input.componentId);
    const driver = this.drivers.get(runtimeKind(selected.target));
    if (!driver) throw new AppPlatformError("host_incompatible", "No generic sidecar driver is available for this runtime target");
    const runtimeId = this.ids.next();
    let candidate: PrivateSidecarBindingCandidate;
    try {
      candidate = await driver.start(contextFor(selected));
    } catch (error) {
      await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, "failed", "unhealthy", this.now());
      this.recordDiagnosticFromSelected(selected, "start", "failed", "unhealthy", null, 0, safeErrorCode(error, "start_failed"));
      throw new AppPlatformError("start_failed", "Sidecar driver failed to start");
    }
    let binding: PrivateSidecarRuntimeBinding;
    try {
      binding = this.bindingService.create({ ...selected, runtimeId, candidate });
    } catch (error) {
      await driver.stop(contextFor(selected)).catch(() => undefined);
      await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, "failed", "unhealthy", this.now());
      this.recordDiagnosticFromSelected(selected, "binding_denied", "failed", "unhealthy", null, 0, safeErrorCode(error, "denied"));
      throw error;
    }
    const record: SidecarRuntimeRecord = {
      ...selected,
      driver,
      runtimeId,
      restartAttempt: 0,
      state: "starting",
      health: "unknown",
      binding,
      updatedAt: this.now(),
    };
    this.records.set(runtimeKey(input.packageId, input.componentId), record);
    await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, "running", "unknown", record.updatedAt);
    this.recordDiagnostic(record, "start", null);
    this.audit("sidecar.lifecycle.started", auditDetails(record, "allowed", null));
    return snapshot(record);
  }

  async awaitReadiness(input: SidecarActionInput, deadlineAt?: string): Promise<SidecarLifecycleSnapshot> {
    this.assertHostAuthority(input.authority);
    const record = this.requireRuntime(input.packageId, input.componentId);
    const deadline = Math.min(Date.now() + this.readinessTimeoutMs, deadlineAt ? Date.parse(deadlineAt) : Number.POSITIVE_INFINITY);
    while (Date.now() < deadline) {
      const health = await this.driverHealth(record);
      if (health.healthy) {
        record.state = "running";
        record.health = "healthy";
        record.updatedAt = this.now();
        await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, "running", "healthy", record.updatedAt);
        this.recordDiagnostic(record, "readiness", null);
        this.audit("sidecar.lifecycle.ready", auditDetails(record, "allowed", null));
        return snapshot(record);
      }
      await this.sleep(this.readinessPollMs);
    }
    record.state = "unavailable";
    record.health = "unhealthy";
    record.updatedAt = this.now();
    await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, "unavailable", "unhealthy", record.updatedAt);
    this.recordDiagnostic(record, "readiness", "readiness_failed");
    throw new AppPlatformError("readiness_failed", "Sidecar did not become ready before the deadline");
  }

  async health(input: SidecarActionInput): Promise<SidecarLifecycleSnapshot> {
    this.assertHostAuthority(input.authority);
    const record = this.requireRuntime(input.packageId, input.componentId);
    const health = await this.driverHealth(record);
    record.health = health.healthy ? "healthy" : "unhealthy";
    record.state = health.healthy ? "running" : "failed";
    record.updatedAt = this.now();
    await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, record.state, record.health, record.updatedAt);
    this.recordDiagnostic(record, "health", health.healthy ? null : safeErrorCode(health.error_code, "health_failed"));
    return snapshot(record);
  }

  async restart(input: SidecarActionInput): Promise<SidecarLifecycleSnapshot> {
    this.assertHostAuthority(input.authority);
    const prior = this.records.get(runtimeKey(input.packageId, input.componentId));
    const nextAttempt = Math.min((prior?.restartAttempt ?? 0) + 1, 3);
    if (prior) await this.stop(input, "restart", false);
    const started = await this.start(input);
    const record = this.requireRuntime(input.packageId, input.componentId);
    record.restartAttempt = nextAttempt;
    this.recordDiagnostic(record, "restart", null);
    return { ...started, restart_attempt: nextAttempt };
  }

  async stop(input: SidecarActionInput, reason: "stop" | "restart" | "uninstall" = "stop", recordStopped = true): Promise<SidecarLifecycleSnapshot> {
    this.assertHostAuthority(input.authority);
    const record = this.records.get(runtimeKey(input.packageId, input.componentId));
    if (!record) return await this.snapshot(input.packageId, input.componentId);
    await record.driver.stop(contextFor(record));
    this.bindingService.cleanup(input.packageId, input.componentId);
    record.state = "stopped";
    record.health = "unknown";
    record.updatedAt = this.now();
    this.records.delete(runtimeKey(input.packageId, input.componentId));
    if (recordStopped) await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, "stopped", "unknown", record.updatedAt);
    this.recordDiagnostic(record, reason === "restart" ? "restart" : "stop", null);
    this.audit("sidecar.lifecycle.stopped", auditDetails(record, "committed", null));
    return snapshot({ ...record, binding: { ...record.binding } });
  }

  async uninstall(input: SidecarActionInput): Promise<SidecarLifecycleSnapshot> {
    this.assertHostAuthority(input.authority);
    let record = this.records.get(runtimeKey(input.packageId, input.componentId));
    if (record) await this.stop(input, "uninstall", false);
    if (!record) {
      const selected = await this.selectSidecar(input.packageId, input.componentId, true);
      const driver = this.drivers.get(runtimeKind(selected.target));
      if (!driver) throw new AppPlatformError("host_incompatible", "No generic sidecar driver is available for this runtime target");
      record = {
        ...selected,
        driver,
        runtimeId: this.ids.next(),
        restartAttempt: 0,
        state: "stopped",
        health: "unknown",
        binding: this.emptyBinding(selected, this.ids.next()),
        updatedAt: this.now(),
      };
    }
    await record.driver.uninstall(contextFor(record));
    await record.driver.cleanup(contextFor(record));
    this.bindingService.cleanup(input.packageId, input.componentId);
    record.state = "uninstalled";
    record.health = "unknown";
    record.updatedAt = this.now();
    await this.options.store.setSidecarRuntimeState(input.packageId, input.componentId, "uninstalled", "unknown", record.updatedAt);
    this.recordDiagnostic(record, "uninstall", null);
    this.recordDiagnostic(record, "cleanup", null);
    return snapshot({ ...record, binding: this.emptyBinding(record, record.runtimeId) });
  }

  async snapshot(packageId: string, componentId: string): Promise<SidecarLifecycleSnapshot> {
    const record = this.records.get(runtimeKey(packageId, componentId));
    if (record) return snapshot(record);
    const selected = await this.selectSidecar(packageId, componentId, true);
    const component = await this.options.store.readComponent(packageId, componentId);
    return {
      package_id: packageId,
      installation_id: selected.packageRecord.installation_id,
      component_id: componentId,
      owner_component_id: selected.sidecar.owner_component_id,
      state: component?.state === "uninstalled" ? "uninstalled" : component?.state === "failed" ? "failed" : component?.state === "unavailable" ? "unavailable" : "stopped",
      health: component?.health === "healthy" || component?.health === "unhealthy" ? component.health : "unknown",
      restart_attempt: 0,
      target: null,
      runtime_kind: null,
      binding: null,
      safe_message: safeMessage(component?.state === "uninstalled" ? "uninstalled" : "stopped", component?.health === "unhealthy" ? "unhealthy" : "unknown"),
      updated_at: component?.updated_at ?? this.now(),
    };
  }

  diagnosticsFor(packageId: string, componentId: string): SidecarLifecycleDiagnosticEvent[] {
    return [...(this.diagnostics.get(runtimeKey(packageId, componentId)) ?? [])];
  }

  private async selectSidecar(packageId: string, componentId: string, allowUninstalled = false) {
    const packageRecord = await this.options.store.requirePackage(packageId);
    if (!allowUninstalled) {
      if (packageRecord.state === "uninstalled") throw new AppPlatformError("invalid_state_transition", "Cannot start sidecars from an uninstalled package");
      if (packageRecord.state !== "enabled") throw new AppPlatformError("invalid_state_transition", "Package is not enabled for sidecar lifecycle");
    }
    const sidecar = packageRecord.manifest.sidecars.find((candidate) => candidate.component_id === componentId);
    if (!sidecar) throw new AppPlatformError("not_found_within_scope", "Sidecar descriptor is unavailable", 404);
    validateSidecarDescriptor(sidecar);
    const target = sidecar.targets.find((candidate) => candidate.target === this.options.target);
    if (!target) throw new AppPlatformError("host_incompatible", "Sidecar descriptor has no compatible runtime target");
    if (!targetSupportsBinding(target, sidecar)) throw new AppPlatformError("descriptor_invalid", "Sidecar target and binding policy disagree");
    return { packageRecord, sidecar, target };
  }

  private requireRuntime(packageId: string, componentId: string): SidecarRuntimeRecord {
    const record = this.records.get(runtimeKey(packageId, componentId));
    if (!record) throw new AppPlatformError("ambiguous_runtime_state", "Sidecar runtime is not supervised");
    return record;
  }

  private assertHostAuthority(authority: SidecarOperationAuthority): void {
    if (authority.kind === "host") return;
    throw new AppPlatformError("denied", "Only the Host can operate sidecar lifecycle", 403);
  }

  private async driverHealth(record: SidecarRuntimeRecord): Promise<SidecarHealthResult> {
    try {
      const result = await record.driver.health(contextFor(record));
      return { healthy: result.healthy, error_code: safeErrorCode(result.error_code, result.healthy ? null : "health_failed") };
    } catch (error) {
      return { healthy: false, error_code: safeErrorCode(error, "health_failed") };
    }
  }

  private recordDiagnostic(record: SidecarRuntimeRecord, action: SidecarLifecycleDiagnosticEvent["action"], errorCode: string | null): void {
    const diagnostic = SidecarLifecycleDiagnosticEventSchema.parse({
      diagnostic_version: 1,
      sequence: ++this.diagnosticSequence,
      package_id: record.packageRecord.package_id,
      installation_id: record.packageRecord.installation_id,
      component_id: record.sidecar.component_id,
      owner_component_id: record.sidecar.owner_component_id,
      action,
      state: record.state,
      health: record.health,
      target: record.target.target,
      runtime_kind: record.target.runtime_kind,
      binding_class: record.binding.endpoint_class,
      restart_attempt: record.restartAttempt,
      error_code: errorCode,
      occurred_at: record.updatedAt,
    });
    const key = runtimeKey(record.packageRecord.package_id, record.sidecar.component_id);
    this.diagnostics.set(key, [...(this.diagnostics.get(key) ?? []), diagnostic]);
  }

  private recordDiagnosticFromSelected(
    selected: { packageRecord: InstalledPackageRecord; sidecar: SidecarDescriptor; target: SidecarDescriptor["targets"][number] },
    action: SidecarLifecycleDiagnosticEvent["action"],
    state: SidecarLifecycleDiagnosticEvent["state"],
    health: SidecarLifecycleDiagnosticEvent["health"],
    bindingClass: SidecarLifecycleDiagnosticEvent["binding_class"],
    restartAttempt: number,
    errorCode: string | null,
  ): void {
    const now = this.now();
    const diagnostic = SidecarLifecycleDiagnosticEventSchema.parse({
      diagnostic_version: 1,
      sequence: ++this.diagnosticSequence,
      package_id: selected.packageRecord.package_id,
      installation_id: selected.packageRecord.installation_id,
      component_id: selected.sidecar.component_id,
      owner_component_id: selected.sidecar.owner_component_id,
      action,
      state,
      health,
      target: selected.target.target,
      runtime_kind: selected.target.runtime_kind,
      binding_class: bindingClass,
      restart_attempt: restartAttempt,
      error_code: errorCode,
      occurred_at: now,
    });
    const key = runtimeKey(selected.packageRecord.package_id, selected.sidecar.component_id);
    this.diagnostics.set(key, [...(this.diagnostics.get(key) ?? []), diagnostic]);
  }

  private emptyBinding(selected: { packageRecord: InstalledPackageRecord; sidecar: SidecarDescriptor; target: SidecarDescriptor["targets"][number] }, runtimeId: string): PrivateSidecarRuntimeBinding {
    return SidecarRuntimeBindingProjectionSchema.parse({
      binding_version: 1,
      binding_id: this.ids.next(),
      package_id: selected.packageRecord.package_id,
      installation_id: selected.packageRecord.installation_id,
      component_id: selected.sidecar.component_id,
      owner_component_id: selected.sidecar.owner_component_id,
      runtime_id: runtimeId,
      binding_generation: 1,
      target: selected.target.target,
      transport: selected.sidecar.binding.transport,
      endpoint_class: endpointClass(selected.sidecar.binding.transport),
      audience: selected.sidecar.binding.visibility,
      public_bind: false,
      created_at: this.now(),
    });
  }

  private now(): string {
    return this.clock().toISOString();
  }
}

function validateSidecarDescriptor(sidecar: SidecarDescriptor): void {
  if (sidecar.binding.public_bind || sidecar.binding.consumer_projection !== "never") {
    throw new AppPlatformError("descriptor_invalid", "Sidecar descriptor attempted to expose public or consumer binding authority");
  }
}

function validateBindingCandidate(
  sidecar: SidecarDescriptor,
  target: SidecarDescriptor["targets"][number],
  candidate: PrivateSidecarBindingCandidate,
): void {
  validateSidecarDescriptor(sidecar);
  if (candidate.publicBind || candidate.hostPath || candidate.processId || candidate.containerId) {
    throw new AppPlatformError("denied", "Sidecar binding candidate contains public or host-private runtime details", 403);
  }
  if (candidate.transport !== sidecar.binding.transport || !targetSupportsBinding(target, sidecar)) {
    throw new AppPlatformError("descriptor_invalid", "Sidecar binding candidate does not match the descriptor");
  }
  if (candidate.transport === "ipc") {
    if (!candidate.ipcName || !/^bd-[a-z0-9._-]{3,80}$/.test(candidate.ipcName)) {
      throw new AppPlatformError("denied", "Sidecar IPC binding is not a private BrainDrive name", 403);
    }
    return;
  }
  if (!candidate.endpoint) throw new AppPlatformError("denied", "Sidecar network binding is missing", 403);
  let url: URL;
  try { url = new URL(candidate.endpoint); }
  catch { throw new AppPlatformError("denied", "Sidecar network binding is malformed", 403); }
  if (url.protocol !== "http:" || url.username || url.password) {
    throw new AppPlatformError("denied", "Sidecar network binding must be private and credentialless", 403);
  }
  if (candidate.transport === "loopback") {
    if (url.hostname !== "127.0.0.1" || !validPort(url.port)) {
      throw new AppPlatformError("denied", "Loopback sidecar binding must stay on BrainDrive-allocated loopback", 403);
    }
    return;
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(url.hostname) || !validPort(url.port)) {
    throw new AppPlatformError("denied", "Container sidecar binding must stay on a private internal service name", 403);
  }
}

function targetSupportsBinding(target: SidecarDescriptor["targets"][number], sidecar: SidecarDescriptor): boolean {
  if (target.runtime_kind === "container") return sidecar.binding.transport === "container_internal";
  return sidecar.binding.transport === target.bind;
}

function runtimeKind(target: SidecarDescriptor["targets"][number]): SidecarRuntimeDriver["runtimeKind"] {
  return target.runtime_kind;
}

function contextFor(input: { packageRecord: InstalledPackageRecord; sidecar: SidecarDescriptor; target: SidecarDescriptor["targets"][number] }): SidecarRuntimeDriverContext {
  return {
    packageId: input.packageRecord.package_id,
    installationId: input.packageRecord.installation_id,
    packageDigest: input.packageRecord.package_digest as `sha256:${string}`,
    sidecar: input.sidecar,
    target: input.target,
  };
}

function snapshot(record: SidecarRuntimeRecord): SidecarLifecycleSnapshot {
  return {
    package_id: record.packageRecord.package_id,
    installation_id: record.packageRecord.installation_id,
    component_id: record.sidecar.component_id,
    owner_component_id: record.sidecar.owner_component_id,
    state: record.state,
    health: record.health,
    restart_attempt: record.restartAttempt,
    target: record.target.target,
    runtime_kind: record.target.runtime_kind,
    binding: SidecarRuntimeBindingProjectionSchema.parse(withoutPrivateBindingFields(record.binding)),
    safe_message: safeMessage(record.state, record.health),
    updated_at: record.updatedAt,
  };
}

function auditDetails(record: SidecarRuntimeRecord, decision: string, errorCode: string | null): Record<string, unknown> {
  return {
    package_id: record.packageRecord.package_id,
    installation_id: record.packageRecord.installation_id,
    package_digest: record.packageRecord.package_digest,
    component_id: record.sidecar.component_id,
    owner_component_id: record.sidecar.owner_component_id,
    target: record.target.target,
    runtime_kind: record.target.runtime_kind,
    binding_class: record.binding.endpoint_class,
    decision,
    error_code: errorCode,
  };
}

function safeMessage(state: SidecarLifecycleSnapshot["state"], health: SidecarLifecycleSnapshot["health"]): string {
  if (state === "running" && health === "healthy") return "Sidecar is healthy.";
  if (state === "starting") return "Sidecar is starting.";
  if (state === "stopped") return "Sidecar is stopped.";
  if (state === "uninstalled") return "Sidecar runtime state has been removed.";
  return "Sidecar needs attention.";
}

function endpointClass(transport: PrivateSidecarBindingCandidate["transport"]): SidecarRuntimeBindingProjection["endpoint_class"] {
  if (transport === "ipc") return "ipc_authenticated";
  return transport === "loopback" ? "loopback_authenticated" : "container_internal_authenticated";
}

function runtimeKey(packageId: string, componentId: string): string {
  return `${packageId}\n${componentId}`;
}

function bindingKey(packageId: string, componentId: string): string {
  return `${packageId}\n${componentId}`;
}

function validPort(port: string): boolean {
  const value = Number(port);
  return Number.isInteger(value) && value > 0 && value <= 65_535;
}

function withoutPrivateBindingFields(binding: PrivateSidecarRuntimeBinding): SidecarRuntimeBindingProjection {
  const { endpoint: _endpoint, authorization: _authorization, ipcName: _ipcName, ...projection } = binding;
  return projection;
}

function safeErrorCode(error: unknown, fallback: string | null): string | null {
  if (error === null || error === undefined) return fallback;
  const candidate = typeof error === "string"
    ? error
    : error instanceof AppPlatformError
      ? error.code
      : error instanceof Error
        ? error.message
        : fallback;
  if (!candidate) return fallback;
  return SAFE_ERROR_PATTERN.test(candidate) && !UNSAFE_ERROR_PATTERN.test(candidate) ? candidate : fallback ?? "unknown";
}
