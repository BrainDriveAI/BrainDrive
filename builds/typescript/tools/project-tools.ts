import path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import type { ToolContext, ToolDefinition } from "../contracts.js";
import { resolveMemoryPath } from "../memory/paths.js";

type ProjectStatus = "complete" | "partial" | "empty";

type ProjectEntry = {
  id: string;
  name: string;
  path: string;
  status: ProjectStatus;
  files_present: string[];
};

const expectedProjectFiles = ["AGENT.md", "spec.md", "plan.md"];
const PROJECTS_MANIFEST_RELATIVE_PATH = "documents/projects.json";

export function projectTools(): ToolDefinition[] {
  return [
    {
      name: "project_list",
      description: "List projects under documents with project completeness status",
      requiresApproval: false,
      readOnly: true,
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (context: ToolContext) => listProjects(context),
    },
  ];
}

async function listProjects(context: ToolContext): Promise<{ root: string; projects: ProjectEntry[] }> {
  const documentsRoot = resolveMemoryPath(context.memoryRoot, "documents");
  const manifestPath = resolveMemoryPath(context.memoryRoot, PROJECTS_MANIFEST_RELATIVE_PATH);
  const manifestProjects = await readProjectsManifest(manifestPath);
  const projects: ProjectEntry[] = [];

  for (const project of manifestProjects) {
    const projectPath = path.join(documentsRoot, project.id);
    const files = await readdir(projectPath, { withFileTypes: true }).catch(() => []);
    const filesPresent = files
      .filter((file) => file.isFile() && expectedProjectFiles.includes(file.name))
      .map((file) => file.name)
      .sort();

    const status = computeProjectStatus(filesPresent.length);
    projects.push({
      id: project.id,
      name: project.name,
      path: projectPath,
      status,
      files_present: filesPresent,
    });
  }

  return {
    root: documentsRoot,
    projects,
  };
}

async function readProjectsManifest(pathname: string): Promise<Array<{ id: string; name: string }>> {
  try {
    const raw = await readFile(pathname, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(parseManifestProject)
      .filter((project): project is { id: string; name: string } => project !== null);
  } catch {
    return [];
  }
}

function parseManifestProject(value: unknown): { id: string; name: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id || !name) {
    return null;
  }

  return { id, name };
}

function computeProjectStatus(fileCount: number): ProjectStatus {
  if (fileCount >= expectedProjectFiles.length) {
    return "complete";
  }

  if (fileCount > 0) {
    return "partial";
  }

  return "empty";
}
