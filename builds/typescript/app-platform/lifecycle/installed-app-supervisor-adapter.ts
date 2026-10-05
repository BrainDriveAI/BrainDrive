import { randomUUID } from "node:crypto";
import path from "node:path";

import type { z } from "zod";

import { ContractViolation } from "../contracts/errors.js";
import {
  SupervisorCleanupRequestSchema,
  SupervisorCleanupResultSchema,
  SupervisorHealthRequestSchema,
  SupervisorHealthResultSchema,
  type InstalledAppSupervisor,
  SupervisorReadyRequestSchema,
  SupervisorReadyResultSchema,
  SupervisorReconcileRequestSchema,
  SupervisorReconcileResultSchema,
  SupervisorRegistrationRequestSchema,
  SupervisorRegistrationResultSchema,
  SupervisorStartRequestSchema,
  SupervisorStartResultSchema,
  SupervisorStopRequestSchema,
  SupervisorStopResultSchema,
  SupervisorTokenRevocationRequestSchema,
  SupervisorTokenRevocationResultSchema,
} from "../contracts/supervisor.js";
import type { CapabilityTokenBroker } from "./capability-token.js";
import type { InstallationGrantStore } from "./install-grants.js";
import type { AppSupervisor, RuntimeIdentity } from "./process-supervisor.js";
import {
  M2RuntimeRegistrationNegotiator,
  type NegotiatedRuntimeRegistration,
  type RuntimeRegistrationNegotiator,
} from "./runtime-negotiator.js";
import type { ImmutablePackageStore } from "./verified-package-store.js";

type Registration = {
  registrationId: string;
  runtime: RuntimeIdentity;
  endpointId: string;
  connectionId: string;
  negotiated: NegotiatedRuntimeRegistration;
};

export type InstalledAppSupervisorAdapterOptions = {
  packages: ImmutablePackageStore;
  processSupervisor: AppSupervisor;
  target?: "docker_linux_x64" | "desktop_windows_x64";
  tokenAuthority?: Pick<CapabilityTokenBroker, "revokeInstallation" | "permitInstallation" | "isRevoked">;
  grants?: InstallationGrantStore;
  ids?: { next(): string };
  clock?: () => Date;
  audit?: (event: string, details: Record<string, unknown>) => void;
  negotiator?: RuntimeRegistrationNegotiator;
};

const SAFE_ERROR_CODES = new Set([
  "descriptor_invalid", "runtime_conflict", "start_failed", "readiness_failed", "health_failed",
  "registration_failed", "stop_timeout", "ambiguous_runtime_state", "restart_exhausted",
  "token_revocation_failed", "orphan_cleanup_failed",
]);

/**
 * Version-1 Spec 04 adapter over the existing Spec 05 process supervisor.
 * The registration map is the installed-app dynamic registry; fixed MCP config is not involved.
 */
export class InstalledAppSupervisorAdapter implements InstalledAppSupervisor {
  private readonly registrations = new Map<string, Registration>();
  private readonly readyEndpoints = new Map<string, z.infer<typeof SupervisorRegistrationRequestSchema>["endpoint"]>();
  private readonly candidateRuntimeIds = new Set<string>();
  private readonly tokenGenerations = new Map<string, number>();
  private readonly ids: { next(): string };
  private readonly audit: NonNullable<InstalledAppSupervisorAdapterOptions["audit"]>;
  private readonly clock: () => Date;
  private readonly negotiator: RuntimeRegistrationNegotiator;

  constructor(private readonly options: InstalledAppSupervisorAdapterOptions) {
    this.ids = options.ids ?? { next: () => randomUUID() };
    this.clock = options.clock ?? (() => new Date());
    this.audit = options.audit ?? (() => undefined);
    this.negotiator = options.negotiator ?? new M2RuntimeRegistrationNegotiator(this.audit);
  }

