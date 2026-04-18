import { describe, expect, it, vi } from "vitest";

import type { VersionMetadata } from "../memory/updates/version.js";
import { createUpdateStatusService, type UpdateStatusPayload } from "./update-status.js";

function createMetadata(patch: Partial<VersionMetadata> = {}): VersionMetadata {
  return {
    version: "26.4.18",
    released: "2026-04-18T12:00:00.000Z",
    channel: "stable",
    ...patch,
  };
}

function createFetchMockWithJson(payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
}

function createService(options: {
  metadata: VersionMetadata | null;
  fetchFn?: typeof fetch;
  now?: Date;
  cacheTtlMs?: number;
}): {
  service: { getStatus: () => Promise<UpdateStatusPayload> };
  fetchFn: typeof fetch;
  loadVersionMetadataFn: (memoryRoot: string) => Promise<VersionMetadata | null>;
  setNow: (next: Date) => void;
} {
  let now = options.now ?? new Date("2026-04-18T15:00:00.000Z");
  const fetchFn =
    options.fetchFn ??
    createFetchMockWithJson({
      tag_name: "v26.4.19",
    });
  const loadVersionMetadataFn = vi.fn(async (_memoryRoot: string) => options.metadata);
  const service = createUpdateStatusService({
    memoryRoot: "/tmp/test-memory-root",
    fetchFn,
    loadVersionMetadataFn,
    nowFn: () => now,
    cacheTtlMs: options.cacheTtlMs,
  });

  return {
    service,
    fetchFn,
    loadVersionMetadataFn,
    setNow: (next: Date) => {
      now = next;
    },
  };
}

describe("update status service", () => {
  it("reports update_available=true when remote stable release is newer", async () => {
    const { service, fetchFn } = createService({
      metadata: createMetadata({ version: "26.4.18", channel: "stable" }),
      fetchFn: createFetchMockWithJson({ tag_name: "v26.4.19" }),
      now: new Date("2026-04-18T15:00:00.000Z"),
    });

    const status = await service.getStatus();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(status).toEqual({
      channel: "stable",
      current_version: "26.4.18",
      latest_stable_version: "26.4.19",
      update_available: true,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: null,
    });
  });

  it("reports update_available=false when remote stable release is equal", async () => {
    const { service } = createService({
      metadata: createMetadata({ version: "26.4.19", channel: "stable" }),
      fetchFn: createFetchMockWithJson({ tag_name: "v26.4.19" }),
    });

    await expect(service.getStatus()).resolves.toEqual({
      channel: "stable",
      current_version: "26.4.19",
      latest_stable_version: "26.4.19",
      update_available: false,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: null,
    });
  });

  it("skips remote checks and suppresses update notices on dev channel", async () => {
    const { service, fetchFn } = createService({
      metadata: createMetadata({ version: "26.4.18.4", channel: "dev" }),
    });

    await expect(service.getStatus()).resolves.toEqual({
      channel: "dev",
      current_version: "26.4.18.4",
      latest_stable_version: null,
      update_available: false,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: null,
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("suppresses indicator and records diagnostic for invalid remote tags", async () => {
    const { service } = createService({
      metadata: createMetadata({ version: "26.4.18", channel: "stable" }),
      fetchFn: createFetchMockWithJson({ tag_name: "release-26.4.19" }),
    });

    await expect(service.getStatus()).resolves.toEqual({
      channel: "stable",
      current_version: "26.4.18",
      latest_stable_version: "release-26.4.19",
      update_available: null,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: "remote_version_unparseable",
    });
  });

  it("suppresses indicator and records diagnostic for invalid local versions", async () => {
    const { service, fetchFn } = createService({
      metadata: createMetadata({ version: "26.4.beta", channel: "stable" }),
    });

    await expect(service.getStatus()).resolves.toEqual({
      channel: "stable",
      current_version: "26.4.beta",
      latest_stable_version: null,
      update_available: null,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: "local_version_unparseable",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reuses cached result within 24h without a second remote fetch", async () => {
    const { service, fetchFn, setNow } = createService({
      metadata: createMetadata({ version: "26.4.18", channel: "stable" }),
      fetchFn: createFetchMockWithJson({ tag_name: "v26.4.19" }),
    });

    const first = await service.getStatus();
    setNow(new Date("2026-04-18T16:00:00.000Z"));
    const second = await service.getStatus();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("returns a non-crashing response with no update indicator when remote fetch fails", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;
    const { service } = createService({
      metadata: createMetadata({ version: "26.4.18", channel: "stable" }),
      fetchFn,
    });

    await expect(service.getStatus()).resolves.toEqual({
      channel: "stable",
      current_version: "26.4.18",
      latest_stable_version: null,
      update_available: null,
      last_checked_at: "2026-04-18T15:00:00.000Z",
      diagnostic: "remote_fetch_failed",
    });
  });
});
