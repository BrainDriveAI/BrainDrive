import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planResumeAction as shipped } from "../resources/inference-program.js";
import { analyzeResumeProfileReadiness as baseReadiness } from "./fixtures/base-readiness.js";
import { planResumeAction as source } from "../src/chat-workspace.js";
import { parsePaperInlineMarkdown } from "../../typescript/client_web/src/lib/paper-inline-markdown.js";

// The oracle is authored along with the generated grammar, never obtained by stripping
// markers with the production parser. Labels, heading case, bullets and structural pipes
// follow the existing template contract; all payload punctuation is exact and ordered.
type Fragment = { markdown: string; text: string; literal?: string };
const atoms: Fragment[] = [
  { markdown: "x", text: "x" },
  { markdown: "snake_case", text: "snake_case", literal: "snake_case" },
  { markdown: "C*", text: "C*", literal: "C*" },
  { markdown: "a_b@c.d", text: "a_b@c.d", literal: "a_b@c.d" },
  { markdown: "first_last@example.test", text: "first_last@example.test", literal: "first_last@example.test" },
  { markdown: "https://example.test/first_last", text: "https://example.test/first_last", literal: "https://example.test/first_last" },
  { markdown: "https://example.test/_private_/first_last?q=a_b", text: "https://example.test/_private_/first_last?q=a_b", literal: "https://example.test/_private_/first_last?q=a_b" },
  { markdown: "`Foo|Bar`", text: "Foo|Bar", literal: "Foo|Bar" },
  { markdown: "`**code** _x_ C*`", text: "**code** _x_ C*", literal: "**code** _x_ C*" },
  { markdown: "``a`b|c_d``", text: "a`b|c_d", literal: "a`b|c_d" },
  { markdown: "`2020 - x. - y ## z`", text: "2020 - x. - y ## z", literal: "2020 - x. - y ## z" },
  { markdown: "**2020 - item**", text: "2020 - item" },
  { markdown: "alpha, beta — gamma", text: "alpha, beta — gamma" },
  { markdown: "[gap: role, dates]", text: "[gap: role, dates]" },
];
// Heading-only forms drawn from accepted P3–P5 career facts, with varied separators.
const headingOnlyEntries = [
  "Director of Data Platforms at Horizon Health Systems (2020–present)",
  "Senior Data Engineering Manager, Horizon Health Systems, 2016–2020",
  "Marketing Manager, BrightPath Learning (March 2022–January 2026)",
  "Content Specialist, Learnwell Media (2018–2022)",
  "Freelance website maintenance (2020–2023)",
  "Freelance website maintenance: [gap: dates]",
  "Freelance website maintenance | [gap: dates]",
  "Freelance website maintenance — [gap: dates]",
  "Freelance website maintenance ([gap: dates])",
  "Administrative Assistant at Lakeview Property Group (September 2023–present)",
];
const wrappers = ["", "*", "**", "_", "__", "***", "___", "**_", "*__"];
function wrap(atom: Fragment, marker: string): Fragment {
  if (atom.markdown === "C*") return atom; // Wrapping a trailing literal star is intentionally ambiguous.
  return { ...atom, markdown: marker + atom.markdown + [...marker].reverse().join("") };
}
function seeded(seed: number) {
  return (size: number) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) % size;
  };
}
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
function paper(markdown: string): string {
  return markdown.split(/\r?\n/).flatMap((line) => {
    line = line.trim();
    if (!line || /^(?:[-*+]|\d+[.)])\s*$/.test(line)) return [];
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    const bullet = /^(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line);
    const text = parsePaperInlineMarkdown(heading?.[2] ?? bullet?.[1] ?? line).map((run) => run.text).join("");
    return [heading?.[1] === "##" ? text.toUpperCase() : bullet ? `• ${text}` : text];
  }).join("\n");
}
function plan(planner: typeof source, action: string, content: string, partial = true) {
  return planner({
    action_planning_contract_version: 1, action_id: action, owner_confirmed: true,
    action_input: partial ? { missing_essential_disposition: "proceed_with_limitations" } : {},
    operation_id: "00000000-0000-4000-8000-000000000001", idempotency_key: "render-invariant",
    occurred_at: "2026-10-01T12:00:00.000Z",
    session: { session_id: "00000000-0000-4000-8000-000000000002", view_id: "00000000-0000-4000-8000-000000000003",
      installation_id: "00000000-0000-4000-8000-000000000004", app_id: "ai.braindrive.resume-builder" },
    documents: [{ document_id: action === "resume.create" ? "resume.profile" : "resume.document", content }],
  });
}
function resume(planner: typeof source, profile: string): string {
  return (plan(planner, "resume.create", profile).steps.find((step) => step.step_id === "write-resume-document") as any)?.content;
}
function pdf(planner: typeof source, markdown: string): Buffer {
  const step = plan(planner, "resume.export.pdf.request", markdown).steps.find((step) => step.step_id === "prepare-pdf-export") as any;
  if (!step) throw new Error("PDF export failed");
  return Buffer.from(step.bytes_base64, "base64");
}
type Case = { profile: string; expected: string; literals: string[]; gapOnlyIdentity: boolean };
function generate(seed: number, count: number): Case[] {
  const pick = seeded(seed);
  const fragment = () => wrap(atoms[pick(atoms.length)], wrappers[pick(wrappers.length)]);
  return Array.from({ length: count }, (_, index) => {
    const name = fragment(), email = fragment(), role = fragment(), company = fragment();
    const body = Array.from({ length: 1 + pick(4) }, fragment);
    const tail = ["", " (preferred name)", " (y)"][pick(3)];
    const selectedField = pick(3);
    const field = name.markdown === "C*" && selectedField === 2 ? 1 : selectedField;
    const nameLine = field === 0 ? `Name: ${name.markdown}${tail}`
      : field === 1 ? `**Name:** ${name.markdown}${tail}` : `**Name: ${name.markdown}**${tail}`;
    const entry = `${role.markdown} | ${company.markdown} | 2020`;
    const emphasizeEntry = pick(2);
    const entryMarkup = emphasizeEntry && role.markdown !== "C*" && company.markdown !== "C*" ? `**${entry}**` : entry;
    const entryHeading = pick(2) ? "### " : "";
    const prefix = ["- ", "* ", "", "### "][pick(4)];
    const punctuationChoices = [".", ",", ";", "!", "?", " (end)", ".”", "…", ")", "]", "’", "—"];
    const punctuation = punctuationChoices[pick(punctuationChoices.length)];
    const bodyText = body.map((item) => item.text).join(" / ") + punctuation;
    const strays = ["C*", "stray *", "stray **", "stray _", "stray __", "***unclosed", "**x***", "***x**", "_x__", "__x_", "left* right**", "*left **middle"];
    const stray = strays[pick(strays.length)];
    const headingOnly = pick(3) === 0 ? headingOnlyEntries[pick(headingOnlyEntries.length)] : null;
    const repeated = pick(2) === 0;
    const education = `## Education${index % 2 ? " " : "\n"}### A.A. General Studies (2021)\n- school_${index}`;
    const extras = `## Projects\n- project_${index}\n## Profile Review Notes\n- note_${index}`;
    return {
      profile: `# Resume Profile\n## ${pick(2) ? "**Contact**" : "Contact"}\n${nameLine}\n${pick(2) ? "**Email:**" : "Email:"} ${email.markdown}\n## ${pick(2) ? "**Experience**" : "Experience"}\n${headingOnly ? `### ${headingOnly}` : `${entryHeading}${entryMarkup}`}\n${headingOnly ? "" : `${prefix}${body.map((item) => item.markdown).join(" / ")}${punctuation}\n${stray}`}\n${education}\n## Skills${index % 4 < 2 ? " " : "\n"}- sample_${index}${repeated ? `\n## Skills\n- second_${index}\n## Education\n- course_${index}` : ""}\n${extras}`,
      expected: `${name.text}${tail}\n${email.text}\nEXPERIENCE\n${headingOnly?.replace(" | ", "\n") ?? `${role.text}\n${company.text} · 2020`}\n${headingOnly ? "" : `${/^[*-]/.test(prefix) ? "• " : ""}${bodyText}\n${stray}`}\nEDUCATION\nA.A. General Studies (2021)\nschool_${index}${repeated ? `\ncourse_${index}` : ""}\nSKILLS\n• sample_${index}${repeated ? `\n• second_${index}` : ""}\nPROJECTS\n• project_${index}\nPROFILE REVIEW NOTES\n• note_${index}`,
      gapOnlyIdentity: [name.text + tail, email.text].every((value) => !/[a-z0-9]/i.test(value.replace(/\[gap:[^\]]*\]/gi, ""))),
      literals: [name, email, ...(headingOnly ? [] : [role, company, ...body])].flatMap((item) => item.literal ? [item.literal] : []),
    };
  });
}
// Delta debugging first deletes lines, then character chunks down to single
// characters. Keep the failure predicate fixed; emit the reduced input with its
// seed/index so it can become a named regression.
function shrink(profile: string, fails: (input: string) => boolean): string {
  const stillFails = (candidate: string) => {
    try { return fails(candidate); } catch { return false; }
  };
  let lines = profile.split("\n");
  for (let index = 0; index < lines.length;) {
    const candidate = lines.filter((_, position) => position !== index);
    if (stillFails(candidate.join("\n"))) lines = candidate;
    else index += 1;
  }
  let reduced = lines.join("\n");
  for (let width = Math.max(1, Math.floor(reduced.length / 2)); width >= 1; width = Math.floor(width / 2)) {
    for (let index = 0; index < reduced.length;) {
      const candidate = reduced.slice(0, index) + reduced.slice(index + width);
      if (candidate && stillFails(candidate)) reduced = candidate;
      else index += width;
    }
  }
  return reduced;
}

