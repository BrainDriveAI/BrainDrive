import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike,
  type Progress,
} from "@modelcontextprotocol/client";

import {
  MCP_APPS_EXTENSION_ID,
  MCP_APP_MEDIA_TYPE,
  MCP_MODERN_PROTOCOL_VERSION,
} from "../../app-platform/contracts/constants.js";
import type {
  McpPeer,
  McpPeerNegotiation,
  McpRequestOptions,
} from "./connection-manager.js";
import { McpHostError } from "./errors.js";

export type SdkMcpPeerOptions = {
  url: string | URL;
  authorization?: string;
  clientName?: string;
  clientVersion?: string;
};

/** Official MCP v2 transport adapter for one negotiated, persistent peer. */
export class SdkMcpPeer implements McpPeer {
  private readonly client: Client;
  private readonly transport: StreamableHTTPClientTransport;

  constructor(options: SdkMcpPeerOptions) {
    this.client = new Client({
      name: options.clientName ?? "braindrive-app-host",
      version: options.clientVersion ?? "1.0.0",
    }, {
      versionNegotiation: {
        mode: { pin: MCP_MODERN_PROTOCOL_VERSION },
        probe: { maxRetries: 0 },
      },
      capabilities: {
        extensions: { [MCP_APPS_EXTENSION_ID]: { mimeTypes: [MCP_APP_MEDIA_TYPE] } },
      },
      supportedProtocolVersions: [MCP_MODERN_PROTOCOL_VERSION],
      enforceStrictCapabilities: true,
      inputRequired: { autoFulfill: false },
      listMaxPages: 64,
    });
    this.transport = new StreamableHTTPClientTransport(new URL(options.url), {
      requestInit: options.authorization
        ? { headers: { authorization: `Bearer ${options.authorization}` } }
        : undefined,
      fetch: noRedirectFetch,
      reconnectionOptions: { maxReconnectionDelay: 1_000, initialReconnectionDelay: 100, reconnectionDelayGrowFactor: 2, maxRetries: 1 },
    });
  }

  async connect(options: McpRequestOptions): Promise<McpPeerNegotiation> {
    await this.invoke(() => this.client.connect(this.transport, requestOptions(options)));
    const serverInfo = this.client.getServerVersion();
    const discover = this.client.getDiscoverResult();
    return {
      protocolVersion: this.client.getNegotiatedProtocolVersion() ?? "",
      era: this.client.getProtocolEra() ?? "legacy",
      ...(serverInfo ? { serverInfo } : {}),
      capabilities: asRecord(this.client.getServerCapabilities()),
      ...(discover ? { discover: discover as McpPeerNegotiation["discover"] } : {}),
    };
  }

  listTools(options: McpRequestOptions): Promise<unknown> {
    return this.invoke(() => this.client.listTools(undefined, { ...requestOptions(options), cacheMode: "refresh" }));
  }

  listResources(options: McpRequestOptions): Promise<unknown> {
    return this.invoke(() => this.client.listResources(undefined, { ...requestOptions(options), cacheMode: "refresh" }));
  }

  listResourceTemplates(options: McpRequestOptions): Promise<unknown> {
    return this.invoke(() => this.client.listResourceTemplates(undefined, { ...requestOptions(options), cacheMode: "refresh" }));
  }

  readResource(params: { uri: string }, options: McpRequestOptions): Promise<unknown> {
    return this.invoke(() => this.client.readResource(params, { ...requestOptions(options), cacheMode: "bypass" }));
  }

  callTool(params: { name: string; arguments: Record<string, unknown> }, options: McpRequestOptions): Promise<unknown> {
    return this.invoke(() => this.client.callTool(params, requestOptions(options)));
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private async invoke<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const hostError = findHostError(error);
      if (hostError) throw hostError;
      if (error instanceof Error && /MCP transport redirects are not permitted/.test(error.message)) {
        throw new McpHostError("resource_redirect_denied", "MCP transport redirects are not permitted", false, error);
      }
      throw error;
    }
  }
}

const noRedirectFetch: FetchLike = async (input, init) => {
  const response = await fetch(input, { ...init, redirect: "manual" });
  if (response.redirected || (response.status >= 300 && response.status < 400)) {
    throw new McpHostError("resource_redirect_denied", "MCP transport redirects are not permitted");
  }
  return response;
};

function requestOptions(options: McpRequestOptions) {
  return {
    signal: options.signal,
    timeout: options.timeoutMs,
    maxTotalTimeout: options.timeoutMs,
    ...(options.onProgress ? {
      onprogress: (progress: Progress) => options.onProgress?.({
        progress: progress.progress,
        ...(progress.total !== undefined ? { total: progress.total } : {}),
        ...(progress.message !== undefined ? { message: progress.message } : {}),
      }),
    } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function findHostError(value: unknown, depth = 0): McpHostError | undefined {
  if (value instanceof McpHostError) return value;
  if (depth >= 4 || !value || typeof value !== "object") return undefined;
  return findHostError((value as { cause?: unknown }).cause, depth + 1);
}
