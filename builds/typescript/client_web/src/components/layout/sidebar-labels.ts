/**
 * Sidebar display labels — owner-language ("Your X") labels for canonical files
 * and folders. Single source of truth for the sidebar rename pattern (D46).
 *
 * Display only. Canonical filenames are unchanged on disk; tooling (file
 * watchers, readBootstrapPrompt, starter-pack updates) continues to operate
 * on the canonical names.
 */

export type SidebarScope = "root" | "project" | "app";

/**
 * Owner-language label for a project folder at BD+1 root scope.
 * Project page names are pluralised case-by-case (Finance → Finances,
 * Fitness stays Fitness as a mass noun). Unknown names fall back to
 * the name as-is with a "Your " prefix.
 */
export function projectLabel(name: string): string {
  const canonical = name.toLowerCase();
  const map: Record<string, string> = {
    finance: "Your Finances",
    fitness: "Your Fitness",
    career: "Your Career",
    relationships: "Your Relationships"
  };
  if (map[canonical]) {
    return map[canonical];
  }
  return `Your ${capitalize(name)}`;
}

/**
 * Owner-language label for an app folder at project scope, OR for the
 * state artifact at app scope (same capability noun, different level).
 * Example: "budget" → "Your Budget", "net-worth" → "Your Net Worth".
 */
export function appLabel(name: string): string {
  return `Your ${titleCase(name)}`;
}

/**
 * Owner-language label for a canonical file in the sidebar.
 * Falls back to the filename verbatim when no mapping applies (so
 * Advanced-section managed files keep their real names).
 */
export function fileLabel(filename: string, _scope: SidebarScope): string {
  const base = stripExt(basename(filename));

  if (base === "AGENT") return "Your Agent";
  if (base === "spec") return "Your Goals";
  if (base === "plan") return "Your Plan";

  if (base === "AGENT-user") return "Your Agent customization";
  if (base === "profile") return "Your Profile";
  if (base === "todo") return "Your To-Do";

  if (base.endsWith("-rules")) return "Your Rules";

  return basename(filename);
}

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
}
