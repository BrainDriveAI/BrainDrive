import path from "node:path";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { resolveMemoryPath } from "./paths.js";

export type SkillScope = "global";
export type SkillStatus = "active" | "archived";

export type SkillManifest = {
  id: string;
  name: string;
  description: string;
  scope: SkillScope;
  version: number;
  status: SkillStatus;
  tags: string[];
  updated_at: string;
  seeded_from?: string;
};

export type SkillSummary = SkillManifest;

export type SkillRecord = {
  manifest: SkillManifest;
  content: string;
  references: string[];
  assets: string[];
};

type SkillRegistry = {
  skills: SkillSummary[];
};

type SkillCreateInput = {
  id?: string;
  name: string;
  description: string;
  content: string;
  scope?: SkillScope;
  status?: SkillStatus;
  tags?: string[];
  seeded_from?: string;
};

type SkillUpdateInput = {
  name?: string;
  description?: string;
  content?: string;
  scope?: SkillScope;
  status?: SkillStatus;
  tags?: string[];
};

const SKILLS_ROOT_RELATIVE = "skills";
const SKILLS_REGISTRY_RELATIVE = "skills/registry.json";
const SKILL_CONTENT_FILE = "SKILL.md";
const SKILL_MANIFEST_FILE = "manifest.json";

export class MemorySkillStore {
  private readonly memoryRoot: string;
  private readonly skillsRoot: string;
  private readonly registryPath: string;

  constructor(memoryRoot: string) {
    this.memoryRoot = path.resolve(memoryRoot);
    this.skillsRoot = resolveMemoryPath(this.memoryRoot, SKILLS_ROOT_RELATIVE);
    this.registryPath = resolveMemoryPath(this.memoryRoot, SKILLS_REGISTRY_RELATIVE);
  }

  async ensureLayout(): Promise<void> {
    await mkdir(this.skillsRoot, { recursive: true });
    if (!existsSync(this.registryPath)) {
      await this.writeRegistry({ skills: [] });
    }
  }

  async list(): Promise<SkillSummary[]> {
    await this.ensureLayout();
    const registry = await this.readRegistry();
    return registry.skills;
  }

  async get(id: string): Promise<SkillRecord | null> {
    const skillId = normalizeSkillId(id);
    if (!skillId) {
      return null;
    }

    await this.ensureLayout();
    const entry = (await this.readRegistry()).skills.find((skill) => skill.id === skillId);
    if (!entry) {
      return null;
    }

    const directory = this.skillDirectory(skillId);
    const contentPath = path.join(directory, SKILL_CONTENT_FILE);
    const manifestPath = path.join(directory, SKILL_MANIFEST_FILE);
    if (!existsSync(contentPath) || !existsSync(manifestPath)) {
      return null;
    }

    const content = await readFile(contentPath, "utf8");
    const manifest = parseManifest(await readFile(manifestPath, "utf8"), entry);
    return {
      manifest,
      content,
      references: await listChildNames(path.join(directory, "references")),
      assets: await listChildNames(path.join(directory, "assets")),
    };
  }

  async exists(id: string): Promise<boolean> {
    const skillId = normalizeSkillId(id);
    if (!skillId) {
      return false;
    }

    const registry = await this.readRegistry();
    return registry.skills.some((skill) => skill.id === skillId);
  }

  async create(input: SkillCreateInput): Promise<SkillRecord> {
    await this.ensureLayout();
    const now = new Date().toISOString();
    const id = normalizeSkillId(input.id) ?? slugifySkillName(input.name);
    if (!id) {
      throw new Error("Invalid skill id");
    }

    const registry = await this.readRegistry();
    if (registry.skills.some((skill) => skill.id === id)) {
      throw new Error("Skill already exists");
    }

    const manifest: SkillManifest = {
      id,
      name: normalizeNonEmpty(input.name, "Skill name is required"),
      description: normalizeNonEmpty(input.description, "Skill description is required"),
      scope: input.scope ?? "global",
      version: 1,
      status: input.status ?? "active",
      tags: dedupeStrings(input.tags ?? []),
      updated_at: now,
      ...(input.seeded_from ? { seeded_from: input.seeded_from } : {}),
    };

    const content = normalizeSkillContent(input.content);
    await this.writeSkillFiles(id, manifest, content);

    registry.skills.push(manifest);
    await this.writeRegistry({ skills: sortSkills(registry.skills) });

    return {
      manifest,
      content,
      references: [],
      assets: [],
    };
  }