  async start(raw: z.infer<typeof SupervisorStartRequestSchema>): Promise<z.infer<typeof SupervisorStartResultSchema>> {
    let request: z.infer<typeof SupervisorStartRequestSchema>;
    try { request = SupervisorStartRequestSchema.parse(raw); }
    catch { return this.startFailure("descriptor_invalid"); }
    try {
      if (this.options.target) {
        const desktop = this.options.target === "desktop_windows_x64";
        if (
          request.descriptor.runtime_kind !== (desktop ? "packaged_node" : "container")
          || request.descriptor.endpoint_policy.transport !== (desktop ? "loopback" : "container_internal")
        ) {
          this.emit("start", request.descriptor.installation_id, null, "failed", "descriptor_invalid");
          return this.startFailure("descriptor_invalid");
        }
      }
      const stored = await this.options.packages.resolveReferencedRuntime(
        request.descriptor.package_digest,
        request.descriptor.package_root_ref,
      );
      if (stored.entrypoint !== request.descriptor.verified_entrypoint) {
        throw new ContractViolation("package_file_mismatch", "Runtime entrypoint differs from immutable package authority");
      }
      if (this.options.grants) {
        const grant = await this.options.grants.read(request.descriptor.grant_id);
        if (
          !grant
          || grant.installation_id !== request.descriptor.installation_id
          || grant.package_digest !== request.descriptor.package_digest
          || grant.revoked_at !== null
          || Date.parse(grant.expires_at) <= this.clock().getTime()
        ) {
          throw new ContractViolation("denied", "Runtime descriptor lacks exact live grant authority");
        }
      }
      const resolvedEntrypoint = path.resolve(stored.contentRoot, ...stored.entrypoint.split("/"));
      if (!resolvedEntrypoint.startsWith(`${path.resolve(stored.contentRoot)}${path.sep}`)) {
        throw new ContractViolation("package_path_invalid", "Runtime entrypoint escaped immutable package authority");
      }
      const result = await this.options.processSupervisor.start({
        ...request.descriptor,
        resolved_entrypoint: resolvedEntrypoint,
      }, request.runtime_role);
      if (result.runtime) {
        if (request.runtime_role === "candidate") this.candidateRuntimeIds.add(result.runtime.runtime_id);
        this.tokenGenerations.set(
          request.descriptor.installation_id,
          Math.max(result.runtime.endpoint_token_generation, this.tokenGenerations.get(request.descriptor.installation_id) ?? 1),
        );
      }
      this.emit("start", request.descriptor.installation_id, result.runtime?.runtime_id ?? null, result.outcome, result.error_code);
      return SupervisorStartResultSchema.parse(result);
    } catch (error) {
      const code = this.safeCode(error, "start_failed");
      this.emit("start", request.descriptor.installation_id, null, "failed", code);
      return this.startFailure(code);
    }
  }

  async awaitReady(raw: z.infer<typeof SupervisorReadyRequestSchema>): Promise<z.infer<typeof SupervisorReadyResultSchema>> {
    const request = SupervisorReadyRequestSchema.parse(raw);
    try {
      if (Date.parse(request.deadline_at) <= this.clock().getTime()) return this.readyFailure(request.runtime, "readiness_failed", "timeout");
      const remainingMs = Math.max(0, Date.parse(request.deadline_at) - this.clock().getTime());
      const result = await this.options.processSupervisor.awaitReadiness(
        request.runtime,
        new Date(Date.now() + remainingMs).toISOString(),
      );
      if (result.endpoint) this.readyEndpoints.set(request.runtime.runtime_id, result.endpoint);
      this.emit("readiness", request.runtime.installation_id, request.runtime.runtime_id, result.outcome, result.error_code);
      return SupervisorReadyResultSchema.parse(result);
    } catch (error) {
      const code = this.safeCode(error, "readiness_failed");
      this.emit("readiness", request.runtime.installation_id, request.runtime.runtime_id, "failed", code);
      return this.readyFailure(request.runtime, code, code === "readiness_failed" ? "timeout" : "failed");
    }
  }

