import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("sandboxed Resume Builder owner resource", () => {
  it("contains the complete bounded journey and required text states", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    for (const text of [
      "Start with what BrainDrive already knows",
      "One topic at a time",
      "Review confirmed facts",
      "General resume",
      "Requirement evidence",
      "Baseline comparison",
      "Tailored resume",
      "ATS parse-back passed",
      "Resume history",
      "Factual warnings",
      "Document warnings",
      "Role evidence gaps",
    ]) expect(html).toContain(text);
    expect(html).toContain("@media(max-width:720px)");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
  });

  it("keeps privileged browser/network authority outside the package resource", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|window\.open)\s*\(/);
    expect(html).not.toMatch(/\b(?:https?:|file:|tauri:|javascript:)/i);
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("provider_profile");
    expect(html).not.toContain("api_key");
  });

  it("binds host fact confirmation to the exact proposed revision", async () => {
    const html = await readFile(new URL("../resources/main.html", import.meta.url), "utf8");
    expect(html).toContain("fact_revision_id:proposed.fact.metadata.revision_id");
  });
});
