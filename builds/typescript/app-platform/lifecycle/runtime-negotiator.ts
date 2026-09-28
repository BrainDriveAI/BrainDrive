import type { McpConnectionHandle } from "../../mcp/host/connection-manager.js";
import { McpConnectionManager } from "../../mcp/host/connection-manager.js";
import { SdkMcpPeer } from "../../mcp/host/sdk-peer.js";
import {
  RESUME_BUILDER_APP_ID,
  RESUME_BUILDER_PUBLISHER_ID,
} from "../contracts/constants.js";
import type { AppRuntimeConnection, RuntimeIdentity } from "./process-supervisor.js";

export type NegotiatedRuntimeRegistration = {
  connectionId: string;
  runtimeId: string;
};

export interface RuntimeRegistrationNegotiator {
  negotiate(
    connection: AppRuntimeConnection,
    requestedConnectionId: string,
  ): Promise<NegotiatedRuntimeRegistration>;
  close(registration: NegotiatedRuntimeRegistration): Promise<void>;
}

type ManagedRegistration = {
  manager: McpConnectionManager;
  handle: McpConnectionHandle;
  registration: NegotiatedRuntimeRegistration;
};

/** M2-backed negotiation gate used before an installed runtime enters the dynamic registry. */
export class M2RuntimeRegistrationNegotiator implements RuntimeRegistrationNegotiator {
  private readonly registrations = new Map<string, ManagedRegistration>();

  constructor(
    private readonly audit: (event: string, details: Record<string, unknown>) => void = () => undefined,
    private readonly timeoutMs = 2_000,
  ) {}

  async negotiate(connection: AppRuntimeConnection, requestedConnectionId: string): Promise<NegotiatedRuntimeRegistration> {
    await this.closeRuntime(connection.runtime.runtime_id);
    const manager = new McpConnectionManager({
      peerFactory: () => new SdkMcpPeer({ url: connection.url, authorization: connection.authorization }),
      maxReadOnlyRetries: 0,
      timeoutMs: this.timeoutMs,
      idFactory: () => requestedConnectionId,
      audit: this.audit,
    });
    try {
      const handle = await manager.connect(identity(connection.runtime));
      await manager.discover(handle);
      if (handle.connectionId !== requestedConnectionId) {
        throw new Error("M2 connection identity did not match registration authority");
      }
      const registration = { connectionId: handle.connectionId, runtimeId: connection.runtime.runtime_id };
      this.registrations.set(connection.runtime.runtime_id, { manager, handle, registration });
      return registration;
    } catch (error) {
      await manager.closeAll();
      throw error;
    }
  }

  async close(registration: NegotiatedRuntimeRegistration): Promise<void> {
    const managed = this.registrations.get(registration.runtimeId);
    if (!managed || managed.registration.connectionId !== registration.connectionId) return;
    this.registrations.delete(registration.runtimeId);
    await managed.manager.close(managed.handle).catch(() => managed.manager.closeAll());
  }

  private async closeRuntime(runtimeId: string): Promise<void> {
    const managed = this.registrations.get(runtimeId);
    if (managed) await this.close(managed.registration);
  }
}

/** Deterministic conformance fake. It proves call ordering without granting network authority. */
export class InMemoryRuntimeRegistrationNegotiator implements RuntimeRegistrationNegotiator {
  readonly calls: Array<{ action: "negotiate" | "close"; runtimeId: string; connectionId: string }> = [];
  failNext = false;

  async negotiate(connection: AppRuntimeConnection, requestedConnectionId: string): Promise<NegotiatedRuntimeRegistration> {
    this.calls.push({ action: "negotiate", runtimeId: connection.runtime.runtime_id, connectionId: requestedConnectionId });
    if (this.failNext) {
      this.failNext = false;
      throw new Error("injected negotiation failure");
    }
    return { connectionId: requestedConnectionId, runtimeId: connection.runtime.runtime_id };
  }

  async close(registration: NegotiatedRuntimeRegistration): Promise<void> {
    this.calls.push({ action: "close", runtimeId: registration.runtimeId, connectionId: registration.connectionId });
  }
}

function identity(runtime: RuntimeIdentity) {
  return {
    appId: RESUME_BUILDER_APP_ID,
    publisherId: RESUME_BUILDER_PUBLISHER_ID,
    packageDigest: runtime.package_digest as `sha256:${string}`,
    installationId: runtime.installation_id,
    runtimeId: runtime.runtime_id,
    serverId: "resume-builder",
    generation: runtime.runtime_generation,
  };
}
