import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planResumeAction as shippedPlan } from "../resources/inference-program.js";
import { planResumeAction as sourcePlan } from "../src/chat-workspace.js";

function renderProfile(profile: string, planner = shippedPlan): string {
  const operationId = crypto.randomUUID();
  const request: Parameters<typeof sourcePlan>[0] = {
    action_planning_contract_version: 1,
    action_id: "resume.create",
    action_input: { missing_essential_disposition: "proceed_with_limitations" },
    owner_confirmed: true,
    operation_id: operationId,
    idempotency_key: `template-standard-${operationId}`,
    occurred_at: "2026-10-01T12:00:00.000Z",
    session: {
      session_id: crypto.randomUUID(), view_id: crypto.randomUUID(),
      app_id: "ai.braindrive.resume-builder", installation_id: crypto.randomUUID(),
    },
    documents: [{ document_id: "resume.profile", document_binding_id: "resume.profile.current", media_type: "text/markdown", revision: 1, revision_id: crypto.randomUUID(), content: profile }],
  };
  const plan = planner(request);
  const step = plan.steps.find((entry: any) => entry.step_id === "write-resume-document");
  expect(step).toBeDefined();
  expect(plan.steps.some((entry: any) => entry.document_id === "resume.profile")).toBe(false);
  return step.content as string;
}

const headings = (markdown: string) => [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
const sectionBody = (markdown: string, heading: string) => markdown.split(`## ${heading}\n`)[1]?.split(/\n## /)[0].split("\n").map((line) => line.trim()).filter(Boolean).join("\n");

describe("AC-9.1 shipped Profile template section order", () => {
  it.each(["p1", "p2"])("renders %s standard headings with nested entries in their sections", (persona) => {
    const profile = readFileSync(new URL(`./fixtures/${persona}-experience-profile.txt`, import.meta.url), "utf8");
    const rendered = renderProfile(profile);
    expect(headings(rendered)).toEqual(persona === "p1"
      ? ["Professional Summary", "Experience", "Education", "Skills", "Certifications", "Campus Transit Survey Project", "Additional Information", "Profile Review Notes"]
      : ["Professional Summary", "Experience", "Education", "Skills", "Target Direction"]);
    expect(sectionBody(rendered, "Experience")).toBe(sectionBody(profile, "Experience"));
    expect(sectionBody(rendered, "Education")).toBe(sectionBody(profile, "Education")?.replace(/^[-*+]\s+/gm, ""));
    expect(sectionBody(rendered, "Skills")).toBe(sectionBody(profile, "Skills"));
    if (persona === "p1") {
      expect(rendered).toContain("[gap: certifications not yet provided]");
      expect(sectionBody(rendered, "Profile Review Notes")).toBe(sectionBody(profile, "Profile Review Notes"));
    }
    expect(renderProfile(profile)).toBe(rendered);
    expect(renderProfile(profile, sourcePlan)).toBe(rendered);
  });

  it.each(["p1", "p2"])("renders %s in fixed order even when standard Profile sections are reversed", (persona) => {
    const profile = readFileSync(new URL(`./fixtures/${persona}-experience-profile.txt`, import.meta.url), "utf8");
    const [title, ...sections] = profile.split(/(?=^## )/m);
    const standard = sections.filter((section) => /^## (Contact|Professional Summary|Experience|Education|Skills|Certifications)\n/.test(section));
    const extras = sections.filter((section) => !standard.includes(section));
    const reordered = [title, ...standard.reverse(), ...extras].join("");
    expect(renderProfile(reordered)).toBe(renderProfile(profile));
    expect(renderProfile(reordered, sourcePlan)).toBe(renderProfile(profile));
  });

  it("uses standard headings for aliases and keeps grouped Skills within Skills", () => {
    const profile = "# Test Person\n## Licenses\nLicense entry\n## Skill\n### Tools\n- Excel\n#### Reporting\n- Dashboards\n## Education\n### School\nDegree\n## Work History\n### Coordinator\n- Scheduled work\n## Summary\nSummary prose";
    const rendered = renderProfile(profile);
    expect(headings(rendered)).toEqual(["Professional Summary", "Experience", "Education", "Skills", "Certifications"]);
    expect(sectionBody(rendered, "Skills")).toBe("### Tools\n- Excel\n#### Reporting\n- Dashboards");
    expect(renderProfile(profile, sourcePlan)).toBe(rendered);
  });

  it("omits empty standard sections and preserves the existing extra-section placement rule", () => {
    const profile = "# Test Person\n## Review Notes\nKeep this note\n### Detail\nKeep this detail\n## Education\n\n## Experience\nRole\n## Projects\nKeep this project\n## Skills\nScheduling\n## Certifications\nLicense";
    const rendered = renderProfile(profile);
    expect(headings(rendered)).toEqual(["Experience", "Skills", "Certifications", "Review Notes", "Detail", "Projects"]);
    expect(sectionBody(rendered, "Review Notes")).toBe("Keep this note");
    expect(sectionBody(rendered, "Detail")).toBe("Keep this detail");
    expect(sectionBody(rendered, "Projects")).toBe("Keep this project");
    expect(renderProfile(profile, sourcePlan)).toBe(rendered);
  });
});