  async health(raw: z.infer<typeof SupervisorHealthRequestSchema>): Promise<z.infer<typeof SupervisorHealthResultSchema>> {
    const request = SupervisorHealthRequestSchema.parse(raw);
    try { return SupervisorHealthResultSchema.parse(await this.options.processSupervisor.health(request.runtime)); }
    catch (error) {
      return SupervisorHealthResultSchema.parse({
        supervisor_protocol_version: 1,
        state: "failed_recoverable",
        runtime: request.runtime,
        restart_attempt: 3,
        next_backoff_ms: null,
        error_code: this.safeCode(error, "health_failed"),
      });
    }
  }

  async register(raw: z.infer<typeof SupervisorRegistrationRequestSchema>): Promise<z.infer<typeof SupervisorRegistrationResultSchema>> {
    const request = SupervisorRegistrationRequestSchema.parse(raw);
    const observed = this.options.processSupervisor.inspect(request.runtime.installation_id);
    const exact = observed.length === 1 && observed[0]?.runtime_id === request.runtime.runtime_id;
    const readyEndpoint = this.readyEndpoints.get(request.runtime.runtime_id);
    if (!exact || request.endpoint.endpoint_token_generation !== request.runtime.endpoint_token_generation) {
      return SupervisorRegistrationResultSchema.parse({ supervisor_protocol_version: 1, outcome: "rejected", registration_id: null, error_code: "registration_failed" });
    }
    if (!readyEndpoint) {
      return SupervisorRegistrationResultSchema.parse({ supervisor_protocol_version: 1, outcome: "failed", registration_id: null, error_code: "registration_failed" });
    }
    if (!sameEndpoint(request.endpoint, readyEndpoint)) {
      return SupervisorRegistrationResultSchema.parse({ supervisor_protocol_version: 1, outcome: "rejected", registration_id: null, error_code: "registration_failed" });
    }
    const existing = this.registrations.get(request.runtime.installation_id);
    if (existing) {
      const identical = existing.runtime.runtime_id === request.runtime.runtime_id
        && existing.endpointId === request.endpoint.endpoint_id
        && existing.connectionId === request.connection_id;
      return SupervisorRegistrationResultSchema.parse({
        supervisor_protocol_version: 1,
        outcome: identical ? "already_registered" : "rejected",
        registration_id: identical ? existing.registrationId : null,
        error_code: identical ? null : "registration_failed",
      });
    }
    let connection: ReturnType<AppSupervisor["connectionFor"]>;
    try {
      const health = await this.options.processSupervisor.health(request.runtime);
      connection = this.options.processSupervisor.connectionForRuntime
        ? this.options.processSupervisor.connectionForRuntime(request.runtime)
        : this.options.processSupervisor.connectionFor(request.runtime.installation_id);
      if (
        health.state !== "ready"
        || connection.runtime.runtime_id !== request.runtime.runtime_id
        || new URL(connection.url).port !== new URL(request.endpoint.address).port
      ) {
        return SupervisorRegistrationResultSchema.parse({ supervisor_protocol_version: 1, outcome: "rejected", registration_id: null, error_code: "registration_failed" });
      }
    } catch {
      return SupervisorRegistrationResultSchema.parse({ supervisor_protocol_version: 1, outcome: "failed", registration_id: null, error_code: "registration_failed" });
    }
    let negotiated: NegotiatedRuntimeRegistration | null = null;
    try {
      negotiated = await this.negotiator.negotiate(connection, request.connection_id);
      if (negotiated.connectionId !== request.connection_id || negotiated.runtimeId !== request.runtime.runtime_id) {
        await this.negotiator.close(negotiated);
        throw new Error("negotiated authority mismatch");
      }
      if (this.candidateRuntimeIds.has(request.runtime.runtime_id)) {
        if (!this.options.processSupervisor.promoteCandidate) throw new Error("candidate promotion unavailable");
        this.options.processSupervisor.promoteCandidate(request.runtime);
        this.candidateRuntimeIds.delete(request.runtime.runtime_id);
      }
      this.options.tokenAuthority?.permitInstallation(request.runtime.installation_id);
    } catch {
      if (negotiated) await this.negotiator.close(negotiated).catch(() => undefined);
      return SupervisorRegistrationResultSchema.parse({ supervisor_protocol_version: 1, outcome: "failed", registration_id: null, error_code: "registration_failed" });
    }
    const registration: Registration = {
      registrationId: this.ids.next(),
      runtime: request.runtime,
      endpointId: request.endpoint.endpoint_id,
      connectionId: request.connection_id,
      negotiated: negotiated!,
    };
    this.registrations.set(request.runtime.installation_id, registration);
    this.emit("register", request.runtime.installation_id, request.runtime.runtime_id, "registered", null, registration.registrationId);
    return SupervisorRegistrationResultSchema.parse({ supervisor_protocol_version: 1, outcome: "registered", registration_id: registration.registrationId, error_code: null });
  }

