import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

import { commitMemoryChange } from "../git.js";
import { renderResumeMarkdownPdf } from "../resume-renderer/renderer.js";
import { ensurePackagedAppWorkspace, type AppWorkspacePackage } from "./app-workspace-resources.js";

export const RESUME_WORKSPACE_ROOT = "apps/resume-builder";
export const RESUME_AGENT_PATH = `${RESUME_WORKSPACE_ROOT}/AGENT.md`;
export const RESUME_INTERVIEW_PATH = `${RESUME_WORKSPACE_ROOT}/run-interview.md`;
export const RESUME_PROFILE_PATH = `${RESUME_WORKSPACE_ROOT}/resume-profile.md`;
export const RESUME_DOCUMENT_PATH = `${RESUME_WORKSPACE_ROOT}/resume.md`;

const RESUME_PACKAGE_RESOURCE_ROOT = fileURLToPath(new URL("../../resume_builder/resources/workspace/", import.meta.url));
const RESUME_PACKAGE_MANIFEST = JSON.parse(
  await readFile(path.join(RESUME_PACKAGE_RESOURCE_ROOT, "workspace.json"), "utf8"),
) as { workspace_root: string; resources: string[] };
if (RESUME_PACKAGE_MANIFEST.workspace_root !== RESUME_WORKSPACE_ROOT) {
  throw new Error("Resume Builder package declares an unexpected workspace root");
}

const RESUME_WORKSPACE_PACKAGE: AppWorkspacePackage = {
  app_id: "ai.braindrive.resume-builder",
  resources: RESUME_PACKAGE_MANIFEST.resources.map((name) => ({
    source_path: path.join(RESUME_PACKAGE_RESOURCE_ROOT, name),
    target_path: `${RESUME_PACKAGE_MANIFEST.workspace_root}/${name}`,
  })),
};

const INITIAL_PROFILE = await readFile(path.join(RESUME_PACKAGE_RESOURCE_ROOT, "resume-profile.md"), "utf8");
const INITIAL_RESUME = await readFile(path.join(RESUME_PACKAGE_RESOURCE_ROOT, "resume.md"), "utf8");

export async function ensureResumeWorkspace(memoryRoot: string): Promise<void> {
  await ensurePackagedAppWorkspace(memoryRoot, RESUME_WORKSPACE_PACKAGE);
}

export async function readResumeWorkspaceDocument(
  memoryRoot: string,
  document: "agent" | "interview" | "profile" | "resume"
): Promise<string> {
  await ensureResumeWorkspace(memoryRoot);
  const relativePath = document === "agent" ? RESUME_AGENT_PATH : document === "interview" ? RESUME_INTERVIEW_PATH : document === "profile" ? RESUME_PROFILE_PATH : RESUME_DOCUMENT_PATH;
  return readFile(path.join(memoryRoot, relativePath), "utf8");
}

export async function updateResumeWorkspaceDocument(
  memoryRoot: string,
  document: "agent" | "interview" | "profile",
  content: string,
): Promise<void> {
  await ensureResumeWorkspace(memoryRoot);
  const relativePath = document === "agent" ? RESUME_AGENT_PATH : document === "interview" ? RESUME_INTERVIEW_PATH : RESUME_PROFILE_PATH;
  await writeFile(path.join(memoryRoot, relativePath), content.trimEnd().concat("\n"), "utf8");
  await commitMemoryChange(memoryRoot, `Update Resume Builder ${document} via UI`);
}

export async function renderResumeFromProfile(memoryRoot: string): Promise<string> {
  await ensureResumeWorkspace(memoryRoot);
  const profilePath = path.join(memoryRoot, RESUME_PROFILE_PATH);
  const profile = await readFile(profilePath, "utf8");
  const normalizedProfile = profile.trim();
  if (normalizedProfile === INITIAL_PROFILE.trim()) {
    throw new Error("Resume Profile is not ready yet");
  }
  const resume = formatResumeFromProfile(normalizedProfile);
  await writeFile(path.join(memoryRoot, RESUME_DOCUMENT_PATH), resume, "utf8");
  await commitMemoryChange(memoryRoot, "Render Resume Builder resume from profile");
  return resume;
}

export async function exportResumePdfFromDocument(memoryRoot: string): Promise<{ filename: string; mime_type: "application/pdf"; bytes_base64: string }> {
  await ensureResumeWorkspace(memoryRoot);
  const resume = await readFile(path.join(memoryRoot, RESUME_DOCUMENT_PATH), "utf8");
  if (resume.trim() === INITIAL_RESUME.trim()) throw new Error("Resume is not ready yet");
  const pdf = renderResumeMarkdownPdf(resume);
  return { filename: "resume.pdf", mime_type: "application/pdf", bytes_base64: pdf.bytes.toString("base64") };
}

function formatResumeFromProfile(profile: string): string {
  const source = profile.replace(/^# Resume Profile\s*/i, "").trim();
  const contactMatch = source.match(/^## Contact\s*\n([\s\S]*?)(?=^##\s|$)/m);
  const contactBlock = contactMatch?.[1]?.trim() ?? "";
  const contactValues = [...contactBlock.matchAll(/^[-]\s+\*\*[^*]+:\*\*\s*(.+)$/gm)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const name = [...contactBlock.matchAll(/^[-]\s+\*\*Name:\*\*\s*(.+)$/gim)][0]?.[1]?.trim();
  const body = source.replace(/^## Contact\s*\n[\s\S]*?(?=^##\s|$)/m, "").trim();
  const header = name ? `# ${name}\n` : "# Resume\n";
  const details = contactValues.filter((value) => value !== name);
  return `${header}${details.length > 0 ? `\n${details.join(" · ")}\n` : ""}\n---\n\n${body}\n`;
}

export function buildResumeBuilderChatContext(): string {
  return [
    "",
    "",
    "## Resume Builder",
    "",
    "This is a private Resume Builder workspace. It is not a Career project and its documents do not appear in the main sidebar.",
    `Read ${RESUME_AGENT_PATH} before replying.`,
    `Use ${RESUME_INTERVIEW_PATH} as the interview guide.`,
    "Keep ordinary turns entirely conversational. The owner controls when to create a resume.",
    `The private app documents are ${RESUME_PROFILE_PATH} and ${RESUME_DOCUMENT_PATH}.`,
  ].join("\n");
}
