export type SearxngSidecarTransport = "container_internal" | "loopback";
export type SearxngSidecarLifecycleState =
  | "not_installed"
  | "installed"
  | "starting"
  | "ready"
  | "stopped"
  | "unhealthy"
  | "restarting"
  | "uninstalling";

export type SearxngSidecarBinding = {
  transport: SearxngSidecarTransport;
  endpoint_url: string;
};

export type SearxngSidecarSnapshot = {
  installed: boolean;
  enabled: boolean;
  lifecycle_state: "available" | "unavailable" | "disabled" | "starting" | "stopped";
  health: { state: "healthy" | "unhealthy" | "unknown"; checked_at: string | null };
  safe_message: string;
};

export type SearxngSidecarDiagnostic = {
  sequence: number;
  occurred_at: string;
  state: SearxngSidecarLifecycleState;
  action:
    | "install"
    | "start"
    | "readiness"
    | "readiness_failed"
    | "health"
    | "stop"
    | "restart"
    | "uninstall"
    | "cleanup"
    | "binding_rejected";
  endpoint_class: "container_internal" | "loopback" | null;
  public_bind: false;
  error_code: string | null;
};

export interface SearxngSidecarDriver {
  install(): Promise<void>;
  start(): Promise<void>;
  health(): Promise<{ healthy: boolean; error_code: string | null }>;
  stop(): Promise<void>;
  uninstall(): Promise<void>;
  cleanup(): Promise<void>;
}

type SearxngSidecarLifecycleOptions = {
  driver: SearxngSidecarDriver;
  binding: SearxngSidecarBinding;
  enabled?: boolean;
  installed?: boolean;
  readinessTimeoutMs?: number;
  readinessPollMs?: number;
  now?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  adapterHealth?: () => boolean;
};

export class SearxngSidecarLifecycle {
  readonly #driver: SearxngSidecarDriver;
  readonly #binding: SearxngSidecarBinding;
  readonly #enabled: boolean;
  readonly #readinessTimeoutMs: number;
  readonly #readinessPollMs: number;
  readonly #now: () => string;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #adapterHealth: () => boolean;
  #state: SearxngSidecarLifecycleState;
  #checkedAt: string | null = null;
  #sequence = 0;
  #diagnostics: SearxngSidecarDiagnostic[] = [];

  constructor(options: SearxngSidecarLifecycleOptions) {
    this.#driver = options.driver;
    this.#binding = assertPrivateSearxngBinding(options.binding);
    this.#enabled = options.enabled ?? true;
    this.#state = options.installed ? "installed" : "not_installed";
    this.#readinessTimeoutMs = Math.max(1, options.readinessTimeoutMs ?? 10_000);
    this.#readinessPollMs = Math.max(1, options.readinessPollMs ?? 250);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.#adapterHealth = options.adapterHealth ?? (() => true);
  }

