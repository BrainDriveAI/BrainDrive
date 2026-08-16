import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { commitMemoryChange, ensureGitReady } from "../git.js";

export const RESUME_WORKSPACE_ROOT = "apps/resume-builder";
export const RESUME_AGENT_PATH = `${RESUME_WORKSPACE_ROOT}/AGENT.md`;
export const RESUME_PROFILE_PATH = `${RESUME_WORKSPACE_ROOT}/resume-profile.md`;
export const RESUME_DOCUMENT_PATH = `${RESUME_WORKSPACE_ROOT}/resume.md`;

const INITIAL_FILES: Record<string, string> = {
  [RESUME_AGENT_PATH]: `# Resume Builder\n\nYou are the resume-writing partner. Own all judgment: understand the owner's story, decide what is worth asking, resolve ordinary ambiguity from context when you can, and write clear resume language.\n\nDuring the interview, have a natural conversation. Do not create, update, or mention Resume Profile while the owner is simply talking. Do not ask scripted checklist questions.\n\nWhen the owner explicitly asks to create their resume, read the full conversation and write ${RESUME_PROFILE_PATH}. It is the structured source for the resume, not the resume itself. Use these Markdown sections: Contact, Professional Summary, Experience, Education, Certifications, and Skills when supported by the conversation. Keep contact as labeled facts; use concise, resume-ready summary and accomplishment bullets. Use only information supported by the owner conversation. If an essential detail is genuinely missing, ask one natural follow-up instead.\n\nAfter writing the profile, tell the owner it is ready to review and that they can use Create resume when they are happy with it. The app, not you, turns the profile into ${RESUME_DOCUMENT_PATH} with a deterministic resume template.\n`,
  [RESUME_PROFILE_PATH]: `# Resume Profile\n\nYour interview will become a resume profile here when you ask to create your resume.\n`,
  [RESUME_DOCUMENT_PATH]: `# Resume\n\nYour finished resume will appear here after you create it from your Resume Profile.\n`,
};

export async function ensureResumeWorkspace(memoryRoot: string): Promise<void> {
  let created = false;
  for (const [relativePath, content] of Object.entries(INITIAL_FILES)) {
    const target = path.join(memoryRoot, relativePath);
    try {
      await readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      created = true;
    }
  }
  if (created) {
    await ensureGitReady(memoryRoot);
    await commitMemoryChange(memoryRoot, "Initialize Resume Builder workspace");
  }
}

export async function readResumeWorkspaceDocument(
  memoryRoot: string,
  document: "profile" | "resume"
): Promise<string> {
  await ensureResumeWorkspace(memoryRoot);
  const relativePath = document === "profile" ? RESUME_PROFILE_PATH : RESUME_DOCUMENT_PATH;
  return readFile(path.join(memoryRoot, relativePath), "utf8");
}

export async function renderResumeFromProfile(memoryRoot: string): Promise<string> {
  await ensureResumeWorkspace(memoryRoot);
  const profilePath = path.join(memoryRoot, RESUME_PROFILE_PATH);
  const profile = await readFile(profilePath, "utf8");
  const normalizedProfile = profile.trim();
  if (normalizedProfile === INITIAL_FILES[RESUME_PROFILE_PATH].trim()) {
    throw new Error("Resume Profile is not ready yet");
  }
  const resume = formatResumeFromProfile(normalizedProfile);
  await writeFile(path.join(memoryRoot, RESUME_DOCUMENT_PATH), resume, "utf8");
  await commitMemoryChange(memoryRoot, "Render Resume Builder resume from profile");
  return resume;
}

function formatResumeFromProfile(profile: string): string {
  const source = profile.replace(/^# Resume Profile\s*/i, "").trim();
  const contactMatch = source.match(/^## Contact\s*\n([\s\S]*?)(?=^##\s|$)/m);
  const contactBlock = contactMatch?.[1]?.trim() ?? "";
  const contactValues = [...contactBlock.matchAll(/^-\s+\*\*[^*]+:\*\*\s*(.+)$/gm)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value));
  const name = [...contactBlock.matchAll(/^-\s+\*\*Name:\*\*\s*(.+)$/gim)][0]?.[1]?.trim();
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
    "Keep ordinary turns entirely conversational. The owner controls when to create a resume.",
    `The private app documents are ${RESUME_PROFILE_PATH} and ${RESUME_DOCUMENT_PATH}.`,
  ].join("\n");
}
