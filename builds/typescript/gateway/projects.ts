import path from "node:path";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { commitMemoryChange } from "../git.js";
import { isProtectedProjectId, scaffoldProjectFiles } from "../memory/init.js";
import { resolveMemoryPath, toMemoryRelativePath } from "../memory/paths.js";
import {
  ROOT_AGENT_CANONICAL_ID,
  ROOT_AGENT_DISPLAY_NAME,
  ROOT_AGENT_ICON,
  ROOT_AGENT_LEGACY_IDS,
  ROOT_AGENT_TEMPLATE_ID,
  canonicalizeRootAgentProjectId,
  isRootAgentProjectId,
} from "../memory/root-agent.js";

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
const ROOT_AGENT_PROJECT: GatewayProject = {
  id: ROOT_AGENT_CANONICAL_ID,
  name: ROOT_AGENT_DISPLAY_NAME,
  icon: ROOT_AGENT_ICON,
  conversation_id: null,
  default_skill_ids: [],
};

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
    if (isProtectedProjectId(projectId)) {
      throw new ProtectedProjectError(projectId);
    }

    const projectName = name.trim();
    if (projectName.length === 0) {
      throw new Error("Project name is required");
    }

    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index === -1) {
      throw new Error("Project not found");
    }

    projects[index] = {
      ...projects[index],
      name: projectName,
    };
    await this.writeProjects(projects);
  }

  async deleteProject(projectId: string): Promise<boolean> {
    if (isProtectedProjectId(projectId)) {
      throw new ProtectedProjectError(projectId);
    }

    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === projectId);
    if (index === -1) {
      return false;
    }

    const nextProjects = projects.filter((project) => project.id !== projectId);
    await this.writeProjects(nextProjects);
    return true;
  }

  async listProjectFiles(projectId: string): Promise<ProjectFileListEnvelope | null> {
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const project = await this.getProject(effectiveProjectId);
    if (!project) {
      return null;
    }

    const root = this.projectRootPath(effectiveProjectId);
    if (!existsSync(root)) {
      return { files: [] };
    }

    const files = await this.listProjectFilesRecursive(effectiveProjectId, root);

    return { files };
  }

  async readProjectFile(projectId: string, requestedPath: string): Promise<string | null> {
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const project = await this.getProject(effectiveProjectId);
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
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const project = await this.getProject(effectiveProjectId);
    if (!project) {
      return false;
    }

    const resolvedPath = this.resolveProjectScopedPath(projectId, requestedPath);
    if (!resolvedPath) {
      throw new Error("Invalid path");
    }

    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, content, "utf8");
    const relativePath = path.relative(this.memoryRoot, resolvedPath);
    await commitMemoryChange(this.memoryRoot, `Update ${relativePath} via UI`).catch(() => {});
    return true;
  }

  async attachConversation(projectId: string, conversationId: string): Promise<void> {
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === effectiveProjectId);
    if (index === -1) {
      return;
    }

    projects[index] = {
      ...projects[index],
      conversation_id: conversationId,
    };
    await this.writeProjects(projects);
  }

  async detachConversation(projectId: string): Promise<boolean> {
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === effectiveProjectId);
    if (index === -1) {
      return false;
    }

    projects[index] = {
      ...projects[index],
      conversation_id: null,
    };
    await this.writeProjects(projects);
    return true;
  }

  async getProjectSkills(projectId: string): Promise<string[] | null> {
    const project = await this.getProject(canonicalizeRootAgentProjectId(projectId));
    if (!project) {
      return null;
    }
    return [...project.default_skill_ids];
  }

  async setProjectSkills(projectId: string, skillIds: string[]): Promise<boolean> {
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const projects = await this.readProjects();
    const index = projects.findIndex((project) => project.id === effectiveProjectId);
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
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const projects = await this.readProjects();
    return projects.find((project) => project.id === effectiveProjectId) ?? null;
  }

  private projectRootPath(projectId: string): string {
    return resolveMemoryPath(this.memoryRoot, `documents/${canonicalizeRootAgentProjectId(projectId)}`);
  }

  private resolveProjectScopedPath(projectId: string, requestedPath: string): string | null {
    const trimmed = requestedPath.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const normalized = trimmed.replace(/\\/g, "/");
    const effectiveProjectId = canonicalizeRootAgentProjectId(projectId);
    const acceptedProjectIds = isRootAgentProjectId(projectId)
      ? [ROOT_AGENT_CANONICAL_ID, ...ROOT_AGENT_LEGACY_IDS]
      : [projectId];
    let relativePath: string | null = null;
    for (const acceptedProjectId of acceptedProjectIds) {
      if (normalized.startsWith(`documents/${acceptedProjectId}/`)) {
        relativePath = `documents/${effectiveProjectId}/${normalized.slice(`documents/${acceptedProjectId}/`.length)}`;
        break;
      }
      if (normalized.startsWith(`${acceptedProjectId}/`)) {
        relativePath = `documents/${effectiveProjectId}/${normalized.slice(`${acceptedProjectId}/`.length)}`;
        break;
      }
    }
    if (relativePath === null) {
      return null;
    }

    const absolutePath = resolveMemoryPath(this.memoryRoot, relativePath);
    const absoluteProjectRoot = this.projectRootPath(effectiveProjectId);

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

    const projects = parsed
      .map(parseProjectRecord)
      .filter((project): project is GatewayProject => project !== null);
    return this.ensureRootAgentProject(projects);
  }

  private async writeProjects(projects: GatewayProject[]): Promise<void> {
    await this.ensureManifest();
    await writeFile(this.manifestPath, `${JSON.stringify(projects, null, 2)}\n`, "utf8");
  }

  private async ensureRootAgentProject(projects: GatewayProject[]): Promise<GatewayProject[]> {
    const rootAgentEntries = projects.filter((project) => isRootAgentProjectId(project.id));
    if (rootAgentEntries.length > 0) {
      const nextProjects = normalizeRootAgentProjects(projects);
      if (JSON.stringify(nextProjects) !== JSON.stringify(projects)) {
        await this.writeProjects(nextProjects);
      }
      await this.ensureRootAgentFolderCompatibility();
      await this.ensureRootAgentScaffold();
      return nextProjects;
    }

    const nextProjects = [
      ROOT_AGENT_PROJECT,
      ...projects,
    ];
    await this.writeProjects(nextProjects);
    await this.ensureRootAgentScaffold();
    return nextProjects;
  }

  private async ensureRootAgentScaffold(): Promise<void> {
    await scaffoldProjectFiles(this.rootDir, this.memoryRoot, ROOT_AGENT_PROJECT.id, ROOT_AGENT_PROJECT.name, {
      templateId: ROOT_AGENT_TEMPLATE_ID,
      force: false,
      dryRun: false,
    });
  }

  private async ensureRootAgentFolderCompatibility(): Promise<void> {
    const canonicalPath = this.projectRootPath(ROOT_AGENT_CANONICAL_ID);
    for (const legacyId of ROOT_AGENT_LEGACY_IDS) {
      const legacyPath = resolveMemoryPath(this.memoryRoot, `documents/${legacyId}`);
      if (!existsSync(legacyPath) || existsSync(canonicalPath)) {
        continue;
      }
      await cp(legacyPath, canonicalPath, { recursive: true, force: false, errorOnExist: false });
    }
  }

  private async ensureManifest(): Promise<void> {
    await mkdir(this.documentsRoot, { recursive: true });
    if (!existsSync(this.manifestPath)) {
      await writeFile(this.manifestPath, "[]\n", "utf8");
    }
  }

  private async listProjectFilesRecursive(projectId: string, root: string): Promise<GatewayProjectFile[]> {
    const files: GatewayProjectFile[] = [];
    const visit = async (directory: string, relativeDirectory = ""): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.name.startsWith(".")) {
          continue;
        }
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(absolutePath, relativePath);
          continue;
        }
        if (entry.isFile()) {
          files.push({
            name: relativePath,
            path: `documents/${projectId}/${relativePath}`,
          });
        }
      }
    };
    await visit(root);
    return files.sort((left, right) => left.name.localeCompare(right.name));
  }
}

