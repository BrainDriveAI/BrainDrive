// PROTOTYPE ONLY: started from Experts and skills spec v0.8, Release 1 (no link install or
// updates). Share this Expert (the export card and the forum step) was added against v0.16. The gateway has no page-setup, plugin check or install endpoints yet, so
// the "New page" conversation, the plugin file check, the review card and the Plugins list are
// held here, in memory, in the browser. A reload forgets them. The only real back-end calls are
// the existing project create, rename and delete, which give each page a real sidebar entry.
//
// What this stand-in does:
// - New page makes a page and opens its chat with fixed BrainDrive text (not model output).
// - Create an Expert attaches the BrainDrive plugin and a "made by you" Behavior plugin.
// - Install an Expert opens the install step, on a new blank page only. Page Settings has no Add
//   plugin: in Phase 1 an owner holds Experts only. The owner first says where the file is
//   from: the BrainDrive forum (reviewed), or somewhere else (not reviewed, behind an "at my own
//   risk" tick). The chosen file then goes to a mock BrainDrive check (name-based rules, see
//   checkPluginFile), then a review card that states the source.
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
// Where the owner said a plugin file came from. BrainDrive cannot check this: a file from the forum
// and a file from anywhere else look the same. "forum" files have been reviewed by the BrainDrive team;
// "elsewhere" files have not, and need the owner's "at my own risk" tick before a file can be chosen.
export type InstallRoute = "forum" | "elsewhere";
export type PagePlugin = { id: string; name: string; source: PluginSource; skills: PluginSkill[]; route?: InstallRoute; creator?: string; license?: string };
export type PluginReview = {
  kind: "expert" | "plugin"; name: string; creator: string; license: string; adds: string;
  fileName: string; files: Record<string, string>; warnings: string[]; route?: InstallRoute;
};
export type HostEvent =
  | { id: string; type: "choose" }
  | { id: string; type: "build"; typed?: boolean }
  | { id: string; type: "install-help"; mode: "expert" | "plugin" }
  | { id: string; type: "refused"; reason: string }
  | { id: string; type: "review"; review: PluginReview; status: "pending" | "installed" | "cancelled" }
  | { id: string; type: "export"; draft: ExportDraft; status: "pending" | "saved" | "cancelled"; savedAs?: string }
  | { id: string; type: "result"; text: string }
  | { id: string; type: "notice" };
// What the export card starts from: the Expert's own files, and for an Expert installed from
// someone else, the creator and license it came with (kept unchanged on export, AC-13.7).
export type ExportDraft = { name: string; files: Record<string, string>; original?: { creator: string; license: string } };
export type ExportLicense = "MIT" | "none" | "other";
export type ExportChoices = { creator: string; license: ExportLicense; otherLicense: string };
export type PageSetup = {
  events: HostEvent[];
  installStep: "expert" | "plugin" | null;
  installRoute?: InstallRoute | null;
  // `backend` means the Expert's instructions and templates are real files on the page.
  expert: { name: string; files: Record<string, string>; backend?: boolean } | null;
  plugins: PagePlugin[];
  noticeShown: boolean;
};

export const DEFAULT_EXPERT_IDS = ["finance", "fitness", "career", "relationships"];
export const NO_FILE_NOTICE = "Files can't be added here. To install an Expert, make a new page and choose Install an Expert.";
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

export function startBuild(id: string, typed = false) {
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events.filter((event) => event.type !== "choose"), { id: nextId(), type: "build", typed }],
    installStep: null,
    expert: { name: "My Expert", files: { "instructions.md": "# My Expert\n\nThis Expert helps you with the job you describe in the conversation. Tell it what you want done, and change these instructions any time.\n" } },
    plugins: [{ id: "behavior", name: "My Expert", source: "made by you", skills: [{ name: "Instructions" }] }, BRAINDRIVE_PLUGIN],
  }));
}

/** Opens the install step from "Install an Expert". The "plugin" mode has no entry point in Phase 1. */
export function startInstallStep(id: string, mode: "expert" | "plugin") {
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events.filter((event) => event.type !== "choose"), { id: nextId(), type: "install-help", mode }],
    installStep: mode,
    installRoute: null,
  }));
}

