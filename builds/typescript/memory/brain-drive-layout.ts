import path from "node:path";

export type BrainDriveMemoryFileOwnership =
  | "managed_base"
  | "owner_overlay"
  | "owner_state"
  | "generated_output"
  | "durable_archive"
  | "source"
  | "system_internal";

export type BrainDriveMemoryFileRole =
  | "orient"
  | "procedure"
  | "rule_framework"
  | "rule_overlay"
  | "state_artifact"
  | "reference_contract"
  | "source"
  | "report"
  | "index"
  | "system";

export type BrainDriveMemoryPathClassification = {
  path: string;
  ownership: BrainDriveMemoryFileOwnership;
  role: BrainDriveMemoryFileRole;
  managedBasePath?: string;
  overlayPath?: string;
  generated: boolean;
  canStarterPackReplace: boolean;
  canOwnerCustomize: boolean;
};

const PROCEDURE_NAMES = new Set([
  "create.md",
  "compare.md",
  "run-interview.md",
  "run-planning.md",
  "generate-report.md",
]);

const SYSTEM_ROOTS = new Set(["system", "preferences", "skills"]);
const SOURCE_ROOT_NAMES = new Set(["statements", "health-docs", "sources"]);

export function normalizeBrainDriveMemoryPath(relativePath: string): string {
  return relativePath.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+/g, "/");
}

export function overlayPathForManagedBase(relativePath: string): string | null {
  const normalized = normalizeBrainDriveMemoryPath(relativePath);
  if (!normalized.toLowerCase().endsWith(".md") || isUserOverlayPath(normalized)) {
    return null;
  }

  const fileName = path.posix.basename(normalized);
  const directory = path.posix.dirname(normalized);
  const overlayName = fileName === "AGENT.md" || fileName === "README.md"
    ? fileName.replace(/\.md$/i, "-user.md")
    : fileName.replace(/\.md$/i, "-user.md");

  return directory === "." ? overlayName : `${directory}/${overlayName}`;
}

export function managedBasePathForOverlay(relativePath: string): string | null {
  const normalized = normalizeBrainDriveMemoryPath(relativePath);
  if (!isUserOverlayPath(normalized)) {
    return null;
  }

  return normalized.replace(/-user\.md$/i, ".md");
}

export function isUserOverlayPath(relativePath: string): boolean {
  return /(?:^|\/)[^/]+-user\.md$/i.test(normalizeBrainDriveMemoryPath(relativePath));
}

export function isManagedBasePath(relativePath: string): boolean {
  const classification = classifyBrainDriveMemoryPath(relativePath);
  return classification.ownership === "managed_base";
}

export function isOwnerStatePath(relativePath: string): boolean {
  const classification = classifyBrainDriveMemoryPath(relativePath);
  return classification.ownership === "owner_state";
}

export function isGeneratedReportPath(relativePath: string): boolean {
  const classification = classifyBrainDriveMemoryPath(relativePath);
  return classification.ownership === "generated_output" && classification.role === "report";
}

export function classifyBrainDriveMemoryPath(relativePath: string): BrainDriveMemoryPathClassification {
  const normalized = normalizeBrainDriveMemoryPath(relativePath);
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.at(-1) ?? "";
  const parent = parts.at(-2) ?? "";
  const extension = path.posix.extname(fileName).toLowerCase();

  if (parts.length === 0) {
    return classification(normalized, "system_internal", "system");
  }

  if (SYSTEM_ROOTS.has(parts[0] ?? "")) {
    return classification(normalized, "system_internal", "system");
  }

  if (isUserOverlayPath(normalized)) {
    const managedBasePath = managedBasePathForOverlay(normalized) ?? undefined;
    return classification(normalized, "owner_overlay", roleForOverlay(normalized), {
      managedBasePath,
      canOwnerCustomize: true,
    });
  }

  if (parts.includes("reports") && extension === ".md") {
    const durable = isDurableArchiveReportPath(normalized);
    return classification(normalized, durable ? "durable_archive" : "generated_output", "report", {
      generated: true,
      canStarterPackReplace: false,
      canOwnerCustomize: false,
    });
  }

  if (parts.some((part) => SOURCE_ROOT_NAMES.has(part))) {
    if (fileName === "README.md") {
      return classification(normalized, "managed_base", "reference_contract", {
        overlayPath: overlayPathForManagedBase(normalized) ?? undefined,
        canStarterPackReplace: true,
        canOwnerCustomize: true,
      });
    }
    return classification(normalized, "source", "source", {
      canStarterPackReplace: false,
      canOwnerCustomize: false,
    });
  }

  if (fileName === "AGENT.md") {
    return classification(normalized, "managed_base", "orient", {
      overlayPath: overlayPathForManagedBase(normalized) ?? undefined,
      canStarterPackReplace: true,
      canOwnerCustomize: true,
    });
  }

  if (fileName === "README.md") {
    return classification(normalized, "managed_base", "reference_contract", {
      overlayPath: overlayPathForManagedBase(normalized) ?? undefined,
      canStarterPackReplace: true,
      canOwnerCustomize: true,
    });
  }

  if (/-rules\.md$/i.test(fileName)) {
    return classification(normalized, "managed_base", "rule_framework", {
      overlayPath: overlayPathForManagedBase(normalized) ?? undefined,
      canStarterPackReplace: true,
      canOwnerCustomize: true,
    });
  }

  if (fileName === "spec.md" || fileName === "plan.md" || (extension === ".md" && parent && fileName === `${parent}.md`)) {
    return classification(normalized, "owner_state", "state_artifact", {
      canStarterPackReplace: false,
      canOwnerCustomize: false,
    });
  }

  if (PROCEDURE_NAMES.has(fileName) || isLikelyProcedurePath(normalized)) {
    return classification(normalized, "managed_base", "procedure", {
      overlayPath: overlayPathForManagedBase(normalized) ?? undefined,
      canStarterPackReplace: true,
      canOwnerCustomize: true,
    });
  }

  if (fileName === "index.md") {
    return classification(normalized, "managed_base", "index", {
      canStarterPackReplace: true,
      canOwnerCustomize: false,
    });
  }

  return classification(normalized, "owner_state", "state_artifact", {
    canStarterPackReplace: false,
    canOwnerCustomize: false,
  });
}

