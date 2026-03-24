import path from "node:path";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";

import type {
  ConversationDetail,
  ConversationMessage,
  ConversationRecord,
} from "../contracts.js";
import type {
  ConversationListResult,
  ConversationRepository,
} from "./conversation-repository.js";

type ConversationFrontmatter = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  active_skill_ids: string[];
};

type ConversationDocument = {
  frontmatter: ConversationFrontmatter;
  messages: ConversationMessage[];
};

type ConversationIndex = {
  conversations: ConversationRecord[];
};

const INDEX_FILE_NAME = "index.json";

export class MarkdownConversationStore implements ConversationRepository {
  private readonly conversationsDir: string;

  private readonly indexPath: string;

  constructor(memoryRoot: string) {
    this.conversationsDir = path.join(memoryRoot, "conversations");
    this.indexPath = path.join(this.conversationsDir, INDEX_FILE_NAME);
    mkdirSync(this.conversationsDir, { recursive: true });
    this.ensureIndex();
  }

  createConversation(id: string, initialMessage: ConversationMessage): string {
    const now = initialMessage.timestamp;
    const record: ConversationRecord = {
      id,
      title: deriveTitle(initialMessage.content),
      created_at: now,
      updated_at: now,
      message_count: 1,
    };

    const filePath = this.conversationPath(id);
    if (existsSync(filePath)) {
      throw new Error(`Conversation already exists: ${id}`);
    }

    const document = renderConversationDocument({
      frontmatter: toFrontmatter(record, []),
      messages: [initialMessage],
    });

    writeFileAtomic(filePath, document);
    this.upsertIndexRecord(record);
    return id;
  }

  appendMessage(conversationId: string, message: ConversationMessage): void {
    const filePath = this.conversationPath(conversationId);
    if (!existsSync(filePath)) {
      throw new Error("Conversation not found");
    }

    const raw = readFileSync(filePath, "utf8");
    const parsed = parseConversationDocument(raw);

    const updatedRecord: ConversationRecord = {
      id: parsed.frontmatter.id,
      title: parsed.frontmatter.title,
      created_at: parsed.frontmatter.created_at,
      updated_at: message.timestamp,
      message_count: parsed.messages.length + 1,
    };

    const updatedDocument = renderConversationDocument({
      frontmatter: toFrontmatter(updatedRecord, parsed.frontmatter.active_skill_ids),
      messages: [...parsed.messages, message],
    });

    writeFileAtomic(filePath, updatedDocument);
    this.upsertIndexRecord(updatedRecord);
  }

  listConversations(limit = 50, offset = 0): ConversationListResult {
    const safeLimit = normalizeLimit(limit);
    const safeOffset = normalizeOffset(offset);
    const index = this.readIndexWithFallback();
    const sorted = [...index.conversations].sort((left, right) =>
      right.updated_at.localeCompare(left.updated_at)
    );

    return {
      conversations: sorted.slice(safeOffset, safeOffset + safeLimit),
      total: sorted.length,
      limit: safeLimit,
      offset: safeOffset,
    };
  }

  getConversation(conversationId: string): ConversationDetail | null {
    const filePath = this.conversationPath(conversationId);
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, "utf8");
    const parsed = parseConversationDocument(raw);

