// PROTOTYPE ONLY: Experts and skills spec v0.8, Release 1 (no export, forum posting, link
// install or updates). The gateway has no page-setup, plugin check or install endpoints yet, so
// the "Add page" conversation, the plugin file check, the review card and the Plugins list are
// held here, in memory, in the browser. A reload forgets them. The only real back-end calls are
// the existing project create, rename and delete, which give each page a real sidebar entry.
//
// What this stand-in does:
// - Add page makes a page and opens its chat with fixed BrainDrive text (not model output).
// - Build your own attaches the BrainDrive plugin and a "made by you" Behavior plugin.
// - Install one / Add plugin open the install step. A chosen or dropped file goes to a mock
//   BrainDrive check first (name-based rules, see checkPluginFile), then a review card.
// - Install applies to the current page: it is renamed to the Expert's name (auto-numbered).
// - Finance, Fitness, Career and Relationships are Experts that come with BrainDrive.
//
// One switch controls all of it: this UI is shown in `npm run dev` and hidden in production
// builds. Set VITE_EXPERTS_MOCK=false in client_web/.env.development.local to hide it.
import { useSyncExternalStore } from "react";
import { createProject } from "@/api/gateway-adapter";

export const EXPERTS_MOCK_ENABLED = import.meta.env.DEV && import.meta.env.VITE_EXPERTS_MOCK !== "false";

export type PluginSkill = { name: string; needs?: string };
export type PluginSource = "made by you" | "included with BrainDrive" | "installed from a plugin file";
export type PagePlugin = { id: string; name: string; source: PluginSource; skills: PluginSkill[] };
export type PluginReview = {
  kind: "expert" | "plugin"; name: string; creator: string; license: string; adds: string;
  fileName: string; files: Record<string, string>; warnings: string[];
};
export type HostEvent =
  | { id: string; type: "choose" }
  | { id: string; type: "build" }
  | { id: string; type: "install-help"; mode: "expert" | "plugin" }
  | { id: string; type: "refused"; reason: string }
  | { id: string; type: "review"; review: PluginReview; status: "pending" | "installed" | "cancelled" }
  | { id: string; type: "result"; text: string }
  | { id: string; type: "notice" };
export type PageSetup = {
  events: HostEvent[];
  installStep: "expert" | "plugin" | null;
  // `backend` means the Expert's instructions and templates are real files on the page.
  expert: { name: string; files: Record<string, string>; backend?: boolean } | null;
  plugins: PagePlugin[];
  noticeShown: boolean;
};

export const DEFAULT_EXPERT_IDS = ["finance", "fitness", "career", "relationships"];
export const NO_FILE_NOTICE = "Files can't be added here yet. To install a plugin, choose Add plugin.";
export const AI_NOTICE = "You are working with AI. Its answers can be wrong. It uses your own model setup, so any costs of that model are yours.";

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 350));
const BRAINDRIVE_PLUGIN: PagePlugin = {
  id: "braindrive", name: "BrainDrive", source: "included with BrainDrive",
  skills: [{ name: "Zero-to-High-Quality interview" }, { name: "Spec and plan method" }, { name: "Journal method" }],
};

const setups = new Map<string, PageSetup>();
const defaults = new Map<string, PageSetup>();
const listeners = new Set<() => void>();
let counter = 0;
const nextId = () => `event-${++counter}`;
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

function defaultSetup(id: string, name: string): PageSetup | undefined {
  if (!DEFAULT_EXPERT_IDS.includes(id)) return undefined;
  let found = defaults.get(id);
  if (!found || found.expert?.name !== name) {
    found = { events: [], installStep: null, noticeShown: false, expert: { name, files: {}, backend: true }, plugins: [BRAINDRIVE_PLUGIN] };
    defaults.set(id, found);
  }
  return found;
}
function current(id: string, name: string): PageSetup {
  return setups.get(id) ?? defaultSetup(id, name) ?? { events: [], installStep: null, expert: null, plugins: [], noticeShown: false };
}
function update(id: string, name: string, change: (setup: PageSetup) => Partial<PageSetup>) {
  const base = current(id, name);
  setups.set(id, { ...base, ...change(base) });
  emit();
}
const lastNameCache = new Map<string, string>();
const rememberName = (id: string, name: string) => lastNameCache.set(id, name);
const nameOf = (id: string) => lastNameCache.get(id) ?? id;

