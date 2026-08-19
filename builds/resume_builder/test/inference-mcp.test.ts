import { describe, expect, it } from "vitest";

import { RESUME_INFERENCE_PROGRAMS, RESUME_INFERENCE_PURPOSES } from "../src/index.js";

describe("Resume Builder inference program catalog", () => {
  it("owns every Resume inference purpose without an app-visible legacy tool", () => {
    expect(RESUME_INFERENCE_PURPOSES).toHaveLength(12);
    expect(RESUME_INFERENCE_PURPOSES).toEqual(expect.arrayContaining([
      "resume_revision_classify", "resume_revision_draft", "resume_guidance",
      "resume_strategy", "resume_craft_evaluate", "resume_craft_repair",
    ]));
    expect(Object.keys(RESUME_INFERENCE_PROGRAMS).sort()).toEqual([...RESUME_INFERENCE_PURPOSES].sort());
    expect(new Set(Object.values(RESUME_INFERENCE_PROGRAMS).map((program) => program.id)).size).toBe(12);
    expect(Object.values(RESUME_INFERENCE_PROGRAMS)).toEqual(expect.arrayContaining([
      { id: "resume.interview-assist", version: 1 },
      { id: "resume.strategy", version: 2 },
      { id: "resume.craft-repair", version: 1 },
    ]));
    expect(JSON.stringify(RESUME_INFERENCE_PROGRAMS)).not.toMatch(/api_key|provider_profile|inference_contract_version/);
  });
});
