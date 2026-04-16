import path from "node:path";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";

import { resolveMemoryPath } from "./paths.js";

export const TWILIO_SMS_MEMORY_RELATIVE_ROOT = "system/integrations/twilio-sms";

const SENDER_LINKS_RELATIVE_PATH = `${TWILIO_SMS_MEMORY_RELATIVE_ROOT}/sender-conversation-links.json`;
const DEDUP_RELATIVE_PATH = `${TWILIO_SMS_MEMORY_RELATIVE_ROOT}/message-sid-dedup.json`;
const RATE_LIMIT_RELATIVE_PATH = `${TWILIO_SMS_MEMORY_RELATIVE_ROOT}/rate-limit-state.json`;

const DOCUMENT_VERSION = 1;

export type TwilioSmsSenderKey = {
  account_sid: string;
  from_number: string;
  to_number: string;
};

export type TwilioSmsSenderConversationLink = TwilioSmsSenderKey & {
  conversation_id: string;
  updated_at: string;
  last_inbound_at?: string;
  last_outbound_at?: string;
};

export type TwilioSmsSetSenderConversationLinkInput = TwilioSmsSenderKey & {
  conversation_id: string;
  updated_at?: string;
  last_inbound_at?: string;
  last_outbound_at?: string;
};

export type TwilioSmsMessageSidDedupRecord = {
  account_sid: string;
  message_sid: string;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string;
};

export type TwilioSmsRememberMessageSidInput = {
  account_sid: string;
  message_sid: string;
  ttl_seconds: number;
  seen_at?: string;
};

export type TwilioSmsRateLimitState = TwilioSmsSenderKey & {
  period_seconds: number;
  cap_round_trips: number;
  current_count: number;
  period_started_at: string;
  last_notified_at?: string;
  updated_at: string;
};

export type TwilioSmsSetRateLimitStateInput = TwilioSmsSenderKey & {
  period_seconds: number;
  cap_round_trips: number;
  current_count: number;
  period_started_at: string;
  last_notified_at?: string;
  updated_at?: string;
};

type SenderLinksDocument = {
  version: number;
  links: Record<string, TwilioSmsSenderConversationLink>;
};

type DedupDocument = {
  version: number;
  entries: Record<string, TwilioSmsMessageSidDedupRecord>;
};

type RateLimitDocument = {
  version: number;
  states: Record<string, TwilioSmsRateLimitState>;
};

export class TwilioSmsLinkStore {
  private readonly memoryRoot: string;
  private readonly integrationRootPath: string;
  private readonly senderLinksPath: string;
  private readonly dedupPath: string;
  private readonly rateLimitPath: string;

  constructor(memoryRoot: string) {
    this.memoryRoot = path.resolve(memoryRoot);
    this.integrationRootPath = resolveMemoryPath(this.memoryRoot, TWILIO_SMS_MEMORY_RELATIVE_ROOT);
    this.senderLinksPath = resolveMemoryPath(this.memoryRoot, SENDER_LINKS_RELATIVE_PATH);
    this.dedupPath = resolveMemoryPath(this.memoryRoot, DEDUP_RELATIVE_PATH);
    this.rateLimitPath = resolveMemoryPath(this.memoryRoot, RATE_LIMIT_RELATIVE_PATH);
  }

  async getConversationIdForSender(input: TwilioSmsSenderKey): Promise<string | null> {
    const link = await this.getSenderConversationLink(input);
    return link?.conversation_id ?? null;
  }

  async getSenderConversationLink(input: TwilioSmsSenderKey): Promise<TwilioSmsSenderConversationLink | null> {
    const key = normalizeSenderKey(input);
    const document = await this.readSenderLinksDocument();
    return document.links[senderCompositeKey(key)] ?? null;
  }

  async setSenderConversationLink(input: TwilioSmsSetSenderConversationLinkInput): Promise<TwilioSmsSenderConversationLink> {
    const sender = normalizeSenderKey(input);
    const conversationId = normalizeRequiredString(input.conversation_id, "conversation_id");
    const now = normalizeTimestamp(input.updated_at ?? new Date().toISOString(), "updated_at");

    const document = await this.readSenderLinksDocument();
    const compositeKey = senderCompositeKey(sender);
    const current = document.links[compositeKey];
    const next: TwilioSmsSenderConversationLink = {
      ...sender,
      conversation_id: conversationId,
      updated_at: now,
      ...(input.last_inbound_at !== undefined
        ? { last_inbound_at: normalizeTimestamp(input.last_inbound_at, "last_inbound_at") }
        : current?.last_inbound_at
          ? { last_inbound_at: current.last_inbound_at }
          : {}),
      ...(input.last_outbound_at !== undefined
        ? { last_outbound_at: normalizeTimestamp(input.last_outbound_at, "last_outbound_at") }
        : current?.last_outbound_at
          ? { last_outbound_at: current.last_outbound_at }
          : {}),
    };

    document.links[compositeKey] = next;
    await this.writeSenderLinksDocument(document);
    return next;
  }

