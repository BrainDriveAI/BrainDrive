import { describe, expect, it } from "vitest";

import { validateBriefGrounding } from "./grounding.js";

const source = "Atlas launched in May. The pilot included twelve owner interviews.";
const statement = (quote: string) => ({ statement_id: crypto.randomUUID(), text: "Pilot evidence was collected.", support: { kind: "source_quote" as const, quote } });

describe("validateBriefGrounding", () => {
  it("accepts normalized source quotes and explicitly labeled owner context", () => {
    expect(validateBriefGrounding(source, [statement("the PILOT included   twelve owner interviews"), { statement_id: crypto.randomUUID(), text: "Owner considers the result promising.", support: { kind: "owner_context", context: "Owner assessment added during review" } }]).accepted).toBe(true);
  });

  it.each(["thirteen interviews", "Revenue doubled", "Atlas launched in June"])("rejects unsupported mutation: %s", (quote) => {
    expect(validateBriefGrounding(source, [statement(quote)])).toMatchObject({ accepted: false, findings: [{ code: "source_quote_missing" }] });
  });
});
