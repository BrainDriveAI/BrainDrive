import { describe, expect, it } from "vitest";

import { appLabel, fileLabel, projectLabel } from "./sidebar-labels";

describe("projectLabel", () => {
  it("pluralises Finance", () => {
    expect(projectLabel("Finance")).toBe("Your Finances");
  });

  it("leaves Fitness as a mass noun", () => {
    expect(projectLabel("Fitness")).toBe("Your Fitness");
  });

  it("leaves Career singular", () => {
    expect(projectLabel("Career")).toBe("Your Career");
  });

  it("keeps Relationships plural", () => {
    expect(projectLabel("Relationships")).toBe("Your Relationships");
  });

  it("falls back to capitalised name for unknown areas", () => {
    expect(projectLabel("hobbies")).toBe("Your Hobbies");
  });

  it("is case-insensitive on input", () => {
    expect(projectLabel("FINANCE")).toBe("Your Finances");
  });
});

describe("appLabel", () => {
  it("labels budget as Your Budget", () => {
    expect(appLabel("budget")).toBe("Your Budget");
  });

  it("title-cases hyphenated app names", () => {
    expect(appLabel("net-worth")).toBe("Your Net Worth");
  });

  it("handles already-capitalised names", () => {
    expect(appLabel("Resume")).toBe("Your Resume");
  });
});

describe("fileLabel", () => {
  it("labels AGENT.md as Your Agent only at BD root; canonical at project + app", () => {
    expect(fileLabel("AGENT.md", "root")).toBe("Your Agent");
    expect(fileLabel("AGENT.md", "project")).toBe("AGENT.md");
    expect(fileLabel("AGENT.md", "app")).toBe("AGENT.md");
  });

  it("labels spec.md as Your Goals", () => {
    expect(fileLabel("spec.md", "project")).toBe("Your Goals");
  });

  it("labels plan.md as Your Plan", () => {
    expect(fileLabel("plan.md", "project")).toBe("Your Plan");
  });

  it("labels AGENT-user.md as Your Agent customization", () => {
    expect(fileLabel("AGENT-user.md", "root")).toBe("Your Agent customization");
  });

  it("labels profile.md as Your Profile", () => {
    expect(fileLabel("me/profile.md", "root")).toBe("Your Profile");
  });

  it("labels *-rules.md files as Your Rules", () => {
    expect(fileLabel("budget-rules.md", "app")).toBe("Your Rules");
  });

  it("falls back to the filename for unmapped files", () => {
    expect(fileLabel("run-interview.md", "project")).toBe("run-interview.md");
    expect(fileLabel("create.md", "app")).toBe("create.md");
  });

  it("strips leading paths from fallback labels", () => {
    expect(fileLabel("base/run-interview.md", "root")).toBe("run-interview.md");
  });
});