function normalizeRootAgentProjects(projects: GatewayProject[]): GatewayProject[] {
  const rootEntries = projects.filter((project) => isRootAgentProjectId(project.id));
  if (rootEntries.length === 0) {
    return projects;
  }

  const nonRootEntries = projects.filter((project) => !isRootAgentProjectId(project.id));
  const canonicalEntry = rootEntries.find((project) => project.id === ROOT_AGENT_CANONICAL_ID);
  const primaryEntry = canonicalEntry ?? rootEntries[0]!;
  const conversationIds = dedupeStrings(
    rootEntries
      .map((project) => project.conversation_id)
      .filter((conversationId): conversationId is string => typeof conversationId === "string" && conversationId.trim().length > 0)
  );
  const rootAgent: GatewayProject = {
    id: ROOT_AGENT_CANONICAL_ID,
    name: ROOT_AGENT_DISPLAY_NAME,
    icon: ROOT_AGENT_ICON,
    conversation_id: primaryEntry.conversation_id ?? (conversationIds.length === 1 ? conversationIds[0]! : null),
    default_skill_ids: dedupeStrings(rootEntries.flatMap((project) => project.default_skill_ids)),
  };

  if (conversationIds.length <= 1) {
    return [rootAgent, ...nonRootEntries];
  }

  return [
    rootAgent,
    ...rootEntries
      .filter((project) => project.id !== ROOT_AGENT_CANONICAL_ID)
      .map((project) => ({
        ...project,
        name: ROOT_AGENT_DISPLAY_NAME,
        icon: ROOT_AGENT_ICON,
      })),
    ...nonRootEntries,
  ];
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