const namedRegressions = [
    ["partially flattened Experience after name", "## Experience - Maintained client websites", "Test Person EXPERIENCE • Maintained client websites"],
    ["mixed flattened headings and normal body boundaries", "## Experience - Maintained client websites\nWorked in 2020 - present. - Kept this authored line.\n## Education ### General Studies\n- Coursework\n## Skills - Excel", "Test Person EXPERIENCE • Maintained client websites Worked in 2020 - present. - Kept this authored line. EDUCATION General Studies Coursework SKILLS • Excel"],
    ["partially flattened protected inline payload", "## Experience - `2020 - x. - y ## z`\n**2020 - item**\n## Skills - Excel", "Test Person EXPERIENCE • 2020 - x. - y ## z 2020 - item SKILLS • Excel"],
    ["emphasized field with trailing content", "## Contact\n**Name: Jane Doe** (preferred name)\n**Email: a_b@c.d** (y)\n## Experience\n### Role | Company | 2020", "Jane Doe (preferred name) a_b@c.d (y) EXPERIENCE Role Company · 2020"],
    ["emphasis crossing structural pipes", "## Experience\n### **Role | Company | 2020**", "Test Person EXPERIENCE Role Company · 2020"],
    ["code pipe is payload", "## Experience\n### Role | `Foo|Bar` | 2020", "Test Person EXPERIENCE Role Foo|Bar · 2020"],
    ["nested URL emphasis before punctuation (seed case 6)", "## Experience\n**_https://example.test/first_last_**?", "Test Person EXPERIENCE https://example.test/first_last?"],
    ["multi-backtick code across entry pipes (seed case 1)", "## Experience\n### **``a`b|c_d`` | __a_b@c.d__ | 2020**", "Test Person EXPERIENCE a`b|c_d a_b@c.d · 2020"],
    ["URL emphasis before Unicode punctuation", "## Experience\nSee **https://example.test/first_last**.”", "Test Person EXPERIENCE See https://example.test/first_last.”"],
    ["URL emphasis before punctuation", "## Experience\nSee **https://example.test/first_last**.", "Test Person EXPERIENCE See https://example.test/first_last."],
    ["partially balanced delimiter runs are literal (seed case 15)", "## Experience\n### *****C**** | *first_last@example.test* | 2020**", "Test Person EXPERIENCE *****C**** | first_last@example.test | 2020**"],
    ["ambiguous contact label must not lose its value (seed case 18)", "## Contact\n**Name: C***\n## Experience\nRole | Company | 2020", "Test Person **Name: C*** EXPERIENCE Role Company · 2020"],
    ["unknown and duplicate contact values survive", "## Contact\nEmail: first_last@example.test\nEmail: a_b@c.d\nWebsite: https://example.test/first_last\n## Experience\nRole | Company | 2020", "Test Person first_last@example.test Email: a_b@c.d Website: https://example.test/first_last EXPERIENCE Role Company · 2020"],
    ["nested URL run closes before outer emphasis (seed case 31)", "## Experience\n### **___snake_case___ | ***https://example.test/_private_/first_last?q=a_b*** | 2020**", "Test Person EXPERIENCE snake_case https://example.test/_private_/first_last?q=a_b · 2020"],
    ["bare URL following already closed emphasis", "## Experience\n_x_ https://example.test/_private_", "Test Person EXPERIENCE x https://example.test/_private_"],
    ["long header cannot clip PDF text (seed case 35)", "## Contact\nName: https://example.test/_private_/first_last?q=a_b (preferred name)\nEmail: a_b@c.d\n## Experience\nRole | Company | 2020", "https://example.test/_private_/first_last?q=a_b (preferred name) a_b@c.d EXPERIENCE Role Company · 2020"],
    ["code that resembles flattened headings and bullets", "## Experience\n- `2020 - x. - y ## z`", "Test Person EXPERIENCE • 2020 - x. - y ## z"],
    ["emphasis that resembles flattened bullets", "## Experience\n**2020 - item**", "Test Person EXPERIENCE 2020 - item"],
    ["repeated standard sections retain all content", "## Skills\n- Excel\n## Skills\n- SQL\n## Education\n- Degree\n## Education\n- Course", "Test Person EDUCATION Degree Course SKILLS • Excel • SQL"],
    ["heading-only freelance entry", "## Experience\n### Freelance website maintenance (2020–2023)", "Test Person EXPERIENCE Freelance website maintenance (2020–2023)"],
    ["heading-only comma entry can be exported", "## Experience\n### Senior Data Engineering Manager, Horizon Health Systems, 2016–2020", "Test Person EXPERIENCE Senior Data Engineering Manager, Horizon Health Systems, 2016–2020"],
    ["unbalanced pipe emphasis stays on its original line", "## Experience\n### **Role | Company | 2020", "Test Person EXPERIENCE **Role | Company | 2020"],
    ["plain pipe title with a literal star", "## Experience\nC* | Company | 2020", "Test Person EXPERIENCE C* Company · 2020"],
    ["unbalanced stars are literal", "## Experience\nC* stray ** and snake_case", "Test Person EXPERIENCE C* stray ** and snake_case"],
  ];

