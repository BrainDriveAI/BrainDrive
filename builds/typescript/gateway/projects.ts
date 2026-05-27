import path from "node:path";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { commitMemoryChange } from "../git.js";
import { isProtectedProjectId, scaffoldProjectFiles } from "../memory/init.js";
import type { ProjectIndexEntry } from "../memory/folder-index.js";
import { upsertProjectIndexEntry } from "../memory/folder-index.js";
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

type UploadedMarkdownOptions =
  | (Omit<ProjectIndexEntry, "fileName"> | ((filePath: string, fileName: string) => Omit<ProjectIndexEntry, "fileName">))
  | {
      directory?: string;
      preferredFileName?: string;
      indexEntry?: Omit<ProjectIndexEntry, "fileName"> | ((filePath: string, fileName: string) => Omit<ProjectIndexEntry, "fileName">);
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

    const files = await this.listProjectFilesRecursive(projectId, root);

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
    const relativePath = path.relative(this.memoryRoot, resolvedPath);
    await commitMemoryChange(this.memoryRoot, `Update ${relativePath} via UI`).catch(() => {});
    return true;
  }

  async createUploadedMarkdownFile(
    projectId: string,
    requestedFileName: string,
    content: string,
    options?: UploadedMarkdownOptions
  ): Promise<GatewayProjectFile | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }

    if (isProtectedProjectId(projectId)) {
      throw new ProtectedProjectError(projectId);
    }

    const projectRoot = this.projectRootPath(projectId);
    const normalizedOptions = normalizeUploadedMarkdownOptions(options);
    const uploadDirectory = normalizeProjectSubdirectory(normalizedOptions.directory);
    const uploadRoot = uploadDirectory ? path.join(projectRoot, uploadDirectory) : projectRoot;
    await mkdir(uploadRoot, { recursive: true });

    const fileName = await this.nextAvailableMarkdownFileName(
      projectId,
      normalizedOptions.preferredFileName ?? requestedFileName,
      uploadDirectory
    );
    const projectRelativePath = uploadDirectory ? `${uploadDirectory}/${fileName}` : fileName;
    const requestedPath = `documents/${projectId}/${projectRelativePath}`;
    const resolvedPath = this.resolveProjectScopedPath(projectId, requestedPath);
    if (!resolvedPath) {
      throw new Error("Invalid path");
    }

    await writeFile(resolvedPath, content, "utf8");
    if (normalizedOptions.indexEntry) {
      const resolvedIndexEntry = typeof normalizedOptions.indexEntry === "function"
        ? normalizedOptions.indexEntry(projectRelativePath, fileName)
        : normalizedOptions.indexEntry;
      if (projectId === "finance" && uploadDirectory === "statements") {
        await upsertFinanceStatementsReadmeEntry(this.memoryRoot, {
          fileName: projectRelativePath,
          ...resolvedIndexEntry,
        });
      } else {
        await upsertProjectIndexEntry(this.memoryRoot, projectId, {
          fileName: projectRelativePath,
          ...resolvedIndexEntry,
        });
      }
    }
    const relativePath = path.relative(this.memoryRoot, resolvedPath);
    await commitMemoryChange(this.memoryRoot, `Upload ${relativePath} via UI`).catch(() => {});

    return {
      name: fileName,
      path: requestedPath,
    };
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

  private async nextAvailableMarkdownFileName(
    projectId: string,
    requestedFileName: string,
    subdirectory = ""
  ): Promise<string> {
    const baseName = slugifyFileName(stripKnownExtension(requestedFileName));
    const targetRoot = subdirectory
      ? path.join(this.projectRootPath(projectId), subdirectory)
      : this.projectRootPath(projectId);
    let index = 1;

    while (true) {
      const suffix = index === 1 ? "" : `-${index}`;
      const fileName = `${baseName}${suffix}.md`;
      const candidateRelativePath = subdirectory ? `${subdirectory}/${fileName}` : fileName;
      const candidate = resolveMemoryPath(this.memoryRoot, `documents/${projectId}/${candidateRelativePath}`);
      if (!existsSync(candidate) || !candidate.startsWith(`${targetRoot}${path.sep}`)) {
        if (!candidate.startsWith(`${targetRoot}${path.sep}`)) {
          throw new Error("Invalid path");
        }
        return fileName;
      }
      index += 1;
    }
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

async function upsertFinanceStatementsReadmeEntry(memoryRoot: string, entry: ProjectIndexEntry): Promise<void> {
  const readmePath = resolveMemoryPath(memoryRoot, "documents/finance/statements/README.md");
  await mkdir(path.dirname(readmePath), { recursive: true });
  const current = await readFile(readmePath, "utf8").catch(() => defaultFinanceStatementsReadme());
  const next = upsertSourceEvidenceEntryContent(current, entry);
  if (next !== current) {
    await writeFile(readmePath, next, "utf8");
  }
}

function defaultFinanceStatementsReadme(): string {
  return [
    "# Finance Statements",
    "",
    "*Source evidence folder for uploaded bank and credit-card statement markdown.*",
    "",
    "Files here are source evidence. Do not rewrite statement content except through explicit source-management or conversion-correction workflows.",
    "",
    "## Source Evidence",
    "",
    "| File | Type | Summary | Read When | Imported |",
    "|---|---|---|---|---|",
    "| _No source evidence uploaded yet._ | | | | |",
    "",
  ].join("\n");
}

function upsertSourceEvidenceEntryContent(content: string, entry: ProjectIndexEntry): string {
  const marker = "## Source Evidence";
  const tableHeader = "| File | Type | Summary | Read When | Imported |";
  const separator = "|---|---|---|---|---|";
  const normalized = normalizeSourceEvidenceEntry(entry);
  const lines = content.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => line.trim() === marker);
  const prefix = markerIndex >= 0
    ? lines.slice(0, markerIndex + 1)
    : [...content.trimEnd().split(/\r?\n/), "", marker];
  const rows = lines
    .slice(markerIndex >= 0 ? markerIndex + 1 : lines.length)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && !line.includes("_No source evidence uploaded yet._"))
    .filter((line) => line !== tableHeader && line !== separator)
    .filter((line) => !line.startsWith(`| \`${normalized.fileName}\` |`));

  rows.push(renderSourceEvidenceRow(normalized));
  rows.sort((left, right) => left.localeCompare(right));

  return [
    ...prefix,
    "",
    tableHeader,
    separator,
    ...rows,
    "",
  ].join("\n");
}