export function validateStateArtifactPreservation(before: string, after: string): {
  ok: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  const requiredBefore = collectRequiredArtifactLines(before);
  const requiredAfter = new Set(collectRequiredArtifactLines(after));

  for (const line of requiredBefore) {
    if (!requiredAfter.has(line)) {
      violations.push(`Missing preserved line: ${line}`);
    }
  }

  if (!/^## Changelog\s*$/m.test(after)) {
    violations.push("Missing required ## Changelog section");
  }

  if (!/^\*\*Status:\*\*/m.test(after)) {
    violations.push("Missing required Status line");
  }

  if (!/^\*\*Last updated:\*\*/m.test(after)) {
    violations.push("Missing required Last updated line");
  }

  return {
    ok: violations.length === 0,
    violations,
  };
}

export function canWriteGeneratedReportArchive(relativePath: string, today = new Date()): {
  allowed: boolean;
  reason?: string;
} {
  const normalized = normalizeBrainDriveMemoryPath(relativePath);
  const match = /(?:^|\/)reports\/monthly-(\d{4})-(\d{2})\.md$/i.exec(normalized);
  if (!match) {
    return { allowed: true };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { allowed: false, reason: "Invalid monthly report archive period" };
  }

  const firstDayAfterPeriod = new Date(Date.UTC(year, month, 1));
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (todayUtc < firstDayAfterPeriod) {
    return {
      allowed: false,
      reason: "Monthly report archives can only be written after the month is closed",
    };
  }

  return { allowed: true };
}

function classification(
  relativePath: string,
  ownership: BrainDriveMemoryFileOwnership,
  role: BrainDriveMemoryFileRole,
  overrides: Partial<BrainDriveMemoryPathClassification> = {}
): BrainDriveMemoryPathClassification {
  return {
    path: relativePath,
    ownership,
    role,
    generated: false,
    canStarterPackReplace: ownership === "managed_base",
    canOwnerCustomize: ownership === "managed_base",
    ...overrides,
  };
}

function roleForOverlay(relativePath: string): BrainDriveMemoryFileRole {
  const basePath = managedBasePathForOverlay(relativePath) ?? relativePath;
  const baseName = path.posix.basename(basePath);
  if (baseName === "AGENT.md") {
    return "orient";
  }
  if (baseName === "README.md") {
    return "reference_contract";
  }
  if (/-rules\.md$/i.test(baseName)) {
    return "rule_overlay";
  }
  if (PROCEDURE_NAMES.has(baseName) || isLikelyProcedurePath(basePath)) {
    return "procedure";
  }
  return "orient";
}

function isLikelyProcedurePath(relativePath: string): boolean {
  const fileName = path.posix.basename(relativePath);
  if (!fileName.toLowerCase().endsWith(".md")) {
    return false;
  }
  if (/^(create|compare|run|generate|update|review|plan|interview)-?[a-z0-9-]*\.md$/i.test(fileName)) {
    return true;
  }
  return false;
}

function isDurableArchiveReportPath(relativePath: string): boolean {
  const fileName = path.posix.basename(relativePath);
  return /^(monthly-\d{4}-\d{2}|quarterly-\d{4}-q[1-4]|annual-\d{4}|[a-z]+-\d{4}-\d{2})\.md$/i.test(fileName);
}

function collectRequiredArtifactLines(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => (
      /^##\s+\S/.test(line) ||
      /^\*[^*].*[^*]\*$/.test(line) ||
      /^\*\*Status:\*\*/.test(line) ||
      /^\*\*Last updated:\*\*/.test(line)
    ));
}
