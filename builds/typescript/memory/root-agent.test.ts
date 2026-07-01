import { describe, expect, it } from "vitest";

import {
  ROOT_AGENT_CANONICAL_ID,
  ROOT_AGENT_DISPLAY_NAME,
  ROOT_AGENT_ICON,
  ROOT_AGENT_LEGACY_IDS,
  ROOT_AGENT_TEMPLATE_ID,
  canonicalizeRootAgentProjectId,
  isLegacyRootAgentProjectId,
  isRootAgentProjectId,
  rootAgentProjectSeed,
  rootAgentTemplateIdForProjectId,
} from "./root-agent.js";

describe("root agent identity", () => {
  it("defines the canonical Your Agent identity", () => {
    expect(ROOT_AGENT_CANONICAL_ID).toBe("your-agent");
    expect(ROOT_AGENT_DISPLAY_NAME).toBe("Your Agent");
    expect(ROOT_AGENT_ICON).toBe("sparkles");
    expect(ROOT_AGENT_TEMPLATE_ID).toBe("your-agent");
    expect(ROOT_AGENT_LEGACY_IDS).toEqual(["braindrive-plus-one"]);
    expect(rootAgentProjectSeed()).toEqual({
      id: "your-agent",
      name: "Your Agent",
      icon: "sparkles",
    });
  });

  it("recognizes canonical and legacy root agent ids", () => {
    expect(isRootAgentProjectId("your-agent")).toBe(true);
    expect(isRootAgentProjectId("braindrive-plus-one")).toBe(true);
    expect(isRootAgentProjectId("finance")).toBe(false);
  });

  it("distinguishes legacy root agent ids", () => {
    expect(isLegacyRootAgentProjectId("braindrive-plus-one")).toBe(true);
    expect(isLegacyRootAgentProjectId("your-agent")).toBe(false);
  });

  it("canonicalizes only root agent ids", () => {
    expect(canonicalizeRootAgentProjectId("braindrive-plus-one")).toBe("your-agent");
    expect(canonicalizeRootAgentProjectId("your-agent")).toBe("your-agent");
    expect(canonicalizeRootAgentProjectId("Finance")).toBe("finance");
  });

  it("uses the Your Agent template for canonical and legacy root agent ids", () => {
    expect(rootAgentTemplateIdForProjectId("your-agent")).toBe("your-agent");
    expect(rootAgentTemplateIdForProjectId("braindrive-plus-one")).toBe("your-agent");
    expect(rootAgentTemplateIdForProjectId("finance")).toBe("finance");
  });
});
