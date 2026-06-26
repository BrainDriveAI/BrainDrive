import { describe, expect, it } from "vitest";

import {
  canWriteGeneratedReportArchive,
  classifyBrainDriveMemoryPath,
  isGeneratedReportPath,
  isManagedBasePath,
  isOwnerStatePath,
  isUserOverlayPath,
  managedBasePathForOverlay,
  overlayPathForManagedBase,
  validateStateArtifactPreservation,
} from "./brain-drive-layout.js";

describe("BrainDrive Draft 3 layout helpers", () => {
  it("resolves managed base and overlay pairs", () => {
    expect(overlayPathForManagedBase("AGENT.md")).toBe("AGENT-user.md");
    expect(overlayPathForManagedBase("documents/finance/AGENT.md")).toBe("documents/finance/AGENT-user.md");
    expect(overlayPathForManagedBase("documents/finance/run-interview.md")).toBe("documents/finance/run-interview-user.md");
    expect(overlayPathForManagedBase("documents/finance/budget/compare.md")).toBeNull();
    expect(overlayPathForManagedBase("documents/finance/budget/budget-rules.md")).toBeNull();
    expect(overlayPathForManagedBase("documents/finance/archive/retired-budget/README.md")).toBeNull();
    expect(overlayPathForManagedBase("documents/finance/budget/compare-user.md")).toBeNull();

    expect(managedBasePathForOverlay("documents\\finance\\run-interview-user.md")).toBe("documents/finance/run-interview.md");
    expect(managedBasePathForOverlay("documents\\finance\\budget\\compare-user.md")).toBeNull();
    expect(managedBasePathForOverlay("documents\\finance\\archive\\retired-budget\\README-user.md")).toBeNull();
    expect(managedBasePathForOverlay("documents/finance/user-AGENT.md")).toBeNull();
  });

  it("classifies Draft 3 ownership and roles", () => {
    expect(classifyBrainDriveMemoryPath("documents/finance/run-interview.md")).toMatchObject({
      ownership: "managed_base",
      role: "procedure",
      overlayPath: "documents/finance/run-interview-user.md",
    });

    expect(classifyBrainDriveMemoryPath("documents/finance/run-interview-user.md")).toMatchObject({
      ownership: "owner_overlay",
      role: "procedure",
      managedBasePath: "documents/finance/run-interview.md",
    });

    expect(classifyBrainDriveMemoryPath("documents/finance/plan.md")).toMatchObject({
      ownership: "owner_state",
      role: "state_artifact",
      canStarterPackReplace: false,
    });

    expect(classifyBrainDriveMemoryPath("documents/finance/sources/2026-05-bank.md")).toMatchObject({
      ownership: "source",
      role: "source",
    });

    expect(classifyBrainDriveMemoryPath("documents/finance/reports/latest.md")).toMatchObject({
      ownership: "generated_output",
      role: "report",
      generated: true,
    });

    expect(classifyBrainDriveMemoryPath("documents/finance/reports/monthly-2026-05.md")).toMatchObject({
      ownership: "durable_archive",
      role: "report",
      generated: true,
    });

    expect(classifyBrainDriveMemoryPath("documents/finance/budget/budget-rules.md")).toMatchObject({
      ownership: "legacy_retired",
      role: "system",
      generated: false,
      canStarterPackReplace: false,
      canOwnerCustomize: false,
    });
    expect(classifyBrainDriveMemoryPath("documents/finance/budget/budget-rules-user.md")).toMatchObject({
      ownership: "legacy_retired",
      role: "system",
    });
    expect(classifyBrainDriveMemoryPath("documents/finance/budget/budget.md")).toMatchObject({
      ownership: "legacy_retired",
      role: "system",
    });
    expect(classifyBrainDriveMemoryPath("documents/finance/budget/statements/2026-05-bank.md")).toMatchObject({
      ownership: "legacy_retired",
      role: "system",
    });
    expect(classifyBrainDriveMemoryPath("documents/finance/budget/reports/latest.md")).toMatchObject({
      ownership: "legacy_retired",
      role: "system",
      generated: false,
    });
    expect(classifyBrainDriveMemoryPath("documents/finance/archive/retired-budget/budget.md")).toMatchObject({
      ownership: "legacy_retired",
      role: "system",
      generated: false,
      canStarterPackReplace: false,
      canOwnerCustomize: false,
    });
  });

  it("rejects non-canonical overlay names", () => {
    expect(isUserOverlayPath("documents/finance/user-AGENT.md")).toBe(false);
    expect(isUserOverlayPath("documents/finance/budget/compare-custom.md")).toBe(false);
    expect(isUserOverlayPath("documents/finance/budget/budget-rules-local.md")).toBe(false);
    expect(isUserOverlayPath("documents/finance/budget/compare-user.md")).toBe(false);
    expect(isUserOverlayPath("documents/finance/archive/retired-budget/README-user.md")).toBe(false);
    expect(isUserOverlayPath("documents/finance/run-interview-user.md")).toBe(true);
  });

  it("provides ownership predicates", () => {
    expect(isManagedBasePath("documents/finance/run-interview.md")).toBe(true);
    expect(isOwnerStatePath("documents/finance/plan.md")).toBe(true);
    expect(isGeneratedReportPath("documents/finance/reports/latest.md")).toBe(true);
    expect(isManagedBasePath("documents/finance/budget/compare.md")).toBe(false);
    expect(isOwnerStatePath("documents/finance/budget/budget.md")).toBe(false);
    expect(isGeneratedReportPath("documents/finance/budget/reports/latest.md")).toBe(false);
    expect(isOwnerStatePath("documents/finance/archive/retired-budget/budget.md")).toBe(false);
  });

  it("validates state artifact preservation", () => {
    const before = [
      "# Budget",
      "",
      "*Saved monthly spending plan.*",
      "",
      "**Status:** Draft",
      "",
      "**Last updated:** 2026-05-26",
      "",
      "## Category Limits",
      "",
      "*The owner's category targets.*",
      "",
      "- Groceries: 400",
      "",
      "## Changelog",
      "",
    ].join("\n");

    const valid = before.replace("- Groceries: 400", "- Groceries: 450");
    expect(validateStateArtifactPreservation(before, valid)).toMatchObject({ ok: true, violations: [] });

    const invalid = valid.replace("## Category Limits", "## Categories");
    expect(validateStateArtifactPreservation(before, invalid).ok).toBe(false);
    expect(validateStateArtifactPreservation(before, invalid).violations).toContain("Missing preserved line: ## Category Limits");
  });

  it("blocks open monthly report archives but allows latest reports", () => {
    const today = new Date(Date.UTC(2026, 4, 26));
    expect(canWriteGeneratedReportArchive("documents/finance/reports/latest.md", today).allowed).toBe(true);
    expect(canWriteGeneratedReportArchive("documents/finance/reports/monthly-2026-05.md", today)).toMatchObject({
      allowed: false,
    });
    expect(canWriteGeneratedReportArchive("documents/finance/reports/monthly-2026-04.md", today).allowed).toBe(true);
  });
});