  async stop(raw: z.infer<typeof SupervisorStopRequestSchema>): Promise<z.infer<typeof SupervisorStopResultSchema>> {
    const request = SupervisorStopRequestSchema.parse(raw);
    try {
      this.options.tokenAuthority?.revokeInstallation(request.runtime.installation_id);
      await this.removeRegistration(request.runtime.installation_id, request.runtime.runtime_id);
      const remainingMs = Math.max(0, Date.parse(request.grace_deadline_at) - this.clock().getTime());
      const result = SupervisorStopResultSchema.parse(await this.options.processSupervisor.stop(
        request.runtime,
        request.reason,
        new Date(Date.now() + remainingMs).toISOString(),
      ));
      if (result.termination_acknowledged) {
        this.candidateRuntimeIds.delete(request.runtime.runtime_id);
        this.readyEndpoints.delete(request.runtime.runtime_id);
      }
      this.emit("stop", request.runtime.installation_id, request.runtime.runtime_id, result.outcome, result.error_code);
      return result;
    } catch (error) {
      const code = this.safeCode(error, "ambiguous_runtime_state");
      return SupervisorStopResultSchema.parse({ supervisor_protocol_version: 1, outcome: "ambiguous", termination_acknowledged: false, runtime: request.runtime, error_code: code });
    }
  }

  async revokeTokens(raw: z.infer<typeof SupervisorTokenRevocationRequestSchema>): Promise<z.infer<typeof SupervisorTokenRevocationResultSchema>> {
    const request = SupervisorTokenRevocationRequestSchema.parse(raw);
    try {
      const current = Math.max(request.prior_token_generation, this.tokenGenerations.get(request.installation_id) ?? 1);
      const already = this.options.tokenAuthority?.isRevoked(request.installation_id) ?? false;
      this.options.tokenAuthority?.revokeInstallation(request.installation_id);
      await this.removeRegistration(request.installation_id, request.runtime_id);
      const next = current + 1;
      this.tokenGenerations.set(request.installation_id, next);
      this.emit("revoke_tokens", request.installation_id, request.runtime_id, already ? "already_revoked" : "revoked", null);
      return SupervisorTokenRevocationResultSchema.parse({ ...request, next_token_generation: next, outcome: already ? "already_revoked" : "revoked", error_code: null });
    } catch {
      return SupervisorTokenRevocationResultSchema.parse({ ...request, next_token_generation: request.prior_token_generation + 1, outcome: "failed", error_code: "token_revocation_failed" });
    }
  }

