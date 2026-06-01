const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const EXACT_PATH_LABELS: Record<string, string> = {
  "documents/finance/spec.md": "Finance goals",
  "documents/finance/plan.md": "Finance plan",
  "documents/finance/budget/budget.md": "saved Budget",
  "documents/finance/budget/reports/latest.md": "latest Budget report",
  "documents/finance/budget/statements/README.md": "Budget statement checklist",
  "me/todo.md": "Todo list",
};

export function ownerLabelForMemoryPath(path: string, fallbackName?: string): string {
  const normalized = normalizeMemoryPath(path);
  const exact = EXACT_PATH_LABELS[normalized.toLowerCase()];
  if (exact) {
    return exact;
  }

  if (normalized.startsWith("documents/finance/budget/statements/")) {
    return `${statementNameFromPath(normalized, fallbackName)} statement`;
  }

  if (normalized.startsWith("documents/finance/budget/reports/")) {
    return "Budget report";
  }

  if (isInternalInstructionPath(normalized)) {
    return "internal instructions";
  }

  const baseName = fallbackName ?? normalized.split("/").filter(Boolean).pop() ?? "project file";
  return humanizeFileName(baseName);
}

export function destinationLabelForMemoryPath(path: string): string {
  const normalized = normalizeMemoryPath(path);
  if (normalized.startsWith("documents/finance/budget/statements/")) {
    return "Budget statements";
  }
  if (normalized.startsWith("documents/finance/budget/reports/")) {
    return "Budget reports";
  }
  if (normalized.startsWith("documents/finance/")) {
    return "Finance";
  }
  if (normalized.startsWith("me/")) {
    return "Personal workspace";
  }
  return "Project files";
}

export function statementMonthLabelForMemoryPath(path: string): string | null {
  const match = /\b(20\d{2})-(0[1-9]|1[0-2])\b/.exec(path);
  if (!match) {
    return null;
  }

  const monthIndex = Number.parseInt(match[2] ?? "", 10) - 1;
  const month = MONTH_NAMES[monthIndex];
  return month ? `${month} ${match[1]}` : null;
}

export function replaceOwnerVisibleMemoryPaths(text: string): string {
  return text.replace(
    /`?((?:documents|me)\/[A-Za-z0-9._/-]+|AGENT(?:-user)?\.md|[A-Za-z0-9_-]+-rules(?:-user)?\.md|(?:create|compare|run-planning|run-interview)\.md)`?/g,
    (match, rawPath: string) => {
      const label = ownerLabelForMemoryPath(rawPath);
      return match.startsWith("`") && match.endsWith("`") ? label : label;
    }
  );
}

function normalizeMemoryPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^`|`$/g, "")
    .replace(/(\.md)[.,;:)]+$/i, "$1")
    .replace(/[.,;:)]+$/, "");
}

function statementNameFromPath(path: string, fallbackName?: string): string {
  const baseName = fallbackName ?? path.split("/").filter(Boolean).pop() ?? "uploaded";
  const withoutExtension = baseName.replace(/\.[^.]+$/, "");
  const withoutDate = withoutExtension.replace(/^20\d{2}[-_](0[1-9]|1[0-2])[-_]?/, "");
  const name = withoutDate.length > 0 ? withoutDate : withoutExtension;
  return humanizeFileName(name.replace(/\b(statement|transactions|upload|uploaded)\b/gi, ""));
}

function humanizeFileName(value: string): string {
  const cleaned = value
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "uploaded";
  }

  return cleaned.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function isInternalInstructionPath(path: string): boolean {
  const fileName = path.split("/").filter(Boolean).pop() ?? path;
  return (
    /^AGENT(?:-user)?\.md$/.test(fileName) ||
    /^[A-Za-z0-9_-]+-rules(?:-user)?\.md$/.test(fileName) ||
    /^(create|compare|run-planning|run-interview)\.md$/.test(fileName)
  );
}
