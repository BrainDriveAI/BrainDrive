import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { isProtectedProjectId, scaffoldProjectFiles } from "../memory/init.js";
import { resolveMemoryPath, toMemoryRelativePath } from "../memory/paths.js";

export type GatewayProject = {
  id: string;
  name: string;
  icon: string;
  conversation_id: string | null;
  default_skill_ids: string[];
};

export type GatewayProjectFile = {
  name: string;
  path: string;
};

type ProjectListEnvelope = {
  projects: GatewayProject[];
};

type ProjectFileListEnvelope = {
  files: GatewayProjectFile[];
};

const PROJECTS_MANIFEST_RELATIVE_PATH = "documents/projects.json";
const DEFAULT_PROJECT_ICON = "folder";

export class ProtectedProjectError extends Error {
  readonly code = "project_protected";

  constructor(readonly projectId: string) {
    super(`Project is protected: ${projectId}`);
    this.name = "ProtectedProjectError";
  }
}

export class GatewayProjectService {
  private readonly rootDir: string;
  private readonly memoryRoot: string;
  private readonly documentsRoot: string;
  private readonly manifestPath: string;

  constructor(memoryRoot: string, options: { rootDir?: string } = {}) {
    this.rootDir = path.resolve(options.rootDir ?? process.cwd());
    this.memoryRoot = path.resolve(memoryRoot);
    this.documentsRoot = resolveMemoryPath(this.memoryRoot, "documents");
    this.manifestPath = resolveMemoryPath(this.memoryRoot, PROJECTS_MANIFEST_RELATIVE_PATH);
  }

  async listProjects(): Promise<ProjectListEnvelope> {
    const projects = await this.readProjects();
    return {
      projects,
    };
  }

  async createProject(name: string, icon = DEFAULT_PROJECT_ICON): Promise<GatewayProject> {
    const projectName = name.trim();
    if (projectName.length === 0) {
      throw new Error("Project name is required");
    }

    const projects = await this.readProjects();
    const desiredId = slugifyProjectName(projectName);
    const existingIds = new Set(projects.map((project) => project.id.toLowerCase()));
    const projectId = nextAvailableProjectId(desiredId, existingIds);

    const nextProject: GatewayProject = {
      id: projectId,
      name: projectName,
      icon: icon.trim().length > 0 ? icon.trim() : DEFAULT_PROJECT_ICON,
      conversation_id: null,
      default_skill_ids: [],
    };

    projects.push(nextProject);
    await this.writeProjects(projects);
    await scaffoldProjectFiles(this.rootDir, this.memoryRoot, projectId, projectName, {
      templateId: projectId,
      force: false,
      dryRun: false,
    });
    return nextProject;
  }

  async renameProject(projectId: string, name: string): Promise<void> {
    const projectName = name.trim();
    if (projectName.length === 0) {
      throw new Error("Project name is required");
    }

    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index === -1) {
      throw new Error("Project not found");
    }
    if (isProtectedProjectId(projects[index]?.id ?? projectId)) {
      throw new ProtectedProjectError(projectId);
    }