  async update(id: string, patch: SkillUpdateInput): Promise<SkillRecord | null> {
    await this.ensureLayout();
    const skillId = normalizeSkillId(id);
    if (!skillId) {
      return null;
    }

    const registry = await this.readRegistry();
    const index = registry.skills.findIndex((skill) => skill.id === skillId);
    if (index === -1) {
      return null;
    }

    const current = await this.get(skillId);
    if (!current) {
      return null;
    }

    if (
      patch.name === undefined &&
      patch.description === undefined &&
      patch.content === undefined &&
      patch.scope === undefined &&
      patch.status === undefined &&
      patch.tags === undefined
    ) {
      throw new Error("At least one skill field is required");
    }

    const now = new Date().toISOString();
    const nextManifest: SkillManifest = {
      ...current.manifest,
      ...(patch.name !== undefined ? { name: normalizeNonEmpty(patch.name, "Skill name is required") } : {}),
      ...(patch.description !== undefined
        ? { description: normalizeNonEmpty(patch.description, "Skill description is required") }
        : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.tags !== undefined ? { tags: dedupeStrings(patch.tags) } : {}),
      version: current.manifest.version + 1,
      updated_at: now,
    };
    const nextContent = patch.content !== undefined ? normalizeSkillContent(patch.content) : current.content;
    await this.writeSkillFiles(skillId, nextManifest, nextContent);

    registry.skills[index] = nextManifest;
    await this.writeRegistry({ skills: sortSkills(registry.skills) });

    return {
      manifest: nextManifest,
      content: nextContent,
      references: current.references,
      assets: current.assets,
    };
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureLayout();
    const skillId = normalizeSkillId(id);
    if (!skillId) {
      return false;
    }

    const registry = await this.readRegistry();
    const nextSkills = registry.skills.filter((skill) => skill.id !== skillId);
    if (nextSkills.length === registry.skills.length) {
      return false;
    }

    await rm(this.skillDirectory(skillId), { recursive: true, force: true });
    await this.writeRegistry({ skills: sortSkills(nextSkills) });
    return true;
  }

  async seedFromDirectory(seedDirectory: string): Promise<{
    seeded: string[];
    skipped: string[];
  }> {
    await this.ensureLayout();
    const seeded: string[] = [];
    const skipped: string[] = [];

    if (!existsSync(seedDirectory)) {
      return { seeded, skipped };
    }

    const entries = await readdir(seedDirectory, { withFileTypes: true });
    const markdownFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of markdownFiles) {
      const sourcePath = path.join(seedDirectory, entry.name);
      const id = slugifySkillName(path.parse(entry.name).name);
      if (!id) {
        skipped.push(entry.name);
        continue;
      }

      if (await this.exists(id)) {
        skipped.push(id);
        continue;
      }

      const content = await readFile(sourcePath, "utf8");
      const titleFromContent = extractFirstMarkdownHeading(content);
      const name = titleFromContent ?? humanizeSkillName(id);
      const description = `Starter skill seeded from ${entry.name}`;
      await this.create({
        id,
        name,
        description,
        content,
        tags: ["starter"],
        seeded_from: sourcePath,
      });
      seeded.push(id);
    }