  async cleanup(raw: z.infer<typeof SupervisorCleanupRequestSchema>): Promise<z.infer<typeof SupervisorCleanupResultSchema>> {
    const request = SupervisorCleanupRequestSchema.parse(raw);
    const cleaned: string[] = [];
    try {
      this.options.tokenAuthority?.revokeInstallation(request.installation_id);
      await this.removeRegistration(request.installation_id, null);
      const observed = this.options.processSupervisor.inspect(request.installation_id);
      const candidates = new Map(observed.map((runtime) => [runtime.runtime_id, runtime]));
      for (const runtimeId of request.observed_runtime_ids) {
        const runtime = candidates.get(runtimeId);
        if (!runtime) continue;
        const stopped = await this.options.processSupervisor.stop(runtime, "reconcile");
        if (!stopped.termination_acknowledged) throw new Error("ambiguous stop");
        cleaned.push(runtimeId);
      }
      for (const runtime of this.options.processSupervisor.inspect(request.installation_id)) {
        const stopped = await this.options.processSupervisor.stop(runtime, "reconcile");
        if (!stopped.termination_acknowledged) throw new Error("ambiguous stop");
        cleaned.push(runtime.runtime_id);
      }
      const remaining = this.options.processSupervisor.inspect(request.installation_id).length;
      if (remaining !== 0) throw new Error("runtime remains");
      for (const runtimeId of cleaned) this.readyEndpoints.delete(runtimeId);
      this.emit("cleanup", request.installation_id, request.expected_runtime_id, cleaned.length ? "cleaned" : "no_orphans", null);
      return SupervisorCleanupResultSchema.parse({
        supervisor_protocol_version: 1,
        operation_id: request.operation_id,
        installation_id: request.installation_id,
        outcome: cleaned.length ? "cleaned" : "no_orphans",
        cleaned_runtime_ids: [...new Set(cleaned)],
        remaining_runtime_count: 0,
        registration_count: 0,
        tokens_revoked: true,
        error_code: null,
      });
    } catch {
      return SupervisorCleanupResultSchema.parse({
        supervisor_protocol_version: 1,
        operation_id: request.operation_id,
        installation_id: request.installation_id,
        outcome: "ambiguous",
        cleaned_runtime_ids: [...new Set(cleaned)],
        remaining_runtime_count: Math.min(1, this.options.processSupervisor.inspect(request.installation_id).length),
        registration_count: this.registrations.has(request.installation_id) ? 1 : 0,
        tokens_revoked: this.options.tokenAuthority?.isRevoked(request.installation_id) ?? true,
        error_code: "orphan_cleanup_failed",
      });
    }
  }

  async reconcile(raw: z.infer<typeof SupervisorReconcileRequestSchema>): Promise<z.infer<typeof SupervisorReconcileResultSchema>> {
    const request = SupervisorReconcileRequestSchema.parse(raw);
    const observed = this.options.processSupervisor.inspect(request.installation_id);
    const registration = this.registrations.get(request.installation_id);
    const runnableExpected = request.expected_state === "active";
    if (
      runnableExpected
      && request.expected_runtime
      && observed.length === 1
      && observed[0]?.runtime_id === request.expected_runtime.runtime_id
      && registration?.registrationId === request.expected_registration_id
      && registration.runtime.runtime_id === request.expected_runtime.runtime_id
    ) {
      return SupervisorReconcileResultSchema.parse({ supervisor_protocol_version: 1, outcome: "adopted", expected_runtime: request.expected_runtime, observed_runtime: observed[0], active_runtime_count: 1, registration_count: 1, tokens_revoked: false, error_code: null });
    }
    const cleanup = await this.cleanup({
      supervisor_protocol_version: 1,
      operation_id: request.operation_id,
      installation_id: request.installation_id,
      expected_runtime_id: request.expected_runtime?.runtime_id ?? null,
      observed_runtime_ids: observed.map((runtime) => runtime.runtime_id),
      requested_at: this.clock().toISOString(),
    });
    if (cleanup.outcome === "ambiguous" || cleanup.outcome === "failed") {
      return SupervisorReconcileResultSchema.parse({ supervisor_protocol_version: 1, outcome: "failed_recoverable", expected_runtime: request.expected_runtime, observed_runtime: observed[0] ?? null, active_runtime_count: cleanup.remaining_runtime_count, registration_count: cleanup.registration_count, tokens_revoked: cleanup.tokens_revoked, error_code: "orphan_cleanup_failed" });
    }
    return SupervisorReconcileResultSchema.parse({
      supervisor_protocol_version: 1,
      outcome: runnableExpected ? "stopped_orphan" : "no_runtime_expected",
      expected_runtime: runnableExpected ? request.expected_runtime : null,
      observed_runtime: null,
      active_runtime_count: 0,
      registration_count: 0,
      tokens_revoked: true,
      error_code: null,
    });
  }