/** The page's setup, or undefined for an ordinary page that has never been set up. */
export function usePageSetup(project: { id: string; name: string } | null): PageSetup | undefined {
  if (project) rememberName(project.id, project.name);
  return useSyncExternalStore(subscribe, () => (project ? setups.get(project.id) ?? defaultSetup(project.id, project.name) : undefined));
}

export async function mockAddPage(): Promise<{ id: string }> {
  await pause();
  const id = (await createProject("New page")).id;
  setups.set(id, { events: [{ id: nextId(), type: "choose" }], installStep: null, expert: null, plugins: [], noticeShown: false });
  emit();
  return { id };
}

export function startBuild(id: string) {
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events.filter((event) => event.type !== "choose"), { id: nextId(), type: "build" }],
    installStep: null,
    expert: { name: "My Expert", files: { "instructions.md": "# My Expert\n\nThis Expert helps you with the job you describe in the conversation. Tell it what you want done, and change these instructions any time.\n" } },
    plugins: [{ id: "behavior", name: "My Expert", source: "made by you", skills: [{ name: "Instructions" }] }, BRAINDRIVE_PLUGIN],
  }));
}

/** Opens the install step: from "Install one" (Expert) or from Add plugin (plugin). */
export function startInstallStep(id: string, mode: "expert" | "plugin") {
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events.filter((event) => event.type !== "choose"), { id: nextId(), type: "install-help", mode }],
    installStep: mode,
  }));
}

/** Puts the two starting buttons back on a page that still has no Expert. */
export function offerStart(id: string) {
  update(id, nameOf(id), (setup) => setup.expert || setup.events.some((event) => event.type === "choose") ? {} : { events: [...setup.events, { id: nextId(), type: "choose" }] });
}

function readableName(file: string): string {
  const base = file.replace(/\.zip$/i, "").replace(/[-_]+/g, " ").replace(/\b(expert|plugin)\b/gi, "").trim();
  return base ? base.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Sample";
}

/** Stand-in for BrainDrive's package checks (AC-8.2). Returns a one-line reason, or the review. */
export function checkPluginFile(fileName: string, mode: "expert" | "plugin"): { reason: string } | { review: PluginReview } {
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".zip")) return { reason: "This is not a valid ZIP file." };
  if (lower.includes("script")) return { reason: "Scripts are not supported in this version." };
  if (lower.includes("big")) return { reason: "A file in this package is over 256 KiB." };
  if (mode === "plugin" && lower.includes("expert")) return { reason: "This is an Expert; install it on a new page." };
  if (mode === "expert") {
    const name = lower.includes("business") || lower.includes("starter") ? "Start a Business" : readableName(fileName);
    return { review: {
      kind: "expert", name, creator: "unverified (Sample Author)", license: "MIT",
      adds: "An Expert with instructions and a spec template.", fileName,
      files: {
        "SKILL.md": "---\nname: instructions\ndescription: How this Expert works with you. Sample text while the real package format is built.\n---\nHelp the owner explore the job step by step. Ask one question at a time.",
        "templates/spec.md": "# Spec\n\n(Sample template. The real template text appears here.)",
        "LICENSE.txt": "MIT License. Sample licence text.",
      },
      warnings: [],
    } };
  }
  const name = readableName(fileName);
  return { review: {
    kind: "plugin", name, creator: "unknown", license: "not stated",
    adds: `One plugin with one skill, added to this page only.`, fileName,
    files: { "SKILL.md": "---\nname: research-helper\ndescription: Sample skill text.\nallowed-tools: web-search\n---\nFind and summarise what you are asked about. Needs web search.", "LICENSE.txt": "Sample licence text." },
    warnings: ["This skill needs web search, which is not available yet."],
  } };
}