function normalizeSourceEvidenceEntry(entry: ProjectIndexEntry): ProjectIndexEntry {
  return {
    fileName: normalizeSourceEvidenceCell(entry.fileName, "uploaded-source.md"),
    type: normalizeSourceEvidenceCell(entry.type, "Source"),
    summary: normalizeSourceEvidenceCell(entry.summary, "Uploaded source evidence."),
    readWhen: normalizeSourceEvidenceCell(entry.readWhen, `User asks about ${entry.fileName}.`),
    importedAt: normalizeSourceEvidenceCell(entry.importedAt ?? "", ""),
  };
}

function renderSourceEvidenceRow(entry: ProjectIndexEntry): string {
  return `| \`${entry.fileName}\` | ${entry.type} | ${entry.summary} | ${entry.readWhen} | ${entry.importedAt ?? ""} |`;
}

function normalizeSourceEvidenceCell(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeUploadedMarkdownOptions(options: UploadedMarkdownOptions | undefined): {
  directory?: string;
  preferredFileName?: string;
  indexEntry?: Omit<ProjectIndexEntry, "fileName"> | ((filePath: string, fileName: string) => Omit<ProjectIndexEntry, "fileName">);
} {
  if (!options) {
    return {};
  }
  if (typeof options === "function") {
    return { indexEntry: options };
  }
  if ("type" in options && "summary" in options && "readWhen" in options) {
    return { indexEntry: options };
  }
  return options;
}

function normalizeProjectSubdirectory(value: string | undefined): string {
  if (!value) {
    return "";
  }
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    return "";
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid path");
  }
  return parts.join("/");
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

function stripKnownExtension(fileName: string): string {
  const parsed = path.parse(fileName.replace(/\\/g, "/"));
  const baseName = parsed.name || parsed.base || "uploaded-document";
  return baseName;
}

function slugifyFileName(name: string): string {
  const value = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value.length > 0 ? value : "uploaded-document";
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