describe("no-content-loss Resume / PDF invariant", () => {
  it("differentially preserves every base essential over the full corpus and named regressions", () => {
    const samples = [
      ...generate(0x5eed0911, 2048).map((sample, index) => [`generated ${index}`, sample.profile]),
      ...namedRegressions.map(([name, sections]) => [name, `# Test Person\n${sections}`]),
    ];
    // Explicitly permitted tightening: empty, punctuation-only, placeholder, and
    // gap-only entries (including known labels with no substantive field value).
    const exceptions = new Map<string, string[]>();
    // Independently authored fragment text identifies the generated gap-only
    // Contact exceptions; no production parser determines exception eligibility.
    const generated = generate(0x5eed0911, 2048);
    const gapOnlyContactCases = [1651];
    expect(generated.flatMap((sample, index) => sample.gapOnlyIdentity ? [index] : [])).toEqual(gapOnlyContactCases);
    for (const index of gapOnlyContactCases) exceptions.set(generated[index].profile, ["contact_identity"]);
    for (const prefix of ["", "- ", "* ", "### "]) {
      for (const separator of ["", ": ", " | ", " - ", " — ", " ("]) {
        for (const value of ["", "2020", "[gap: dates]"]) {
          const suffix = separator === " (" ? ")" : "";
          const entry = `Freelance website maintenance${separator}${value}${suffix}`;
          samples.push([`shape ${prefix}${entry}`, `# Test Person\n## Experience\n${prefix}${entry}`]);
        }
      }
      for (const entry of ["", "Unfilled entry", "[gap: role]", "**[gap: role]**", "[gap: role] | [gap: dates]", "([gap: dates])", ": [gap: dates]", "Dates: [gap: dates]", "**Company:**", "Role: [gap: role]", "Location | [gap: location]"]) {
        const profile = `# Test Person\n## Experience\n${prefix}${entry}`;
        samples.push([`intentional empty/gap-only ${prefix}${entry}`, profile]);
        exceptions.set(profile, ["experience"]);
      }
    }
    for (const [name, profile] of samples) {
      const previous = baseReadiness(profile).missingEssentials.map((item: any) => item.field_id);
      for (const planner of [shipped, source]) {
        const step = plan(planner, "resume.create", profile, false).steps[0] as any;
        const current = (step.content?.missing_essentials ?? []).map((item: any) => item.field_id);
        const newlyMissing = current.filter((id: string) => !previous.includes(id));
        expect(newlyMissing.filter((id: string) => !exceptions.get(profile)?.includes(id)), `${name}\n${profile}`).toEqual([]);
        for (const id of exceptions.get(profile) ?? []) expect(current, name).toContain(id);
      }
    }
  });

  it("removes only closed-set field labels in headings and body text", () => {
    for (const planner of [shipped, source]) {
      for (const prefix of ["", "- ", "### "]) {
        for (const label of ["Dates", "Date", "Location", "Employer", "Company", "Title", "Role", "Organization", "Responsibilities"]) {
          const empty = plan(planner, "resume.create", `# Test Person\n## Experience\n${prefix}**${label}:** [gap: details]`, false).steps[0] as any;
          expect(empty.content.missing_essentials).toEqual(expect.arrayContaining([expect.objectContaining({ field_id: "experience" })]));
          const filled = plan(planner, "resume.create", `# Test Person\n## Experience\n${prefix}**${label}:** Maintained client websites [gap: dates]`, false).steps[0] as any;
          expect(filled.content.missing_essentials).toEqual([expect.objectContaining({ field_id: "gap_marker_1" })]);
        }
      }
    }
  });

  it("shrinks a failure to its minimal retained trigger", () => {
    expect(shrink("extra line\n**broken** trailing\nmore text", (input) => input.includes("**broken**"))).toBe("**broken**");
  });

  it("fuzzes 2,048 reproducible Profiles against both planners, paper text and pdftotext", () => {
    const seed = 0x5eed0911;
    const cases = generate(seed, 2048);
    expect(generate(seed, 2048)).toEqual(cases);
    // Require the real extractor: a decoded-PDF fallback would weaken this invariant.
    execFileSync("pdftotext", ["-v"], { stdio: "pipe" });
    const directory = mkdtempSync(join(tmpdir(), "resume-invariant-"));
    try {
      for (const [index, sample] of cases.entries()) {
        const markdown = resume(shipped, sample.profile);
        const actual = paper(markdown);
        if (normalize(actual) !== normalize(sample.expected)) {
          const missing = sample.literals.find((literal) => !actual.includes(literal));
          const hasResidue = (input: string) => {
            let rendered = paper(resume(shipped, input));
            // Literal/code atoms may contain balanced-looking characters by design.
            for (const literal of sample.literals) rendered = rendered.replaceAll(literal, "literal");
            return parsePaperInlineMarkdown(rendered).map((run) => run.text).join("") !== rendered;
          };
          const predicate = missing ? (input: string) => {
            const rendered = resume(shipped, input);
            return !!rendered && input.includes(missing) && !paper(rendered).includes(missing);
          } : hasResidue;
          const reduced = predicate(sample.profile) ? shrink(sample.profile, predicate) : sample.profile;
          throw new Error(`seed=${seed} case=${index}\nminimal payload-loss repro:\n${reduced}\nexpected=${sample.expected}\nactual=${actual}`);
        }
        // Exact equality with the independent oracle covers both conservation and
        // absence of authored balanced delimiters, while permitting literal code/strays.
        if (headingOnlyEntries.some((title) => sample.profile.includes(`### ${title}`))) {
          for (const planner of [shipped, source]) {
            const gate = plan(planner, "resume.create", sample.profile, false).steps[0] as any;
            expect(gate.content?.missing_essentials ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ field_id: "experience" })]));
          }
        }
        for (const literal of sample.literals) expect(actual, `case ${index}`).toContain(literal);
        expect(resume(shipped, sample.profile)).toBe(markdown);
        expect(resume(source, sample.profile)).toBe(markdown);
        const bytes = pdf(shipped, markdown);
        const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
        expect(hash(pdf(shipped, markdown))).toBe(hash(bytes));
        const filename = join(directory, "case.pdf");
        for (const planner of [shipped, source]) {
          const exported = planner === shipped ? bytes : pdf(planner, markdown);
          if (planner === source) expect(hash(pdf(source, markdown))).toBe(hash(exported));
          writeFileSync(filename, exported);
          const extracted = execFileSync("pdftotext", ["-layout", filename, "-"], { encoding: "utf8" });
          if (normalize(extracted) !== normalize(actual)) {
            const reduced = shrink(sample.profile, (input) => {
              const candidate = resume(planner, input);
              writeFileSync(filename, pdf(planner, candidate));
              const text = execFileSync("pdftotext", ["-layout", filename, "-"], { encoding: "utf8" });
              return normalize(text) !== normalize(paper(candidate));
            });
            throw new Error(`PDF parity seed=${seed} case=${index}\nminimal repro:\n${reduced}\nexpected=${actual}\nextracted=${extracted}`);
          }
          // PDF layout can replace a source space with a line break.
          for (const literal of sample.literals) expect(normalize(extracted), `PDF case ${index}`).toContain(normalize(literal));
        }
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 600_000);

  it.each(namedRegressions)("regression: %s", (_name, sections, expected) => {
    const profile = `# Test Person\n${sections}`;
    const markdown = resume(shipped, profile);
    expect(resume(source, profile)).toBe(markdown);
    expect(normalize(paper(markdown))).toBe(expected);
    const directory = mkdtempSync(join(tmpdir(), "resume-regression-"));
    try {
      for (const planner of [shipped, source]) {
        const filename = join(directory, "regression.pdf");
        writeFileSync(filename, pdf(planner, markdown));
        expect(normalize(execFileSync("pdftotext", ["-layout", filename, "-"], { encoding: "utf8" }))).toBe(expected);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("wraps long PDF names in bold at the prescribed 22pt", () => {
    const name = "Alexandra ".repeat(16).trim();
    for (const planner of [shipped, source]) {
      const bytes = pdf(planner, resume(planner, `# ${name}\n## Experience\n### Website maintenance`));
      const raw = bytes.toString("latin1");
      const streams = [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((match) => {
        const start = match.index! + "stream\n".length;
        return inflateSync(bytes.subarray(start, start + match[1].length)).toString("utf8");
      });
      const commands = streams.join("\n").match(/\/F3 [\d.]+ Tf/g) ?? [];
      expect(commands.length).toBeGreaterThan(1);
      expect(commands.every((command) => command.startsWith("/F3 22 Tf"))).toBe(true);
    }
  });

  it("repairs flattened blocks without rewriting code or balanced emphasis", () => {
    const profile = "# Test Person ## Experience - `2020 - x. - y ## z`";
    const markdown = resume(shipped, profile);
    expect(resume(source, profile)).toBe(markdown);
    expect(normalize(paper(markdown))).toBe("Test Person EXPERIENCE • 2020 - x. - y ## z");
  });

  it("counts role headings independently of separators while retaining date gaps", () => {
    for (const planner of [shipped, source]) {
      for (const separator of [": ", " | ", " - ", " — ", " ("]) {
        const suffix = separator === " (" ? ")" : "";
        const result = plan(planner, "resume.create", `# Test Person\n## Experience\n### Freelance website maintenance${separator}[gap: dates]${suffix}`, false).steps[0] as any;
        expect(result.content.missing_essentials).toEqual([
          expect.objectContaining({ field_id: "gap_marker_1", label: "Unresolved gap: dates" }),
        ]);
        for (const title of ["", "Unfilled entry", "**Unfilled entry**", "[gap: role]"]) {
          const missing = plan(planner, "resume.create", `# Test Person\n## Experience\n### ${title}${separator}[gap: dates]${suffix}`, false).steps[0] as any;
          expect(missing.content.missing_essentials).toEqual(expect.arrayContaining([expect.objectContaining({ field_id: "experience" })]));
        }
        const body = plan(planner, "resume.create", `# Test Person\n## Experience\n### Unfilled entry${separator}[gap: dates]${suffix}\n- Maintained client websites`, false).steps[0] as any;
        expect(body.content.missing_essentials).toEqual([
          expect.objectContaining({ field_id: "gap_marker_1", label: "Unresolved gap: dates" }),
        ]);
      }
    }
  });

  it("accepts substantive comma-form heading-only experience without accepting empty/gap headings", () => {
    for (const planner of [shipped, source]) {
      for (const title of [...headingOnlyEntries.filter((title) => !title.includes("[gap:")), "Website maintenance", "Director, Employer, 2020", "Analyst, Company, 2021"]) {
        const steps = plan(planner, "resume.create", `# Test Person\n## Experience\n### ${title}`, false).steps;
        expect(steps.some((step) => step.step_id === "write-resume-document")).toBe(true);
      }
      for (const title of ["", "Unfilled entry", "[gap: role], [gap: employer], [gap: dates]", "**[gap: role]**"]) {
        const result = plan(planner, "resume.create", `# Test Person\n## Experience\n### ${title}`, false).steps[0] as any;
        expect(result.content.missing_essentials).toEqual(expect.arrayContaining([expect.objectContaining({ field_id: "experience" })]));
      }
    }
  });
});
