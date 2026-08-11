import type { ResumeDefinitionRecordSchema } from "../app-platform/contracts/data.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { renderApprovedResume, renderApprovedResumeCleanText, renderApprovedResumeMarkdown } from "../resume-renderer/renderer.js";
import { verifyArtifactParity } from "../resume-renderer/parity.js";
import type { PublishedProjectDocumentProvider } from "./projects.js";
import type { z } from "zod";

type ResumeDefinition = z.infer<typeof ResumeDefinitionRecordSchema>;

export class ResumePublishedDocumentProvider implements PublishedProjectDocumentProvider {
  readonly publisherId = "ai.braindrive.resume-builder";

  constructor(private readonly domain: ResumeDomainService) {}

  async list(projectId: string) {
    if (projectId !== "career") return [];
    const definitions = await this.domain.store.list("resume_definition");
    const approved = definitions
      .filter((record): record is ResumeDefinition => record.record_type === "resume_definition" && record.definition_kind === "general" && record.status === "approved")
      .sort((left, right) => Date.parse(right.approved_at!) - Date.parse(left.approved_at!));
    let verified: { definition: ResumeDefinition; markdown: string } | null = null;
    let lastFailure: unknown = null;
    for (const definition of approved) {
      try {
        const pdf = renderApprovedResume(definition);
        const clean = renderApprovedResumeCleanText(definition);
        const markdown = renderApprovedResumeMarkdown(definition);
        const parity = verifyArtifactParity({ definition, preview_lines: pdf.logical_lines, clean_text: clean.text, pdf_bytes: pdf.bytes, career_markdown: markdown, checked_at: new Date().toISOString() });
        if (parity.unsafe_representations.includes("career_projection")) throw new Error("Career resume projection failed artifact parity");
        verified = { definition, markdown };
        break;
      } catch (error) { lastFailure = error; }
    }
    if (!verified && lastFailure) throw lastFailure;
    if (!verified) return [];
    return [{
      publisherId: this.publisherId,
      sourceLabel: "Resume Builder",
      logicalId: "general-resume",
      title: "General Resume",
      markdown: verified.markdown,
    }];
  }
}