    return {
      id: parsed.frontmatter.id,
      title: parsed.frontmatter.title,
      created_at: parsed.frontmatter.created_at,
      updated_at: parsed.frontmatter.updated_at,
      messages: parsed.messages,
    };
  }

  getConversationSkills(conversationId: string): string[] | null {
    const filePath = this.conversationPath(conversationId);
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, "utf8");
    const parsed = parseConversationDocument(raw);
    return [...parsed.frontmatter.active_skill_ids];
  }

  setConversationSkills(conversationId: string, skillIds: string[]): boolean {
    const filePath = this.conversationPath(conversationId);
    if (!existsSync(filePath)) {
      return false;
    }

    const raw = readFileSync(filePath, "utf8");
    const parsed = parseConversationDocument(raw);
    const deduped = dedupeStringArray(skillIds);
    const now = new Date().toISOString();
    const updatedRecord: ConversationRecord = {
      id: parsed.frontmatter.id,
      title: parsed.frontmatter.title,
      created_at: parsed.frontmatter.created_at,
      updated_at: now,
      message_count: parsed.messages.length,
    };

    const updatedDocument = renderConversationDocument({
      frontmatter: toFrontmatter(updatedRecord, deduped),
      messages: parsed.messages,
    });
    writeFileAtomic(filePath, updatedDocument);
    this.upsertIndexRecord(updatedRecord);
    return true;
  }

  private ensureIndex(): void {
    if (!existsSync(this.indexPath)) {
      this.writeIndex({
        conversations: [],
      });
      return;
    }

    try {
      this.readIndex();
    } catch {
      this.rebuildIndexFromFiles();
    }
  }

  private conversationPath(conversationId: string): string {
    return path.join(this.conversationsDir, `${conversationId}.md`);
  }

  private readIndex(): ConversationIndex {
    const raw = readFileSync(this.indexPath, "utf8");
    const parsed = JSON.parse(raw) as { conversations?: unknown };
    if (!Array.isArray(parsed.conversations)) {
      throw new Error("Invalid conversation index");
    }

    return {
      conversations: parsed.conversations.map((record) => parseConversationRecord(record)),
    };
  }

  private writeIndex(index: ConversationIndex): void {
    const normalized: ConversationIndex = {
      conversations: [...index.conversations].sort((left, right) =>
        right.updated_at.localeCompare(left.updated_at)
      ),
    };
    writeFileAtomic(this.indexPath, `${JSON.stringify(normalized, null, 2)}\n`);
  }

  private readIndexWithFallback(): ConversationIndex {
    try {
      return this.readIndex();
    } catch {
      return this.rebuildIndexFromFiles();
    }
  }

  private rebuildIndexFromFiles(): ConversationIndex {
    const records: ConversationRecord[] = [];
    const entries = readdirSync(this.conversationsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const filePath = path.join(this.conversationsDir, entry.name);
      const raw = readFileSync(filePath, "utf8");
      try {
        const parsed = parseConversationDocument(raw);
        records.push({
          id: parsed.frontmatter.id,
          title: parsed.frontmatter.title,
          created_at: parsed.frontmatter.created_at,
          updated_at: parsed.frontmatter.updated_at,
          message_count: parsed.messages.length,
        });
      } catch {
        // Ignore malformed files to keep listing resilient.
      }
    }

    const index = { conversations: records };
    this.writeIndex(index);
    return index;
  }

  private upsertIndexRecord(record: ConversationRecord): void {
    const index = this.readIndexWithFallback();
    const existingIndex = index.conversations.findIndex((entry) => entry.id === record.id);
    if (existingIndex >= 0) {
      index.conversations[existingIndex] = record;
    } else {
      index.conversations.push(record);
    }

    this.writeIndex(index);
  }
}

function renderConversationDocument(document: ConversationDocument): string {
  const messageBlocks = document.messages.map((message) => renderMessageBlock(message)).join("\n\n");
  if (messageBlocks.length === 0) {
    return `${renderFrontmatter(document.frontmatter)}\n`;
  }

  return `${renderFrontmatter(document.frontmatter)}\n\n${messageBlocks}\n`;
}

function renderFrontmatter(frontmatter: ConversationFrontmatter): string {
  return [
    "---",
    `id: ${JSON.stringify(frontmatter.id)}`,
    `title: ${frontmatter.title === null ? "null" : JSON.stringify(frontmatter.title)}`,
    `created_at: ${JSON.stringify(frontmatter.created_at)}`,
    `updated_at: ${JSON.stringify(frontmatter.updated_at)}`,
    `message_count: ${frontmatter.message_count}`,
    `active_skill_ids: ${JSON.stringify(frontmatter.active_skill_ids)}`,
    "---",
  ].join("\n");
}

function renderMessageBlock(message: ConversationMessage): string {
  return [
    `## message ${message.id}`,
    "```json",
    JSON.stringify({
      id: message.id,
      role: message.role,
      timestamp: message.timestamp,
      content: message.content,
    }),
    "```",
  ].join("\n");
}

function parseConversationDocument(markdown: string): ConversationDocument {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error("Conversation markdown is missing frontmatter");
  }

  const frontmatter = parseFrontmatter(match[1] ?? "");
  const messages = parseMessageBlocks(match[2] ?? "");

  return {
    frontmatter,
    messages,
  };
}