  async recordInboundTimestamp(input: TwilioSmsSenderKey, occurredAt: string = new Date().toISOString()): Promise<TwilioSmsSenderConversationLink | null> {
    return this.recordDirectionTimestamp(input, "last_inbound_at", occurredAt);
  }

  async recordOutboundTimestamp(input: TwilioSmsSenderKey, occurredAt: string = new Date().toISOString()): Promise<TwilioSmsSenderConversationLink | null> {
    return this.recordDirectionTimestamp(input, "last_outbound_at", occurredAt);
  }

  async isMessageSidDuplicate(input: {
    account_sid: string;
    message_sid: string;
    at?: string;
  }): Promise<boolean> {
    const accountSid = normalizeAccountSid(input.account_sid);
    const messageSid = normalizeMessageSid(input.message_sid);
    const at = normalizeTimestamp(input.at ?? new Date().toISOString(), "at");

    const pruned = await this.readDedupDocumentPruned(at);
    const entry = pruned.document.entries[dedupCompositeKey(accountSid, messageSid)];

    if (pruned.pruned) {
      await this.writeDedupDocument(pruned.document);
    }

    return Boolean(entry);
  }

  async rememberMessageSid(
    input: TwilioSmsRememberMessageSidInput
  ): Promise<{ duplicate: boolean; record: TwilioSmsMessageSidDedupRecord }> {
    const accountSid = normalizeAccountSid(input.account_sid);
    const messageSid = normalizeMessageSid(input.message_sid);
    const ttlSeconds = normalizePositiveInteger(input.ttl_seconds, "ttl_seconds");
    const seenAt = normalizeTimestamp(input.seen_at ?? new Date().toISOString(), "seen_at");
    const expiresAt = new Date(toEpochMillis(seenAt) + ttlSeconds * 1000).toISOString();

    const pruned = await this.readDedupDocumentPruned(seenAt);
    const compositeKey = dedupCompositeKey(accountSid, messageSid);
    const existing = pruned.document.entries[compositeKey];

    let duplicate = false;
    let next: TwilioSmsMessageSidDedupRecord;
    if (existing) {
      duplicate = true;
      next = {
        ...existing,
        last_seen_at: seenAt,
        expires_at:
          toEpochMillis(existing.expires_at) > toEpochMillis(expiresAt) ? existing.expires_at : expiresAt,
      };
    } else {
      next = {
        account_sid: accountSid,
        message_sid: messageSid,
        first_seen_at: seenAt,
        last_seen_at: seenAt,
        expires_at: expiresAt,
      };
    }

    pruned.document.entries[compositeKey] = next;
    await this.writeDedupDocument(pruned.document);
    return { duplicate, record: next };
  }

  async getRateLimitState(input: TwilioSmsSenderKey): Promise<TwilioSmsRateLimitState | null> {
    const key = normalizeSenderKey(input);
    const document = await this.readRateLimitDocument();
    return document.states[senderCompositeKey(key)] ?? null;
  }

  async setRateLimitState(input: TwilioSmsSetRateLimitStateInput): Promise<TwilioSmsRateLimitState> {
    const sender = normalizeSenderKey(input);
    const next: TwilioSmsRateLimitState = {
      ...sender,
      period_seconds: normalizeNonNegativeInteger(input.period_seconds, "period_seconds"),
      cap_round_trips: normalizeNonNegativeInteger(input.cap_round_trips, "cap_round_trips"),
      current_count: normalizeNonNegativeInteger(input.current_count, "current_count"),
      period_started_at: normalizeTimestamp(input.period_started_at, "period_started_at"),
      ...(input.last_notified_at !== undefined
        ? { last_notified_at: normalizeTimestamp(input.last_notified_at, "last_notified_at") }
        : {}),
      updated_at: normalizeTimestamp(input.updated_at ?? new Date().toISOString(), "updated_at"),
    };

    const document = await this.readRateLimitDocument();
    document.states[senderCompositeKey(sender)] = next;
    await this.writeRateLimitDocument(document);
    return next;
  }