  registrationCount(installationId: string): number {
    return this.registrations.has(installationId) ? 1 : 0;
  }

  connectionForRegisteredInstallation(installationId: string) {
    const registration = this.registrations.get(installationId);
    if (!registration) throw new ContractViolation("ambiguous_runtime_state", "Installed app is not dynamically registered");
    const connection = this.options.processSupervisor.connectionFor(installationId);
    if (connection.runtime.runtime_id !== registration.runtime.runtime_id) {
      throw new ContractViolation("ambiguous_runtime_state", "Dynamic registration is stale");
    }
    return connection;
  }

  /** Process-core recovery hook: remove stale connection authority before any backoff. */
  async runtimeLost(runtime: RuntimeIdentity): Promise<void> {
    this.options.tokenAuthority?.revokeInstallation(runtime.installation_id);
    await this.removeRegistration(runtime.installation_id, runtime.runtime_id);
    this.readyEndpoints.delete(runtime.runtime_id);
    this.emit("runtime_lost", runtime.installation_id, runtime.runtime_id, "revoked", null);
  }

  /** Process-core recovery hook: negotiate and register the rotated generation before reuse. */
  async runtimeRecovered(runtime: RuntimeIdentity, endpoint: z.infer<typeof SupervisorRegistrationRequestSchema>["endpoint"]): Promise<void> {
    this.readyEndpoints.set(runtime.runtime_id, endpoint);
    const result = await this.register({
      supervisor_protocol_version: 1,
      operation_id: this.ids.next(),
      runtime,
      endpoint,
      connection_id: this.ids.next(),
    });
    if (!result.registration_id || !["registered", "already_registered"].includes(result.outcome)) {
      throw new ContractViolation("ambiguous_runtime_state", "Recovered runtime could not pass M2 registration");
    }
    this.emit("runtime_recovered", runtime.installation_id, runtime.runtime_id, "registered", null, result.registration_id);
  }

  private startFailure(errorCode: string): z.infer<typeof SupervisorStartResultSchema> {
    return SupervisorStartResultSchema.parse({ supervisor_protocol_version: 1, outcome: "failed", state: "failed_recoverable", runtime: null, error_code: errorCode });
  }

  private readyFailure(runtime: RuntimeIdentity, errorCode: string, outcome: "timeout" | "failed"): z.infer<typeof SupervisorReadyResultSchema> {
    return SupervisorReadyResultSchema.parse({ supervisor_protocol_version: 1, outcome, state: "failed_recoverable", runtime, endpoint: null, error_code: errorCode });
  }

  private safeCode(error: unknown, fallback: string): string {
    const candidate = error instanceof Error && "code" in error ? String(error.code) : fallback;
    return SAFE_ERROR_CODES.has(candidate) ? candidate : fallback;
  }

  private emit(action: string, installationId: string, runtimeId: string | null, outcome: string, errorCode: string | null, registrationId: string | null = null): void {
    this.audit("app.runtime.action", {
      app_id: "ai.braindrive.resume-builder",
      installation_id: installationId,
      runtime_id: runtimeId,
      registration_id: registrationId,
      action,
      outcome,
      error_code: errorCode,
    });
  }

  private async removeRegistration(installationId: string, runtimeId: string | null): Promise<void> {
    const registration = this.registrations.get(installationId);
    if (!registration || (runtimeId !== null && registration.runtime.runtime_id !== runtimeId)) return;
    this.registrations.delete(installationId);
    await this.negotiator.close(registration.negotiated);
  }
}

function sameEndpoint(
  left: z.infer<typeof SupervisorRegistrationRequestSchema>["endpoint"],
  right: z.infer<typeof SupervisorRegistrationRequestSchema>["endpoint"],
): boolean {
  return left.endpoint_id === right.endpoint_id
    && left.transport === right.transport
    && left.address === right.address
    && left.authentication === right.authentication
    && left.endpoint_token_generation === right.endpoint_token_generation
    && left.public_bind === right.public_bind;
}