  snapshot(): SearxngSidecarSnapshot {
    if (!this.#enabled) {
      return {
        installed: this.#state !== "not_installed",
        enabled: false,
        lifecycle_state: "disabled",
        health: { state: "unknown", checked_at: this.#checkedAt },
        safe_message: "Internet Search is disabled.",
      };
    }
    if (this.#state === "not_installed") {
      return {
        installed: false,
        enabled: true,
        lifecycle_state: "unavailable",
        health: { state: "unknown", checked_at: null },
        safe_message: "Internet Search is not installed.",
      };
    }
    if (this.#state === "ready") {
      const adapterHealthy = this.#adapterHealth();
      return {
        installed: true,
        enabled: true,
        lifecycle_state: "available",
        health: { state: adapterHealthy ? "healthy" : "unhealthy", checked_at: this.#checkedAt },
        safe_message: adapterHealthy ? "Internet Search is available." : "Internet Search needs attention.",
      };
    }
    if (this.#state === "stopped") {
      return {
        installed: true,
        enabled: true,
        lifecycle_state: "stopped",
        health: { state: "unknown", checked_at: this.#checkedAt },
        safe_message: "Internet Search is stopped.",
      };
    }
    if (this.#state === "starting" || this.#state === "restarting") {
      return {
        installed: true,
        enabled: true,
        lifecycle_state: "starting",
        health: { state: "unknown", checked_at: this.#checkedAt },
        safe_message: "Internet Search is starting.",
      };
    }
    return {
      installed: true,
      enabled: true,
      lifecycle_state: "unavailable",
      health: { state: "unhealthy", checked_at: this.#checkedAt },
      safe_message: "Internet Search needs attention.",
    };
  }

  diagnostics(): readonly SearxngSidecarDiagnostic[] {
    return [...this.#diagnostics];
  }

  async refresh(): Promise<SearxngSidecarSnapshot> {
    return this.health();
  }

  async install(): Promise<SearxngSidecarSnapshot> {
    if (this.#state !== "not_installed") return this.snapshot();
    await this.#driver.install();
    this.#state = "installed";
    this.#record("install", null);
    return this.snapshot();
  }

  async start(): Promise<SearxngSidecarSnapshot> {
    if (!this.#enabled) return this.snapshot();
    if (this.#state === "not_installed") await this.install();
    this.#state = "starting";
    this.#record("start", null);
    try {
      await this.#driver.start();
      const ready = await this.#awaitReadiness();
      if (ready) {
        this.#state = "ready";
        this.#checkedAt = this.#now();
        this.#record("readiness", null);
        return this.snapshot();
      }
      this.#state = "unhealthy";
      this.#checkedAt = this.#now();
      this.#record("readiness_failed", "readiness_timeout");
      return this.snapshot();
    } catch (error) {
      this.#state = "unhealthy";
      this.#checkedAt = this.#now();
      this.#record("readiness_failed", errorCode(error, "start_failed"));
      return this.snapshot();
    }
  }

  async health(): Promise<SearxngSidecarSnapshot> {
    if (!this.#enabled || this.#state === "not_installed" || this.#state === "stopped") {
      return this.snapshot();
    }
    try {
      const result = await this.#driver.health();
      this.#checkedAt = this.#now();
      if (result.healthy) {
        this.#state = "ready";
        this.#record("health", null);
      } else {
        this.#state = "unhealthy";
        this.#record("health", result.error_code ?? "health_failed");
      }
    } catch (error) {
      this.#checkedAt = this.#now();
      this.#state = "unhealthy";
      this.#record("health", errorCode(error, "health_failed"));
    }
    return this.snapshot();
  }

  async stop(_reason: "operator_stop" | "restart" | "uninstall" | "shutdown" = "operator_stop"): Promise<SearxngSidecarSnapshot> {
    if (this.#state === "not_installed") return this.snapshot();
    await this.#driver.stop();
    this.#state = "stopped";
    this.#checkedAt = this.#now();
    this.#record("stop", null);
    return this.snapshot();
  }

  async restart(): Promise<SearxngSidecarSnapshot> {
    if (this.#state === "not_installed") return this.start();
    this.#state = "restarting";
    this.#record("restart", null);
    await this.stop("restart");
    return this.start();
  }

  async uninstall(): Promise<SearxngSidecarSnapshot> {
    if (this.#state === "not_installed") return this.snapshot();
    this.#state = "uninstalling";
    this.#record("uninstall", null);
    await this.#driver.stop();
    await this.#driver.uninstall();
    await this.#driver.cleanup();
    this.#state = "not_installed";
    this.#checkedAt = this.#now();
    this.#record("cleanup", null);
    return this.snapshot();
  }

  async close(): Promise<void> {
    if (this.#state !== "not_installed" && this.#state !== "stopped") {
      await this.stop("shutdown");
    }
  }

  async #awaitReadiness(): Promise<boolean> {
    const maxAttempts = Math.max(1, Math.ceil(this.#readinessTimeoutMs / this.#readinessPollMs));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await this.#driver.health();
      if (result.healthy) return true;
      if (attempt + 1 < maxAttempts) await this.#sleep(this.#readinessPollMs);
    }
    return false;
  }

  #record(action: SearxngSidecarDiagnostic["action"], errorCodeValue: string | null): void {
    this.#diagnostics.push({
      sequence: ++this.#sequence,
      occurred_at: this.#now(),
      state: this.#state,
      action,
      endpoint_class: this.#state === "not_installed" ? null : this.#binding.transport,
      public_bind: false,
      error_code: safeSidecarErrorCode(errorCodeValue),
    });
    if (this.#diagnostics.length > 128) this.#diagnostics.splice(0, this.#diagnostics.length - 128);
  }
}

export class HttpSearxngSidecarDriver implements SearxngSidecarDriver {
  readonly #healthUrl: URL;
  readonly #probeTimeoutMs: number;

  constructor(binding: SearxngSidecarBinding, options: { healthPath?: string; probeTimeoutMs?: number } = {}) {
    const parsed = new URL(assertPrivateSearxngBinding(binding).endpoint_url);
    parsed.pathname = options.healthPath ?? "/healthz";
    parsed.search = "";
    parsed.hash = "";
    this.#healthUrl = parsed;
    this.#probeTimeoutMs = Math.max(1, options.probeTimeoutMs ?? 1_000);
  }

  async install(): Promise<void> {
    return;
  }

  async start(): Promise<void> {
    return;
  }

  async health(): Promise<{ healthy: boolean; error_code: string | null }> {
    try {
      const response = await fetch(this.#healthUrl, { signal: AbortSignal.timeout(this.#probeTimeoutMs) });
      return { healthy: response.ok, error_code: response.ok ? null : "health_failed" };
    } catch (error) {
      return { healthy: false, error_code: errorCode(error, "health_failed") };
    }
  }

  async stop(): Promise<void> {
    return;
  }

  async uninstall(): Promise<void> {
    return;
  }

  async cleanup(): Promise<void> {
    return;
  }
}

export function createConfiguredSearxngSidecarLifecycle(env: NodeJS.ProcessEnv = process.env): SearxngSidecarLifecycle | null {
  if (!readBooleanEnv(env.BRAINDRIVE_INTERNET_SEARCH_ENABLED, true)) return null;
  const endpointUrl = env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_URL?.trim();
  if (!endpointUrl) return null;
  const transport = env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_TRANSPORT === "loopback" ? "loopback" : "container_internal";
  const binding = assertPrivateSearxngBinding({ transport, endpoint_url: endpointUrl });
  return new SearxngSidecarLifecycle({
    driver: new HttpSearxngSidecarDriver(binding, {
      healthPath: env.BRAINDRIVE_INTERNET_SEARCH_SIDECAR_HEALTH_PATH?.trim() || undefined,
      probeTimeoutMs: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_HEALTH_TIMEOUT_MS, 1_000),
    }),
    binding,
    installed: true,
    readinessTimeoutMs: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_STARTUP_TIMEOUT_MS, 10_000),
    readinessPollMs: readPositiveInt(env.BRAINDRIVE_INTERNET_SEARCH_READINESS_POLL_MS, 250),
  });
}

export function assertPrivateSearxngBinding(binding: SearxngSidecarBinding): SearxngSidecarBinding {
  let parsed: URL;
  try {
    parsed = new URL(binding.endpoint_url);
  } catch {
    throw new Error("SearXNG sidecar binding must be a valid private URL");
  }
  if (parsed.protocol !== "http:") throw new Error("SearXNG sidecar binding must use the private HTTP channel");
  if (parsed.username || parsed.password) throw new Error("SearXNG sidecar binding must not include credentials");
  if (!parsed.hostname) throw new Error("SearXNG sidecar binding must name a private host");

  const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (binding.transport === "loopback") {
    if (!isLoopbackHost(hostname)) throw new Error("SearXNG loopback binding must be private loopback only");
    return { transport: binding.transport, endpoint_url: parsed.origin };
  }

  if (hostname === "0.0.0.0" || hostname === "::" || hostname === "") {
    throw new Error("SearXNG container binding must not use a public bind address");
  }
  if (isIpAddress(hostname) && !isPrivateOrLoopbackIp(hostname)) {
    throw new Error("SearXNG container binding must be private");
  }
  if (!isIpAddress(hostname) && !/^[a-z0-9][a-z0-9-]*$/.test(hostname)) {
    throw new Error("SearXNG container binding must use a Host-controlled service name");
  }
  return { transport: binding.transport, endpoint_url: parsed.origin };
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof Error && error.name === "TimeoutError" ? "health_timeout" : fallback;
}

function safeSidecarErrorCode(value: string | null): string | null {
  if (value === null) return null;
  return safeSidecarErrorCodes.has(value) ? value : "unknown";
}

const safeSidecarErrorCodes = new Set([
  "binding_rejected",
  "cleanup_failed",
  "health_failed",
  "health_timeout",
  "readiness_timeout",
  "start_failed",
  "stop_failed",
  "unknown",
]);

function readBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isIpAddress(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(":");
}

function isPrivateOrLoopbackIp(hostname: string): boolean {
  if (isLoopbackHost(hostname)) return true;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
