import type { ResumeDefinitionRecordSchema } from "../app-platform/contracts/data.js";
import { ResumeDomainService } from "../resume-domain/service.js";
import { renderApprovedResumeMarkdown } from "../resume-renderer/renderer.js";
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
      .sort((left, right) => Date.parse(right.approved_at!) - Date.parse(left.approved_at!))[0];
    if (!approved) return [];
    return [{
      publisherId: this.publisherId,
      sourceLabel: "Resume Builder",
      logicalId: "general-resume",
      title: "General Resume",
      markdown: renderApprovedResumeMarkdown(approved),
    }];
  }
}