  async clearRateLimitState(input: TwilioSmsSenderKey): Promise<boolean> {
    const key = normalizeSenderKey(input);
    const document = await this.readRateLimitDocument();
    const compositeKey = senderCompositeKey(key);

    if (!document.states[compositeKey]) {
      return false;
    }

    delete document.states[compositeKey];
    await this.writeRateLimitDocument(document);
    return true;
  }

  private async recordDirectionTimestamp(
    input: TwilioSmsSenderKey,
    field: "last_inbound_at" | "last_outbound_at",
    occurredAt: string
  ): Promise<TwilioSmsSenderConversationLink | null> {
    const sender = normalizeSenderKey(input);
    const timestamp = normalizeTimestamp(occurredAt, field);
    const document = await this.readSenderLinksDocument();
    const compositeKey = senderCompositeKey(sender);
    const current = document.links[compositeKey];
    if (!current) {
      return null;
    }

    const next: TwilioSmsSenderConversationLink = {
      ...current,
      [field]: timestamp,
      updated_at: timestamp,
    };

    document.links[compositeKey] = next;
    await this.writeSenderLinksDocument(document);
    return next;
  }

  private async readSenderLinksDocument(): Promise<SenderLinksDocument> {
    const raw = await readJsonFile(this.senderLinksPath);
    return parseSenderLinksDocument(raw);
  }

  private async writeSenderLinksDocument(document: SenderLinksDocument): Promise<void> {
    await this.ensureLayout();
    await writeJsonFileAtomic(this.senderLinksPath, {
      version: DOCUMENT_VERSION,
      links: document.links,
    });
  }

  private async readDedupDocumentPruned(now: string): Promise<{ document: DedupDocument; pruned: boolean }> {
    const raw = await readJsonFile(this.dedupPath);
    const document = parseDedupDocument(raw);
    const nextEntries: Record<string, TwilioSmsMessageSidDedupRecord> = {};
    let pruned = false;

    for (const [key, value] of Object.entries(document.entries)) {
      if (toEpochMillis(value.expires_at) <= toEpochMillis(now)) {
        pruned = true;
        continue;
      }
      nextEntries[key] = value;
    }

    document.entries = nextEntries;
    return { document, pruned };
  }

  private async writeDedupDocument(document: DedupDocument): Promise<void> {
    await this.ensureLayout();
    await writeJsonFileAtomic(this.dedupPath, {
      version: DOCUMENT_VERSION,
      entries: document.entries,
    });
  }

  private async readRateLimitDocument(): Promise<RateLimitDocument> {
    const raw = await readJsonFile(this.rateLimitPath);
    return parseRateLimitDocument(raw);
  }

  private async writeRateLimitDocument(document: RateLimitDocument): Promise<void> {
    await this.ensureLayout();
    await writeJsonFileAtomic(this.rateLimitPath, {
      version: DOCUMENT_VERSION,
      states: document.states,
    });
  }