    projects[index] = {
      ...projects[index],
      name: projectName,
    };
    await this.writeProjects(projects);
  }

  async deleteProject(projectId: string): Promise<boolean> {
    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index === -1) {
      return false;
    }
    if (isProtectedProjectId(projects[index]?.id ?? projectId)) {
      throw new ProtectedProjectError(projectId);
    }

    const nextProjects = projects.filter((project) => project.id !== projectId);
    await this.writeProjects(nextProjects);
    return true;
  }

  async listProjectFiles(projectId: string): Promise<ProjectFileListEnvelope | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const root = this.projectRootPath(projectId);
    if (!existsSync(root)) {
      return { files: [] };
    }

    const entries = await readdir(root, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        name: entry.name,
        path: `documents/${projectId}/${entry.name}`,
      }));

    return { files };
  }

  async readProjectFile(projectId: string, requestedPath: string): Promise<string | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    const resolvedPath = this.resolveProjectScopedPath(projectId, requestedPath);
    if (!resolvedPath) {
      throw new Error("Invalid path");
    }

    return readFile(resolvedPath, "utf8");
  }

  async writeProjectFile(projectId: string, requestedPath: string, content: string): Promise<boolean> {
    const project = await this.getProject(projectId);
    if (!project) {
      return false;
    }

    const resolvedPath = this.resolveProjectScopedPath(projectId, requestedPath);
    if (!resolvedPath) {
      throw new Error("Invalid path");
    }

    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, content, "utf8");
    return true;
  }

  async attachConversation(projectId: string, conversationId: string): Promise<void> {
    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index === -1) {
      return;
    }

    projects[index] = {
      ...projects[index],
      conversation_id: conversationId,
    };
    await this.writeProjects(projects);
  }

  async getProjectSkills(projectId: string): Promise<string[] | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }
    return [...project.default_skill_ids];
  }

  async setProjectSkills(projectId: string, skillIds: string[]): Promise<boolean> {
    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index === -1) {
      return false;
    }

    projects[index] = {
      ...projects[index],
      default_skill_ids: dedupeStrings(skillIds),
    };
    await this.writeProjects(projects);
    return true;
  }

  async getProject(projectId: string): Promise<GatewayProject | null> {
    const projects = await this.readProjects();
    return projects.find((project) => project.id === projectId) ?? null;
  }

  private projectRootPath(projectId: string): string {
    return resolveMemoryPath(this.memoryRoot, `documents/${projectId}`);
  }

  private resolveProjectScopedPath(projectId: string, requestedPath: string): string | null {
    const trimmed = requestedPath.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const normalized = trimmed.replace(/\\/g, "/");
    let relativePath: string;
    if (normalized.startsWith(`documents/${projectId}/`)) {
      relativePath = normalized;
    } else if (normalized.startsWith(`${projectId}/`)) {
      relativePath = `documents/${normalized}`;
    } else {
      return null;
    }

    const absolutePath = resolveMemoryPath(this.memoryRoot, relativePath);
    const absoluteProjectRoot = this.projectRootPath(projectId);

    if (
      absolutePath === absoluteProjectRoot ||
      !absolutePath.startsWith(`${absoluteProjectRoot}${path.sep}`)
    ) {
      return null;
    }

    return absolutePath;
  }

  private async readProjects(): Promise<GatewayProject[]> {
    await this.ensureManifest();
    const raw = await readFile(this.manifestPath, "utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(parseProjectRecord)
      .filter((project): project is GatewayProject => project !== null);
  }

  private async writeProjects(projects: GatewayProject[]): Promise<void> {
    await this.ensureManifest();
    await writeFile(this.manifestPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  }

  private async ensureManifest(): Promise<void> {
    await mkdir(this.documentsRoot, { recursive: true });
    if (!existsSync(this.manifestPath)) {
      await writeFile(this.manifestPath, "[]\n", "utf8");
    }
  }
}

function parseProjectRecord(value: unknown): GatewayProject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = record.id;
  const name = record.name;
  const icon = record.icon;
  const conversationId = record.conversation_id;
  const defaultSkillIds = record.default_skill_ids;

  if (typeof id !== "string" || id.trim().length === 0) {
    return null;
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    return null;
  }

  if (typeof icon !== "string" || icon.trim().length === 0) {
    return null;
  }

  if (conversationId !== null && conversationId !== undefined && typeof conversationId !== "string") {
    return null;
  }

  if (defaultSkillIds !== undefined && !Array.isArray(defaultSkillIds)) {
    return null;
  }

  return {
    id: id.trim(),
    name: name.trim(),
    icon: icon.trim(),
    conversation_id: typeof conversationId === "string" ? conversationId : null,
    default_skill_ids: Array.isArray(defaultSkillIds)
      ? dedupeStrings(defaultSkillIds.filter((entry): entry is string => typeof entry === "string"))
      : [],
  };
}

function slugifyProjectName(name: string): string {
  const value = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value.length > 0 ? value : "project";
}

function nextAvailableProjectId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
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

export function isProjectMetadata(value: Record<string, unknown> | undefined): value is Record<string, unknown> & { project: string } {
  return typeof value?.project === "string" && value.project.trim().length > 0;
}

export function projectScopedRelativePath(memoryRoot: string, absolutePath: string): string {
  return toMemoryRelativePath(path.resolve(memoryRoot), path.resolve(absolutePath));
}