function parseFrontmatter(rawFrontmatter: string): ConversationFrontmatter {
  const values = new Map<string, string>();
  const lines = rawFrontmatter.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  const id = parseStringFrontmatterValue(values.get("id"), "id");
  const title = parseNullableStringFrontmatterValue(values.get("title"), "title");
  const created_at = parseStringFrontmatterValue(values.get("created_at"), "created_at");
  const updated_at = parseStringFrontmatterValue(values.get("updated_at"), "updated_at");
  const message_count = parseNumberFrontmatterValue(values.get("message_count"), "message_count");
  const active_skill_ids = parseArrayOfStringsFrontmatterValue(values.get("active_skill_ids"));

  return {
    id,
    title,
    created_at,
    updated_at,
    message_count,
    active_skill_ids,
  };
}

function parseMessageBlocks(markdownBody: string): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  const pattern = /^## message [^\n]+\n```json\n([\s\S]*?)\n```\n?/gm;
  let match: RegExpExecArray | null = pattern.exec(markdownBody);

  while (match) {
    const payload = JSON.parse(match[1] ?? "null");
    messages.push(parseConversationMessage(payload));
    match = pattern.exec(markdownBody);
  }

  return messages;
}

function parseConversationMessage(payload: unknown): ConversationMessage {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid conversation message payload");
  }

  const record = payload as Record<string, unknown>;
  const id = record.id;
  const role = record.role;
  const content = record.content;
  const timestamp = record.timestamp;

  if (typeof id !== "string") {
    throw new Error("Invalid conversation message id");
  }

  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
    throw new Error("Invalid conversation message role");
  }

  if (typeof content !== "string") {
    throw new Error("Invalid conversation message content");
  }

  if (typeof timestamp !== "string") {
    throw new Error("Invalid conversation message timestamp");
  }

  return {
    id,
    role,
    content,
    timestamp,
  };
}

function parseConversationRecord(record: unknown): ConversationRecord {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Invalid conversation index record");
  }

  const value = record as Record<string, unknown>;
  const id = value.id;
  const title = value.title;
  const created_at = value.created_at;
  const updated_at = value.updated_at;
  const message_count = value.message_count;

  if (typeof id !== "string") {
    throw new Error("Invalid conversation id");
  }

  if (title !== null && typeof title !== "string") {
    throw new Error("Invalid conversation title");
  }

  if (typeof created_at !== "string" || typeof updated_at !== "string") {
    throw new Error("Invalid conversation timestamps");
  }

  if (typeof message_count !== "number" || !Number.isFinite(message_count)) {
    throw new Error("Invalid conversation message_count");
  }

  return {
    id,
    title,
    created_at,
    updated_at,
    message_count: Math.max(0, Math.floor(message_count)),
  };
}

function parseStringFrontmatterValue(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing frontmatter value: ${key}`);
  }

  const parsed = parseFrontmatterLiteral(value);
  if (typeof parsed !== "string") {
    throw new Error(`Invalid frontmatter value: ${key}`);
  }

  return parsed;
}

function parseNullableStringFrontmatterValue(value: string | undefined, key: string): string | null {
  if (!value) {
    throw new Error(`Missing frontmatter value: ${key}`);
  }

  const parsed = parseFrontmatterLiteral(value);
  if (parsed === null) {
    return null;
  }

  if (typeof parsed !== "string") {
    throw new Error(`Invalid frontmatter value: ${key}`);
  }

  return parsed;
}

function parseNumberFrontmatterValue(value: string | undefined, key: string): number {
  if (!value) {
    throw new Error(`Missing frontmatter value: ${key}`);
  }

  const parsed = parseFrontmatterLiteral(value);
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    throw new Error(`Invalid frontmatter value: ${key}`);
  }

  return Math.max(0, Math.floor(parsed));
}

function parseFrontmatterLiteral(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseArrayOfStringsFrontmatterValue(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const parsed = parseFrontmatterLiteral(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  return dedupeStringArray(parsed.filter((entry): entry is string => typeof entry === "string"));
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) {
    return 50;
  }

  return Math.floor(limit);
}

function normalizeOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) {
    return 0;
  }

  return Math.floor(offset);
}

function writeFileAtomic(targetPath: string, content: string): void {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, targetPath);
}

function deriveTitle(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.length <= 80 ? trimmed : `${trimmed.slice(0, 77)}...`;
}

function toFrontmatter(record: ConversationRecord, activeSkillIds: string[]): ConversationFrontmatter {
  return {
    id: record.id,
    title: record.title,
    created_at: record.created_at,
    updated_at: record.updated_at,
    message_count: record.message_count,
    active_skill_ids: dedupeStringArray(activeSkillIds),
  };
}

function dedupeStringArray(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    deduped.push(normalized);
  }
  return deduped;
}
