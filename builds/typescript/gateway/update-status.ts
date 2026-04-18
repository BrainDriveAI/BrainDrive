import type { VersionMetadata } from "../memory/updates/version.js";
import {
  compareVersionTuples,
  loadVersionMetadata,
  normalizeVersionString,
} from "../memory/updates/version.js";

const GITHUB_LATEST_RELEASE_URL =
  "https://api.github.com/repos/BrainDriveAI/braindrive/releases/latest";
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type UpdateStatusDiagnostic =
  | "local_version_metadata_unavailable"
  | "local_version_unparseable"
  | "remote_fetch_failed"
  | "remote_version_unparseable"
  | "unsupported_channel";

export type UpdateStatusPayload = {
  channel: string | null;
  current_version: string | null;
  latest_stable_version: string | null;
  update_available: boolean | null;
  last_checked_at: string;
  diagnostic: UpdateStatusDiagnostic | null;
};

type UpdateStatusCacheEntry = {
  expires_at_ms: number;
  payload: UpdateStatusPayload;
};

type UpdateStatusServiceDependencies = {
  fetchFn?: typeof fetch;
  loadVersionMetadataFn?: (memoryRoot: string) => Promise<VersionMetadata | null>;
  nowFn?: () => Date;
  cacheTtlMs?: number;
};

type CreateUpdateStatusServiceOptions = {
  memoryRoot: string;
} & UpdateStatusServiceDependencies;

export function createUpdateStatusService(options: CreateUpdateStatusServiceOptions): {
  getStatus: () => Promise<UpdateStatusPayload>;
} {
  const fetchFn = options.fetchFn ?? fetch;
  const loadVersionMetadataFn = options.loadVersionMetadataFn ?? loadVersionMetadata;
  const nowFn = options.nowFn ?? (() => new Date());
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  let cache: UpdateStatusCacheEntry | null = null;

  const getStatus = async (): Promise<UpdateStatusPayload> => {
    const now = nowFn();
    const nowMs = now.getTime();
    if (cache && cache.expires_at_ms > nowMs) {
      return { ...cache.payload };
    }

    const payload = await resolveUpdateStatus({
      memoryRoot: options.memoryRoot,
      checkedAt: now,
      fetchFn,
      loadVersionMetadataFn,
    });

    cache = {
      expires_at_ms: nowMs + cacheTtlMs,
      payload,
    };

    return { ...payload };
  };

  return { getStatus };
}

type ResolveUpdateStatusOptions = {
  memoryRoot: string;
  checkedAt: Date;
  fetchFn: typeof fetch;
  loadVersionMetadataFn: (memoryRoot: string) => Promise<VersionMetadata | null>;
};

async function resolveUpdateStatus(options: ResolveUpdateStatusOptions): Promise<UpdateStatusPayload> {
  const checkedAtIso = options.checkedAt.toISOString();
  const metadata = await options.loadVersionMetadataFn(options.memoryRoot);
  if (!metadata) {
    return createPayload({
      currentVersion: null,
      channel: null,
      latestStableVersion: null,
      updateAvailable: null,
      lastCheckedAt: checkedAtIso,
      diagnostic: "local_version_metadata_unavailable",
    });
  }

  const channel = metadata.channel.trim().toLowerCase();

  if (channel === "dev") {
    return createPayload({
      currentVersion: metadata.version,
      channel,
      latestStableVersion: null,
      updateAvailable: false,
      lastCheckedAt: checkedAtIso,
      diagnostic: null,
    });
  }

  if (channel !== "stable") {
    return createPayload({
      currentVersion: metadata.version,
      channel,
      latestStableVersion: null,
      updateAvailable: null,
      lastCheckedAt: checkedAtIso,
      diagnostic: "unsupported_channel",
    });
  }

  if (!isNumericVersion(metadata.version)) {
    return createPayload({
      currentVersion: metadata.version,
      channel,
      latestStableVersion: null,
      updateAvailable: null,
      lastCheckedAt: checkedAtIso,
      diagnostic: "local_version_unparseable",
    });
  }

  let latestStableVersion: string | null = null;
  try {
    const response = await options.fetchFn(GITHUB_LATEST_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
    if (!response.ok) {
      return createPayload({
        currentVersion: metadata.version,
        channel,
        latestStableVersion: null,
        updateAvailable: null,
        lastCheckedAt: checkedAtIso,
        diagnostic: "remote_fetch_failed",
      });
    }

    const parsed = (await response.json()) as { tag_name?: unknown };
    latestStableVersion = normalizeVersionString(parsed.tag_name) ?? null;
  } catch {
    return createPayload({
      currentVersion: metadata.version,
      channel,
      latestStableVersion: null,
      updateAvailable: null,
      lastCheckedAt: checkedAtIso,
      diagnostic: "remote_fetch_failed",
    });
  }

  if (!latestStableVersion || !isNumericVersion(latestStableVersion)) {
    return createPayload({
      currentVersion: metadata.version,
      channel,
      latestStableVersion,
      updateAvailable: null,
      lastCheckedAt: checkedAtIso,
      diagnostic: "remote_version_unparseable",
    });
  }

  const comparison = compareVersionTuples(metadata.version, latestStableVersion);
  if (comparison === null) {
    return createPayload({
      currentVersion: metadata.version,
      channel,
      latestStableVersion,
      updateAvailable: null,
      lastCheckedAt: checkedAtIso,
      diagnostic: "remote_version_unparseable",
    });
  }

  return createPayload({
    currentVersion: metadata.version,
    channel,
    latestStableVersion,
    updateAvailable: comparison < 0,
    lastCheckedAt: checkedAtIso,
    diagnostic: null,
  });
}

function isNumericVersion(value: string): boolean {
  return compareVersionTuples(value, value) !== null;
}

function createPayload(input: {
  currentVersion: string | null;
  channel: string | null;
  latestStableVersion: string | null;
  updateAvailable: boolean | null;
  lastCheckedAt: string;
  diagnostic: UpdateStatusDiagnostic | null;
}): UpdateStatusPayload {
  return {
    channel: input.channel,
    current_version: input.currentVersion,
    latest_stable_version: input.latestStableVersion,
    update_available: input.updateAvailable,
    last_checked_at: input.lastCheckedAt,
    diagnostic: input.diagnostic,
  };
}