  private async ensureLayout(): Promise<void> {
    await mkdir(this.integrationRootPath, { recursive: true });
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeJsonFileAtomic(filePath: string, payload: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const content = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(tempPath, content, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch((unlinkError: NodeJS.ErrnoException) => {
      if (unlinkError.code !== "ENOENT") {
        throw unlinkError;
      }
    });
    throw error;
  }
}

function parseSenderLinksDocument(raw: unknown): SenderLinksDocument {
  const links: Record<string, TwilioSmsSenderConversationLink> = {};

  if (isRecord(raw) && isRecord(raw.links)) {
    for (const value of Object.values(raw.links)) {
      const normalized = normalizeSenderConversationLinkRecord(value);
      if (!normalized) {
        continue;
      }
      links[senderCompositeKey(normalized)] = normalized;
    }
  }

  return {
    version: DOCUMENT_VERSION,
    links,
  };
}

function parseDedupDocument(raw: unknown): DedupDocument {
  const entries: Record<string, TwilioSmsMessageSidDedupRecord> = {};

  if (isRecord(raw) && isRecord(raw.entries)) {
    for (const value of Object.values(raw.entries)) {
      const normalized = normalizeDedupRecord(value);
      if (!normalized) {
        continue;
      }
      entries[dedupCompositeKey(normalized.account_sid, normalized.message_sid)] = normalized;
    }
  }

  return {
    version: DOCUMENT_VERSION,
    entries,
  };
}

function parseRateLimitDocument(raw: unknown): RateLimitDocument {
  const states: Record<string, TwilioSmsRateLimitState> = {};

  if (isRecord(raw) && isRecord(raw.states)) {
    for (const value of Object.values(raw.states)) {
      const normalized = normalizeRateLimitStateRecord(value);
      if (!normalized) {
        continue;
      }
      states[senderCompositeKey(normalized)] = normalized;
    }
  }

  return {
    version: DOCUMENT_VERSION,
    states,
  };
}

function normalizeSenderConversationLinkRecord(value: unknown): TwilioSmsSenderConversationLink | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    const sender = normalizeSenderKey({
      account_sid: value.account_sid,
      from_number: value.from_number,
      to_number: value.to_number,
    });

    return {
      ...sender,
      conversation_id: normalizeRequiredString(value.conversation_id, "conversation_id"),
      updated_at: normalizeTimestamp(value.updated_at, "updated_at"),
      ...(value.last_inbound_at !== undefined
        ? { last_inbound_at: normalizeTimestamp(value.last_inbound_at, "last_inbound_at") }
        : {}),
      ...(value.last_outbound_at !== undefined
        ? { last_outbound_at: normalizeTimestamp(value.last_outbound_at, "last_outbound_at") }
        : {}),
    };
  } catch {
    return null;
  }
}

function normalizeDedupRecord(value: unknown): TwilioSmsMessageSidDedupRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    return {
      account_sid: normalizeAccountSid(value.account_sid),
      message_sid: normalizeMessageSid(value.message_sid),
      first_seen_at: normalizeTimestamp(value.first_seen_at, "first_seen_at"),
      last_seen_at: normalizeTimestamp(value.last_seen_at, "last_seen_at"),
      expires_at: normalizeTimestamp(value.expires_at, "expires_at"),
    };
  } catch {
    return null;
  }
}

function normalizeRateLimitStateRecord(value: unknown): TwilioSmsRateLimitState | null {
  if (!isRecord(value)) {
    return null;
  }

  try {
    const sender = normalizeSenderKey({
      account_sid: value.account_sid,
      from_number: value.from_number,
      to_number: value.to_number,
    });

    return {
      ...sender,
      period_seconds: normalizeNonNegativeInteger(value.period_seconds, "period_seconds"),
      cap_round_trips: normalizeNonNegativeInteger(value.cap_round_trips, "cap_round_trips"),
      current_count: normalizeNonNegativeInteger(value.current_count, "current_count"),
      period_started_at: normalizeTimestamp(value.period_started_at, "period_started_at"),
      ...(value.last_notified_at !== undefined
        ? { last_notified_at: normalizeTimestamp(value.last_notified_at, "last_notified_at") }
        : {}),
      updated_at: normalizeTimestamp(value.updated_at, "updated_at"),
    };
  } catch {
    return null;
  }
}

function normalizeSenderKey(input: {
  account_sid: unknown;
  from_number: unknown;
  to_number: unknown;
}): TwilioSmsSenderKey {
  return {
    account_sid: normalizeAccountSid(input.account_sid),
    from_number: normalizePhoneNumber(input.from_number, "from_number"),
    to_number: normalizePhoneNumber(input.to_number, "to_number"),
  };
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return normalized;
}

function normalizeAccountSid(value: unknown): string {
  return normalizeRequiredString(value, "account_sid").toUpperCase();
}

function normalizeMessageSid(value: unknown): string {
  return normalizeRequiredString(value, "message_sid").toUpperCase();
}

function normalizePhoneNumber(value: unknown, fieldName: string): string {
  const normalized = normalizeRequiredString(value, fieldName);
  return normalized.replace(/\s+/g, "");
}

function normalizeTimestamp(value: unknown, fieldName: string): string {
  const raw = normalizeRequiredString(value, fieldName);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} must be a valid datetime`);
  }
  return new Date(parsed).toISOString();
}

function normalizePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive number`);
  }
  return Math.floor(value);
}

function normalizeNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return Math.floor(value);
}

function senderCompositeKey(input: TwilioSmsSenderKey): string {
  return `${input.account_sid}|${input.from_number}|${input.to_number}`;
}

function dedupCompositeKey(accountSid: string, messageSid: string): string {
  return `${accountSid}|${messageSid}`;
}

function toEpochMillis(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    throw new Error("Timestamp is not a valid datetime");
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