/** The chosen or dropped file goes to the BrainDrive check, never to the model. */
export async function submitPluginFile(id: string, fileName: string) {
  const mode = current(id, nameOf(id)).installStep;
  if (!mode) return;
  await pause();
  const result = checkPluginFile(fileName, mode);
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events, "reason" in result ? { id: nextId(), type: "refused", reason: result.reason } : { id: nextId(), type: "review", review: result.review, status: "pending" }],
  }));
}

/** "Start a Business" -> "Start a Business 2" when the name is taken by another page. */
export function uniquePageName(name: string, taken: string[]): string {
  const used = new Set(taken.map((item) => item.trim().toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  let n = 2;
  while (used.has(`${name} ${n}`.toLowerCase())) n += 1;
  return `${name} ${n}`;
}

/** Applies the reviewed setup to the CURRENT page; the caller renames the page. */
export function applyInstall(id: string, eventId: string, pageName: string) {
  update(id, nameOf(id), (setup) => {
    const event = setup.events.find((item) => item.id === eventId);
    if (!event || event.type !== "review") return {};
    const { review } = event;
    const skills = Object.keys(review.files).filter((file) => file.endsWith("SKILL.md")).map(() => ({ name: review.kind === "expert" ? "Instructions" : "Research helper", needs: review.warnings.length ? "Needs web search (not available yet)" : undefined }));
    const events: HostEvent[] = setup.events.map((item) => item.id === eventId && item.type === "review" ? { ...item, status: "installed" as const } : item);
    events.push({ id: nextId(), type: "result", text: review.kind === "expert" ? `Installed ${pageName}. This page is now set up as ${pageName}.` : `Added ${review.name} to this page.` });
    if (review.kind === "expert") {
      return { events, installStep: null, expert: { name: pageName, files: Object.fromEntries(Object.entries(review.files).filter(([file]) => file !== "LICENSE.txt")) },
        plugins: [{ id: "behavior", name: pageName, source: "installed from a plugin file", skills }, ...setup.plugins.filter((plugin) => plugin.id !== "behavior")] };
    }
    return { events, installStep: null, plugins: [...setup.plugins, { id: `plugin-${eventId}`, name: review.name, source: "installed from a plugin file", skills: skills.map((skill) => ({ ...skill, needs: "Needs web search (not available yet)" })) }] };
  });
}

export function cancelInstall(id: string, eventId: string) {
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events.map((item) => item.id === eventId && item.type === "review" ? { ...item, status: "cancelled" as const } : item), { id: nextId(), type: "result" as const, text: "Nothing was installed." }],
    installStep: null,
  }));
  offerStart(id);
}

export function saveExpertFile(id: string, file: string, text: string) {
  update(id, nameOf(id), (setup) => setup.expert ? { expert: { ...setup.expert, files: { ...setup.expert.files, [file]: text } } } : {});
}

/** First message on a page with an Expert: the fixed AI notice, once per page (AC-1.6). */
export function noteFirstMessage(id: string, name: string) {
  const setup = current(id, name);
  if (!setup.expert || setup.noticeShown) return;
  update(id, name, (base) => ({ noticeShown: true, events: [...base.events, { id: nextId(), type: "notice" }] }));
}

/** Pages that are retired and hidden from the prototype's navigation (the New Project page). */
export function isRetiredPage(project: { id: string; name: string }): boolean {
  return project.id === "new-project" || /^(your )?new project$/i.test(project.name.trim());
}

/** Test helper. */
export function resetExpertsMock() { setups.clear(); defaults.clear(); lastNameCache.clear(); emit(); }
