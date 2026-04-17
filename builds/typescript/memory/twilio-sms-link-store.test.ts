import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { TWILIO_SMS_MEMORY_RELATIVE_ROOT, TwilioSmsLinkStore } from "./twilio-sms-link-store.js";

describe("TwilioSmsLinkStore", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempRoots.splice(0).map(async (root) => {
        await rm(root, { recursive: true, force: true });
      })
    );
  });

  it("stores sender-to-conversation mapping durably and tracks inbound/outbound timestamps", async () => {
    const memoryRoot = await makeTempMemoryRoot(tempRoots);
    const sender = {
      account_sid: "ac123",
      from_number: "+14155552671",
      to_number: " +14155559999 ",
    };

    const store = new TwilioSmsLinkStore(memoryRoot);
    await store.setSenderConversationLink({
      ...sender,
      conversation_id: "conv-twilio-1",
      last_inbound_at: "2026-04-15T12:00:00.000Z",
      updated_at: "2026-04-15T12:00:00.000Z",
    });

    await store.recordOutboundTimestamp(sender, "2026-04-15T12:02:00.000Z");

    const reloaded = new TwilioSmsLinkStore(memoryRoot);
    const link = await reloaded.getSenderConversationLink(sender);

    expect(link).toMatchObject({
      account_sid: "AC123",
      from_number: "+14155552671",
      to_number: "+14155559999",
      conversation_id: "conv-twilio-1",
      last_inbound_at: "2026-04-15T12:00:00.000Z",
      last_outbound_at: "2026-04-15T12:02:00.000Z",
      updated_at: "2026-04-15T12:02:00.000Z",
    });

    expect(await reloaded.getConversationIdForSender(sender)).toBe("conv-twilio-1");

    await expect(
      stat(path.join(memoryRoot, TWILIO_SMS_MEMORY_RELATIVE_ROOT, "sender-conversation-links.json"))
    ).resolves.toBeDefined();
  });

  it("persists MessageSid dedup entries and expires them using TTL semantics", async () => {
    const memoryRoot = await makeTempMemoryRoot(tempRoots);
    const store = new TwilioSmsLinkStore(memoryRoot);

    const firstSeen = await store.rememberMessageSid({
      account_sid: "AC555",
      message_sid: "sm-1",
      ttl_seconds: 60,
      seen_at: "2026-04-15T12:10:00.000Z",
    });

    expect(firstSeen.duplicate).toBe(false);
    expect(firstSeen.record.expires_at).toBe("2026-04-15T12:11:00.000Z");

    const reloaded = new TwilioSmsLinkStore(memoryRoot);
    await expect(
      reloaded.isMessageSidDuplicate({
        account_sid: "ac555",
        message_sid: "SM-1",
        at: "2026-04-15T12:10:30.000Z",
      })
    ).resolves.toBe(true);

    await expect(
      reloaded.isMessageSidDuplicate({
        account_sid: "ac555",
        message_sid: "SM-1",
        at: "2026-04-15T12:11:01.000Z",
      })
    ).resolves.toBe(false);

    const dedupDocument = JSON.parse(
      await readFile(path.join(memoryRoot, TWILIO_SMS_MEMORY_RELATIVE_ROOT, "message-sid-dedup.json"), "utf8")
    ) as { entries?: Record<string, unknown> };
    expect(Object.keys(dedupDocument.entries ?? {})).toHaveLength(0);
  });

  it("persists rate-limit counters and period metadata independently", async () => {
    const memoryRoot = await makeTempMemoryRoot(tempRoots);
    const sender = {
      account_sid: "AC777",
      from_number: "+14155552671",
      to_number: "+14155553333",
    };

    const store = new TwilioSmsLinkStore(memoryRoot);
    await store.setRateLimitState({
      ...sender,
      period_seconds: 120,
      cap_round_trips: 4,
      current_count: 3,
      period_started_at: "2026-04-15T12:20:00.000Z",
      last_notified_at: "2026-04-15T12:20:15.000Z",
      updated_at: "2026-04-15T12:20:15.000Z",
    });

    const reloaded = new TwilioSmsLinkStore(memoryRoot);
    const state = await reloaded.getRateLimitState(sender);
    expect(state).toEqual({
      ...sender,
      period_seconds: 120,
      cap_round_trips: 4,
      current_count: 3,
      period_started_at: "2026-04-15T12:20:00.000Z",
      last_notified_at: "2026-04-15T12:20:15.000Z",
      updated_at: "2026-04-15T12:20:15.000Z",
    });

    await expect(
      stat(path.join(memoryRoot, TWILIO_SMS_MEMORY_RELATIVE_ROOT, "rate-limit-state.json"))
    ).resolves.toBeDefined();

    await expect(reloaded.clearRateLimitState(sender)).resolves.toBe(true);
    await expect(reloaded.getRateLimitState(sender)).resolves.toBeNull();
  });

  it("retains sender links, dedup entries, and rate-limit state after a store restart", async () => {
    const memoryRoot = await makeTempMemoryRoot(tempRoots);
    const sender = {
      account_sid: "AC888",
      from_number: "+14155557777",
      to_number: "+14155558888",
    };

    const firstStore = new TwilioSmsLinkStore(memoryRoot);
    await firstStore.setSenderConversationLink({
      ...sender,
      conversation_id: "conv-restart-1",
      last_inbound_at: "2026-04-15T13:00:00.000Z",
      updated_at: "2026-04-15T13:00:00.000Z",
    });
    await firstStore.rememberMessageSid({
      account_sid: sender.account_sid,
      message_sid: "SM-RESTART-1",
      ttl_seconds: 300,
      seen_at: "2026-04-15T13:00:00.000Z",
    });
    await firstStore.setRateLimitState({
      ...sender,
      period_seconds: 60,
      cap_round_trips: 2,
      current_count: 1,
      period_started_at: "2026-04-15T13:00:00.000Z",
      updated_at: "2026-04-15T13:00:01.000Z",
    });

    const restartedStore = new TwilioSmsLinkStore(memoryRoot);
    await expect(restartedStore.getConversationIdForSender(sender)).resolves.toBe("conv-restart-1");
    await expect(
      restartedStore.isMessageSidDuplicate({
        account_sid: sender.account_sid,
        message_sid: "sm-restart-1",
        at: "2026-04-15T13:00:10.000Z",
      })
    ).resolves.toBe(true);
    await expect(restartedStore.getRateLimitState(sender)).resolves.toMatchObject({
      period_seconds: 60,
      cap_round_trips: 2,
      current_count: 1,
      period_started_at: "2026-04-15T13:00:00.000Z",
    });
  });
});

async function makeTempMemoryRoot(tempRoots: string[]): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paa-twilio-link-store-test-"));
  tempRoots.push(root);
  return root;
}