    return { seeded, skipped };
  }

  async resolvePromptSkills(
    skillIds: string[],
    maxBytes: number
  ): Promise<{
    skills: Array<{ id: string; content: string }>;
    missing: string[];
    truncated: boolean;
  }> {
    const uniqueIds = dedupeStrings(skillIds.map((skillId) => normalizeSkillId(skillId) ?? ""));
    const skills: Array<{ id: string; content: string }> = [];
    const missing: string[] = [];
    let consumedBytes = 0;

    for (const id of uniqueIds) {
      const skill = await this.get(id);
      if (!skill) {
        missing.push(id);
        continue;
      }

      const bytes = Buffer.byteLength(skill.content, "utf8");
      if (consumedBytes + bytes > maxBytes) {
        return {
          skills,
          missing,
          truncated: true,
        };
      }

      skills.push({
        id,
        content: skill.content,
      });
      consumedBytes += bytes;
    }

    return {
      skills,
      missing,
      truncated: false,
    };
  }

  private async readRegistry(): Promise<SkillRegistry> {
    await this.ensureLayout();
    try {
      const raw = await readFile(this.registryPath, "utf8");
      const parsed = JSON.parse(raw) as { skills?: unknown };
      if (!Array.isArray(parsed.skills)) {
        return { skills: [] };
      }

      return {
        skills: sortSkills(
          parsed.skills
            .map((value) => parseSummary(value))
            .filter((entry): entry is SkillSummary => entry !== null)
        ),
      };
    } catch {
      return { skills: [] };
    }
  }

  private async writeRegistry(registry: SkillRegistry): Promise<void> {
    await mkdir(this.skillsRoot, { recursive: true });
    await writeFile(this.registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  }

  private skillDirectory(id: string): string {
    return resolveMemoryPath(this.memoryRoot, `${SKILLS_ROOT_RELATIVE}/${id}`);
  }

  private async writeSkillFiles(id: string, manifest: SkillManifest, content: string): Promise<void> {
    const directory = this.skillDirectory(id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, SKILL_CONTENT_FILE), content, "utf8");
    await writeFile(path.join(directory, SKILL_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await mkdir(path.join(directory, "references"), { recursive: true });
    await mkdir(path.join(directory, "assets"), { recursive: true });
  }
}

export async function bootstrapSkillsFromStarterPack(rootDir: string, memoryRoot: string): Promise<{
  source_dir: string | null;
  seeded: string[];
  skipped: string[];
}> {
  const store = new MemorySkillStore(memoryRoot);
  await store.ensureLayout();
  const sourceDirectory = await resolveStarterSkillsDirectory(rootDir);
  if (!sourceDirectory) {
    return {
      source_dir: null,
      seeded: [],
      skipped: [],
    };
  }

  const result = await store.seedFromDirectory(sourceDirectory);
  return {
    source_dir: sourceDirectory,
    seeded: result.seeded,
    skipped: result.skipped,
  };
}

async function resolveStarterSkillsDirectory(rootDir: string): Promise<string | null> {
  const envPath = process.env.PAA_STARTER_SKILLS_DIR?.trim();
  const starterPackDir = process.env.PAA_STARTER_PACK_DIR?.trim();
  const candidates = [
    envPath,
    starterPackDir ? path.resolve(starterPackDir, "skills") : null,
    path.resolve(rootDir, "memory", "starter-pack", "skills"),
    path.resolve(rootDir, "builds", "typescript", "memory", "starter-pack", "skills"),
    path.resolve(rootDir, "..", "..", "designs", "skills", "init"),
    path.resolve(rootDir, "designs", "skills", "init"),
  ].filter((value): value is string => Boolean(value && value.length > 0));

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore missing candidate.
    }
  }

  return null;
}

function parseSummary(input: unknown): SkillSummary | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const value = input as Record<string, unknown>;
  const id = normalizeSkillId(value.id);
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const scope = value.scope === "global" ? "global" : null;
  const status = value.status === "archived" ? "archived" : value.status === "active" ? "active" : null;
  const version = typeof value.version === "number" && Number.isInteger(value.version) && value.version > 0 ? value.version : null;
  const updatedAt = typeof value.updated_at === "string" ? value.updated_at : "";
  const tags = Array.isArray(value.tags) ? dedupeStrings(value.tags.filter((item): item is string => typeof item === "string")) : [];

  if (!id || !name || !description || !scope || !status || version === null || !updatedAt) {
    return null;
  }

  return {
    id,
    name,
    description,
    scope,
    status,
    version,
    updated_at: updatedAt,
    tags,
    ...(typeof value.seeded_from === "string" && value.seeded_from.length > 0 ? { seeded_from: value.seeded_from } : {}),
  };
}

function parseManifest(raw: string, fallback: SkillSummary): SkillManifest {
  try {
    const parsed = parseSummary(JSON.parse(raw));
    if (parsed) {
      return parsed;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

async function listChildNames(directory: string): Promise<string[]> {
  if (!existsSync(directory)) {
    return [];
  }

  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function sortSkills(skills: SkillSummary[]): SkillSummary[] {
  return [...skills].sort((left, right) => left.id.localeCompare(right.id));
}

function dedupeStrings(values: string[]): string[] {
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

function normalizeNonEmpty(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeSkillContent(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Skill content is required");
  }

  return value.endsWith("\n") ? value : `${value}\n`;
}

export function normalizeSkillId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/.test(normalized) && !/^[a-z0-9]$/.test(normalized)) {
    return null;
  }

  return normalized;
}

export function slugifySkillName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function humanizeSkillName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function extractFirstMarkdownHeading(content: string): string | null {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^#{1,3}\s+(.+)\s*$/);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}
