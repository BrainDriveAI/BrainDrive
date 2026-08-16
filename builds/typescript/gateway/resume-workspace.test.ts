import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  RESUME_AGENT_PATH,
  RESUME_DOCUMENT_PATH,
  RESUME_PROFILE_PATH,
  buildResumeBuilderChatContext,
  ensureResumeWorkspace,
  exportResumePdfFromDocument,
  renderResumeFromProfile,
} from "./resume-workspace.js";

describe("Resume Builder private workspace", () => {
  it("creates private model documents and renders only from the completed profile", async () => {
    const memoryRoot = await mkdtemp(path.join(tmpdir(), "resume-workspace-"));
    try {
      await ensureResumeWorkspace(memoryRoot);
      const agent = await readFile(path.join(memoryRoot, RESUME_AGENT_PATH), "utf8");
      expect(agent).toContain("owner-authorized Career page context");
      expect(agent).toContain("Begin from-scratch interviewing only when they have no existing material");
      expect(agent).toContain("current resume-specific understanding");
      expect(await readFile(path.join(memoryRoot, RESUME_PROFILE_PATH), "utf8")).toContain("# Resume Profile");
      await expect(renderResumeFromProfile(memoryRoot)).rejects.toThrow("Resume Profile is not ready yet");

      await writeFile(path.join(memoryRoot, RESUME_PROFILE_PATH), "# Resume Profile\n\n## Contact\n\n- **Name:** Alex Lee\n- **Email:** alex@example.com\n\n## Experience\n\n- Led a launch that increased revenue 40%.\n", "utf8");
      const resume = await renderResumeFromProfile(memoryRoot);

      expect(resume).toContain("# Alex Lee");
      expect(resume).toContain("alex@example.com");
      expect(resume).not.toContain("## Contact");
      expect(resume).toContain("increased revenue 40%");
      expect(await readFile(path.join(memoryRoot, RESUME_DOCUMENT_PATH), "utf8")).toBe(resume);
      const pdf = await exportResumePdfFromDocument(memoryRoot);
      expect(pdf.filename).toBe("resume.pdf");
      expect(Buffer.from(pdf.bytes_base64, "base64").subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    } finally {
      await rm(memoryRoot, { recursive: true, force: true });
    }
  });

  it("gives the model a private app context without turning it into a project", () => {
    const context = buildResumeBuilderChatContext();
    expect(context).toContain("private Resume Builder workspace");
    expect(context).toContain("do not appear in the main sidebar");
    expect(context).toContain("AGENT.md");
  });
});