/** The owner says where the file is from: the forum, or (after the "at my own risk" tick) somewhere else. */
export function chooseInstallRoute(id: string, route: InstallRoute | null) {
  update(id, nameOf(id), (setup) => setup.installStep ? { installRoute: route } : {});
}
export const NO_ROUTE_NOTICE = "First choose where this file came from: the BrainDrive forum, or somewhere else.";

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
export async function submitPluginFile(id: string, fileName: string, chosenRoute?: InstallRoute) {
  const { installStep: mode, installRoute } = current(id, nameOf(id));
  if (!mode) return;
  // A file that arrives before the owner has said where it came from (a dropped file, say) is not checked.
  const route = chosenRoute ?? installRoute;
  if (!route) {
    update(id, nameOf(id), (setup) => ({ events: [...setup.events, { id: nextId(), type: "refused", reason: NO_ROUTE_NOTICE }] }));
    return;
  }
  await pause();
  const result = checkPluginFile(fileName, mode);
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events, "reason" in result ? { id: nextId(), type: "refused", reason: result.reason } : { id: nextId(), type: "review", review: { ...result.review, route }, status: "pending" }],
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
      return { events, installStep: null, installRoute: null, expert: { name: pageName, files: Object.fromEntries(Object.entries(review.files).filter(([file]) => file !== "LICENSE.txt")) },
        plugins: [{ id: "behavior", name: pageName, source: "installed from a plugin file", skills, route: review.route, creator: review.creator.replace(/^unverified \((.*)\)$/, "$1"), license: review.license }, ...setup.plugins.filter((plugin) => plugin.id !== "behavior")] };
    }
    return { events, installStep: null, installRoute: null, plugins: [...setup.plugins, { id: `plugin-${eventId}`, name: review.name, source: "installed from a plugin file", route: review.route, skills: skills.map((skill) => ({ ...skill, needs: "Needs web search (not available yet)" })) }] };
  });
}

export function cancelInstall(id: string, eventId: string) {
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events.map((item) => item.id === eventId && item.type === "review" ? { ...item, status: "cancelled" as const } : item), { id: nextId(), type: "result" as const, text: "Nothing was installed." }],
    installStep: null,
    installRoute: null,
  }));
  offerStart(id);
}

/** The owner backs out of the install step before choosing a file. Nothing was installed. */
export function cancelInstallStep(id: string) {
  if (!current(id, nameOf(id)).installStep) return;
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events, { id: nextId(), type: "result" as const, text: "Nothing was installed." }],
    installStep: null,
    installRoute: null,
  }));
  offerStart(id);
}

const MIT_TEXT = (holder: string) => `MIT License

Copyright (c) ${new Date().getFullYear()} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;
export const pluginSlug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "expert";

/** Every file the plugin file will hold, in order, generated ones included (AC-13.2, AC-13.9, AC-13.14). */
export function exportFileList(draft: ExportDraft, choices: ExportChoices): [path: string, text: string][] {
  const slug = pluginSlug(draft.name);
  const creator = draft.original ? draft.original.creator : choices.creator.trim();
  const license = draft.original ? draft.original.license : choices.license === "MIT" ? "MIT" : choices.license === "other" ? choices.otherLicense.trim() : "";
  const manifest: Record<string, string> = { name: slug, version: "0.1.0", description: `${draft.name}, an Expert made with BrainDrive.` };
  if (creator) manifest.author = creator;
  if (license) manifest.license = license;
  const inside = Object.entries(draft.files).map(([file, text]): [string, string] => {
    if (/(^|\/)(instructions|SKILL)\.md$/.test(file) && !file.startsWith("templates/")) return [`skills/${slug}/SKILL.md`, text];
    if (file.startsWith("templates/")) return [`skills/${slug}/assets/${file.slice("templates/".length)}`, text];
    return [`skills/${slug}/references/${file.replace(/^references\//, "")}`, text];
  });
  return [
    ["plugin.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["ai.braindrive/expert.json", `${JSON.stringify({ type: "expert" }, null, 2)}\n`],
    ...inside,
    ...(license === "MIT" ? [["LICENSE", MIT_TEXT(creator || "the creator of this plugin")] as [string, string]] : []),
  ];
}

/** Share this Expert: BrainDrive (not the model) opens the export card for the page's Expert (AC-13.1). */
export function startExport(id: string, backendFiles?: Record<string, string>) {
  update(id, nameOf(id), (setup) => {
    if (!setup.expert) return {};
    const behavior = setup.plugins.find((plugin) => plugin.id === "behavior");
    const installed = behavior?.source === "installed from a plugin file";
    const draft: ExportDraft = {
      name: setup.expert.name, files: backendFiles ?? setup.expert.files,
      original: installed ? { creator: behavior.creator || "unknown", license: behavior.license || "not stated" } : undefined,
    };
    // Only one export card waits at a time; an older one that was left open is closed.
    const events: HostEvent[] = setup.events.map((item) => item.type === "export" && item.status === "pending" ? { ...item, status: "cancelled" as const } : item);
    return { events: [...events, { id: nextId(), type: "export", draft, status: "pending" }] };
  });
}

export function saveExport(id: string, eventId: string, savedAs: string) {
  update(id, nameOf(id), (setup) => ({ events: setup.events.map((item) => item.id === eventId && item.type === "export" ? { ...item, status: "saved" as const, savedAs } : item) }));
}

export function cancelExport(id: string, eventId: string) {
  update(id, nameOf(id), (setup) => ({
    events: [...setup.events.map((item) => item.id === eventId && item.type === "export" ? { ...item, status: "cancelled" as const } : item), { id: nextId(), type: "result" as const, text: "Nothing was saved." }],
  }));
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
