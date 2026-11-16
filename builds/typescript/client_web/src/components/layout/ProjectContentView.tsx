import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, FilePlus, FileText, Trash2 } from "lucide-react";

import { expertPreviewEnabled, reviewSkills, saveExpertFile, type PagePlugin, type PageSetup } from "@/api/experts";
import { formatSavedTime, sampleLastSaved } from "@/prototype/fileHistoryMock";
import type { Project, ProjectFile } from "@/types/ui";
import { buildProjectSidebarModel, type SidebarFileItem } from "./sidebar-categorize";
import { projectRelativePath } from "./sidebar-labels";

export type ProjectView = "files" | "plugins";
export const PROJECT_VIEW_LABELS: Record<ProjectView, string> = {
  files: "Your Files", plugins: "Settings",
};
type DisplayFile = SidebarFileItem & { description?: string };
const focusStyle = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber";

export default function ProjectContentView({ view, project, files, isLoading, hasFilesError, onOpenFile, onBack, setup, onStartExpert, onInstallExpert, onShareExpert, onDeletePage, onCreateFile }: {
  view: ProjectView;
  onDeletePage?: () => void;
  project: Project;
  files: ProjectFile[];
  isLoading: boolean;
  hasFilesError?: boolean;
  onOpenFile: (file: ProjectFile) => void;
  onBack: () => void;
  setup?: PageSetup;
  onStartExpert?: () => void;
  onInstallExpert?: () => void;
  onCreateFile?: (path: string, content: string) => Promise<void>;
  onShareExpert?: () => void;
}) {
  const model = buildProjectSidebarModel(project.id, files);
  // Goals, Plan and Journal are fixed shortcuts at the top, in that order, each shown when the file exists.
  const shortcuts: DisplayFile[] = ([
    [model.goals, "Your Goals", "What you want to achieve"],
    [model.plan, "Your Plan", "Your approach and next steps"],
    [model.journal, "Your Journal", "Notes and progress over time"],
  ] as const).flatMap(([item, label, description]) => item ? [{ ...item, label, description }] : []);
  const work: DisplayFile[] = [...(model.todo ? [{ ...model.todo, label: "To-do", description: "Your saved task list" }] : []), ...model.files];
  const [addingFile, setAddingFile] = useState(false);
  const instructions = model.expert.instructions.find((item) => item.canonicalPath === "AGENT.md");
  const interviewGuide = model.expert.skills.find((item) => item.canonicalPath === "business-idea-interview.md");
  const interview: DisplayFile[] = [
    ...(interviewGuide ? [{ ...interviewGuide, label: "Interview guide", description: "The questions and process used for this Expert" }] : []),
  ];
  // Everything else the Expert comes with, so Page Settings lists the same files the export card does.
  const otherExpertFiles: DisplayFile[] = [...model.expert.instructions.filter((item) => item.canonicalPath !== "AGENT.md"), ...model.expert.skills.filter((item) => item !== interviewGuide)]
    .map((item) => ({ ...item, description: /(^|\/)references\//i.test(item.canonicalPath) ? "Reference file" : "Method or reference file" }));
  const title = view === "plugins" ? "Page Settings" : PROJECT_VIEW_LABELS[view];

  return (
    <section aria-label={`${title} content`} className="flex h-full min-h-0 flex-1 flex-col bg-bd-bg-chat pb-[var(--mobile-composer-height,0px)] md:pb-0">
      <header className="border-b border-bd-border px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[780px] flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h1 className="font-heading text-xl text-bd-text-heading">{title}</h1>
          <button type="button" onClick={onBack} className={`flex shrink-0 items-center gap-2 rounded-md p-2 text-sm text-bd-text-secondary hover:bg-bd-bg-hover ${focusStyle}`}><ArrowLeft size={16} aria-hidden="true" />Back to Your Expert</button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-[780px] space-y-7">
          {view === "plugins" ? <><PluginsList project={project} setup={setup} onStartExpert={onStartExpert} onInstallExpert={onInstallExpert} backendSkills={[...interview, ...otherExpertFiles].filter((item) => !/(^|\/)references\//i.test(item.canonicalPath)).map((item) => item.label)} behaviorFiles={<>
            <FileList items={instructions ? [{ ...instructions, label: "Instructions", description: "How this Expert works with you" }] : []} onOpenFile={onOpenFile} empty="No instruction file is available for this Expert yet." />
            {interview.length ? <div className="mt-3"><FileList items={interview} onOpenFile={onOpenFile} /></div> : null}
            {otherExpertFiles.length ? <div className="mt-3"><FileList items={otherExpertFiles} onOpenFile={onOpenFile} /></div> : null}
            <div className="mt-3"><FileList items={model.expert.templates} onOpenFile={onOpenFile} empty="No templates saved yet." /></div>
            <p className="mt-2 text-xs text-bd-text-secondary">Templates stay separate from the work in Your Files.</p>
          </>} />{onShareExpert && setup?.expert ? <ContentSection title="Share this Expert"><div className="rounded-lg border border-bd-border p-5"><p className="text-sm leading-relaxed text-bd-text-secondary">Save this Expert as one plugin file you can give to someone else or post on the BrainDrive forum. You see every file in it before anything is saved. Your Memory isn't included. Only the files inside the Expert travel.</p><button type="button" onClick={onShareExpert} className={`mt-3 min-h-11 rounded-lg border border-bd-border px-4 py-2 text-sm text-bd-text-primary hover:bg-bd-bg-hover ${focusStyle}`}>Share this Expert</button></div></ContentSection> : null}{onDeletePage ? <ContentSection title="Delete page"><div className="rounded-lg border border-red-400/40 p-5"><p className="text-sm leading-relaxed text-bd-text-secondary">Deleting this page removes it from the sidebar and stops its Expert. Your files stay in your Memory folder.</p><button type="button" onClick={onDeletePage} className={`mt-3 flex min-h-11 items-center gap-2 rounded-lg border border-red-400/60 px-4 py-2 text-sm text-red-400 hover:bg-bd-bg-hover ${focusStyle}`}><Trash2 size={16} aria-hidden="true" />Delete page</button></div></ContentSection> : null}</> : isLoading ? <p role="status" className="text-bd-text-secondary">Loading your files…</p> : hasFilesError ? <p role="alert" className="text-bd-text-primary">Your files could not be loaded. Reopen this page to try again.</p> : <>
            {shortcuts.length ? <section aria-label="Goals, Plan and Journal"><FileList items={shortcuts} onOpenFile={onOpenFile} showSavedTime={expertPreviewEnabled} /></section> : null}
            <ContentSection title="Your work" action={onCreateFile && !addingFile ? <button type="button" onClick={() => setAddingFile(true)} className={`flex min-h-11 items-center gap-2 rounded-lg border border-bd-border px-4 py-2 text-sm text-bd-text-primary hover:bg-bd-bg-hover ${focusStyle}`}><FilePlus size={16} aria-hidden="true" />New file</button> : null}>
              {onCreateFile && addingFile ? <NewFileForm projectId={project.id} files={files} onCreateFile={onCreateFile} onClose={() => setAddingFile(false)} /> : null}
              <FileList items={work} onOpenFile={onOpenFile} showSavedTime={expertPreviewEnabled} empty="No outputs saved yet. Briefs, documents, and other work saved for this page will appear here." /></ContentSection>
          </>}
        </div>
      </div>
    </section>
  );
}

function ContentSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section aria-label={title}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-heading text-base text-bd-text-heading">{title}</h2>{action}</div>{children}</section>;
}

// The owner adds a file by pasting or typing text. It is saved as plain text in the page's "added" folder,
// exactly as written, with no model involved. There is no file upload in Phase 1.
const NEW_FILE_MAX_CHARS = 200_000;
// Cells copied from a spreadsheet, or a table copied from a web page or document, arrive as rows of
// tab-separated text. Turn that into a Markdown table so the columns stay lined up. Anything else is left alone.
export function pastedTableToMarkdown(pasted: string): string | null {
  const rows = pasted.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  if (rows.length < 2 || !rows.every((row) => row.includes("\t"))) return null;
  const cells = rows.map((row) => row.split("\t").map((cell) => cell.trim().replace(/\|/g, "\\|")));
  const width = Math.max(...cells.map((row) => row.length));
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
  return [line(cells[0]!), `|${" --- |".repeat(width)}`, ...cells.slice(1).map(line)].join("\n");
}
function NewFileForm({ projectId, files, onCreateFile, onClose }: { projectId: string; files: ProjectFile[]; onCreateFile: (path: string, content: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) return setError("Give the file a name, using letters or numbers.");
    if (!text.trim()) return setError("Paste or type some text first.");
    if (text.length > NEW_FILE_MAX_CHARS) return setError(`This text is too long to save as one file. The limit is ${NEW_FILE_MAX_CHARS.toLocaleString("en-US")} characters, and this is ${text.length.toLocaleString("en-US")}.`);
    const relativePath = `added/${slug}.md`;
    if (files.some((file) => projectRelativePath(file.path, projectId).toLowerCase() === relativePath)) return setError("A file with that name already exists. Choose a different name.");
    setError(null);
    setSaving(true);
    try {
      await onCreateFile(`documents/${projectId}/${relativePath}`, text);
      onClose();
    } catch {
      setError("The file could not be saved. Your text is still here, so you can try again.");
      setSaving(false);
    }
  }
  const field = `w-full rounded-lg border border-bd-border bg-bd-bg-secondary px-3 py-2 text-sm text-bd-text-primary ${focusStyle}`;
  return <form aria-label="New file" onSubmit={(event) => { event.preventDefault(); void save(); }} className="mb-3 space-y-3 rounded-lg border border-bd-border p-4">
    <label className="block text-sm text-bd-text-primary">File name<input type="text" value={name} onChange={(event) => setName(event.target.value)} className={`mt-1 ${field}`} /></label>
    <label className="block text-sm text-bd-text-primary">Paste or type your text<textarea value={text} onChange={(event) => setText(event.target.value)} onPaste={(event) => {
      const table = pastedTableToMarkdown(event.clipboardData.getData("text/plain"));
      if (!table) return;
      event.preventDefault();
      const { selectionStart, selectionEnd } = event.currentTarget;
      const before = text.slice(0, selectionStart);
      setText(`${before}${before && !before.endsWith("\n") ? "\n\n" : ""}${table}\n${text.slice(selectionEnd)}`);
    }} rows={12} className={`mt-1 font-mono ${field}`} /></label>
    <p className="text-xs text-bd-text-secondary">Saved as plain text in this page's files, exactly as you wrote it. Cells pasted from a spreadsheet are kept as a table. It stays in Your Memory and does not travel if you share this Expert.</p>
    {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
    <div className="flex flex-wrap gap-2">
      <button type="submit" disabled={saving} className={`min-h-11 rounded-lg border border-bd-border px-4 py-2 text-sm text-bd-text-primary hover:bg-bd-bg-hover disabled:opacity-60 ${focusStyle}`}>{saving ? "Saving…" : "Save file"}</button>
      <button type="button" onClick={onClose} disabled={saving} className={`min-h-11 rounded-lg px-4 py-2 text-sm text-bd-text-secondary hover:bg-bd-bg-hover ${focusStyle}`}>Cancel</button>
    </div>
  </form>;
}

// showSavedTime (PROTOTYPE): the last-saved time under each file, from the mock history (Page changes PC-7.1).
function FileList({ items, onOpenFile, empty, showPaths = false, showSavedTime = false }: { items: DisplayFile[]; onOpenFile: (file: ProjectFile) => void; empty?: string; showPaths?: boolean; showSavedTime?: boolean }) {
  if (items.length === 0) return empty ? <p className="rounded-lg border border-dashed border-bd-border p-5 text-sm leading-relaxed text-bd-text-secondary">{empty}</p> : null;
  return <div className="divide-y divide-bd-border rounded-lg border border-bd-border">{items.map((item) => <div key={item.file.path} className="flex items-center gap-2 rounded-lg px-3 hover:bg-bd-bg-secondary">
    <button type="button" aria-label={item.label} title={item.canonicalPath} onClick={() => onOpenFile(item.file)} className={`flex min-w-0 flex-1 items-center gap-3 rounded-md py-4 text-left ${focusStyle}`}>
      <FileText size={18} className="shrink-0 text-bd-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block text-sm text-bd-text-primary">{item.label}</span>{item.description || showPaths ? <span className="mt-1 block break-words text-xs text-bd-text-secondary">{showPaths ? item.canonicalPath : item.description}</span> : null}{showSavedTime ? <span className="mt-0.5 block text-xs text-bd-text-muted">Saved {formatSavedTime(sampleLastSaved(item.file.path))}</span> : null}</span>
      {item.badge ? <span className="text-xs text-bd-text-secondary">{item.badge}</span> : null}<ArrowUpRight size={16} className="shrink-0 text-bd-text-secondary" aria-hidden="true" />
    </button>
  </div>)}</div>;
}

// Where the Expert came from. Shown for information only; it has no effect on what the Expert can read.
function originOf(plugin: { source: string; route?: "forum" | "elsewhere" } | undefined): string {
  if (plugin?.source !== "installed from a plugin file") return "Made by you";
  if (plugin.route === "elsewhere") return "Installed from a plugin file. Not reviewed by BrainDrive.";
  if (plugin.route === "forum") return "Installed from a plugin file from the BrainDrive forum";
  return "Installed from a plugin file";
}

type ExpertFacts = { origin: string; creator: string; license?: string; version?: string; installed?: string; skills: string[]; record: [string, string][] };

// What Settings says about an Expert (AC-4.1): where it came from, who made it, its license, version
// label and install date (display only), and the skills it holds. The install record (AC-8.8) is
// kept for Advanced. Defaults that came with BrainDrive are shown as BrainDrive's, under MIT.
function expertFacts(expert: NonNullable<PageSetup["expert"]>, plugin: PagePlugin | undefined, backendSkills: string[]): ExpertFacts {
  if (expert.backend) return { origin: "Included with BrainDrive", creator: "by BrainDrive", license: "MIT", skills: backendSkills,
    record: [["Expert ID", expert.instanceId ?? "not set"], ["Type", "Expert"], ["Name", expert.name], ["Source", "came with BrainDrive"]] };
  const installed = plugin?.source === "installed from a plugin file";
  const skills = reviewSkills(expert.files).map((skill) => skill.name);
  if (!installed) return { origin: "Made by you", creator: "made by you", skills,
    record: [["Expert ID", expert.instanceId ?? "not set"], ["Type", "Expert"], ["Name", expert.name], ["Source", "made by you"]] };
  return {
    origin: originOf(plugin), creator: `by ${plugin.creator || "unknown"}`, license: plugin.license || "not stated", version: plugin.version || "none given",
    installed: plugin.installedAt ? new Date(plugin.installedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : undefined,
    skills, record: [["Expert ID", expert.instanceId ?? "not set"], ["Type", "Expert"], ["Name", expert.name], ["Source", `installed from a plugin file (${plugin.fileName ?? "file name not kept"})`]],
  };
}

function AboutExpert({ facts }: { facts: ExpertFacts }) {
  const rows: [string, ReactNode][] = [
    ["Origin", facts.origin], ["Creator", facts.creator],
    ...(facts.license ? [["License", facts.license] as [string, ReactNode]] : []),
    ...(facts.version ? [["Version", facts.version] as [string, ReactNode]] : []),
    ...(facts.installed ? [["Installed", facts.installed] as [string, ReactNode]] : []),
    ["Skills", facts.skills.length ? facts.skills.join(", ") : "None. It works from its instructions."],
  ];
  return <dl aria-label="About this Expert" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-bd-border p-4 text-sm">
    {rows.map(([label, value]) => <div key={label} className="contents"><dt className="text-bd-text-secondary">{label}</dt><dd className="text-bd-text-primary">{value}</dd></div>)}
  </dl>;
}

function Advanced({ record }: { record: [string, string][] }) {
  return <details className="rounded-lg border border-bd-border p-4 text-sm">
    <summary className={`cursor-pointer text-bd-text-secondary ${focusStyle}`}>Advanced</summary>
    <p className="mt-3 text-bd-text-primary">Install record</p>
    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{record.map(([label, value]) => <div key={label} className="contents"><dt className="text-bd-text-secondary">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
    <p className="mt-2 text-xs text-bd-text-secondary">BrainDrive keeps this note about where this Expert came from. It isn't shared when you share the Expert.</p>
  </details>;
}

function PluginsList({ project, setup, onStartExpert, onInstallExpert, behaviorFiles, backendSkills }: { project: Project; setup?: PageSetup; onStartExpert?: () => void; onInstallExpert?: () => void; behaviorFiles: ReactNode; backendSkills: string[] }) {
  const expert = setup?.expert ?? null;
  const facts = expert ? expertFacts(expert, setup?.plugins.find((plugin) => plugin.id === "behavior"), backendSkills) : null;
  return <>
    <p className="text-sm text-bd-text-secondary">What shapes this page.</p>
    {facts ? <AboutExpert facts={facts} /> : null}
    {expert ? <ContentSection title={`What ${expert.name} comes with`}>
      {expert.backend ? behaviorFiles : <MockBehavior projectId={project.id} files={expert.files} />}
    </ContentSection> : <ContentSection title="What this Expert comes with"><div className="rounded-lg border border-dashed border-bd-border p-5 text-sm leading-relaxed text-bd-text-secondary"><p>This page has no Expert yet.</p>{onStartExpert ? <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={onStartExpert} className={`min-h-11 rounded-lg border border-bd-amber bg-bd-amber px-4 py-2 text-bd-bg-primary hover:bg-bd-amber-hover ${focusStyle}`}>Create an Expert</button><button type="button" onClick={onInstallExpert} className={`min-h-11 rounded-lg border border-bd-border px-4 py-2 text-bd-text-primary hover:bg-bd-bg-hover ${focusStyle}`}>Install an Expert</button></div> : null}</div></ContentSection>}
    {facts ? <Advanced record={facts.record} /> : null}
  </>;
}

// Files of a page set up in this prototype live in the browser only, so they open in a small
// editor here instead of the page file editor. Real pages (Finance and so on) use the file editor.
// The cards look the same as the ones real pages show.
function MockBehavior({ projectId, files }: { projectId: string; files: Record<string, string> }) {
  const names = Object.keys(files);
  const instructionsFile = names.find((file) => /(^|\/)(instructions|SKILL)\.md$/.test(file) && !file.startsWith("templates/"));
  const templateFiles = names.filter((file) => file.startsWith("templates/"));
  return <>
    {instructionsFile ? <MockCard projectId={projectId} rows={[{ file: instructionsFile, text: files[instructionsFile], label: "Instructions", description: "How this Expert works with you" }]} />
      : <p className="rounded-lg border border-dashed border-bd-border p-5 text-sm leading-relaxed text-bd-text-secondary">No instruction file is available for this Expert yet.</p>}
    <div className="mt-3">{templateFiles.length ? <MockCard projectId={projectId} rows={templateFiles.map((file) => ({ file, text: files[file], label: file.split("/").pop() ?? file, description: "Template" }))} />
      : <p className="rounded-lg border border-dashed border-bd-border p-5 text-sm leading-relaxed text-bd-text-secondary">No templates saved yet.</p>}</div>
    <p className="mt-2 text-xs text-bd-text-secondary">Templates stay separate from the work in Your Files.</p>
  </>;
}

function MockCard({ projectId, rows }: { projectId: string; rows: { file: string; text: string; label: string; description: string }[] }) {
  return <div className="divide-y divide-bd-border rounded-lg border border-bd-border">{rows.map((row) => <MockRow key={`${projectId}:${row.file}`} projectId={projectId} {...row} />)}</div>;
}

function MockRow({ projectId, file, text, label, description }: { projectId: string; file: string; text: string; label: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const [saved, setSaved] = useState(false);
  const id = `edit-${projectId}-${file}`;
  return <div className="rounded-lg px-3 hover:bg-bd-bg-secondary">
    <button type="button" aria-label={label} aria-expanded={open} title={file} onClick={() => setOpen(!open)} className={`flex w-full min-w-0 items-center gap-3 rounded-md py-4 text-left ${focusStyle}`}>
      <FileText size={18} className="shrink-0 text-bd-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block text-sm text-bd-text-primary">{label}</span><span className="mt-1 block break-words text-xs text-bd-text-secondary">{description}</span></span>
      <ArrowUpRight size={16} className="shrink-0 text-bd-text-secondary" aria-hidden="true" />
    </button>
    {open ? <div>
      <label className="block pb-1 text-xs text-bd-text-secondary" htmlFor={id}>Edit {file}</label>
      <textarea id={id} value={draft} rows={8} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} className={`w-full rounded-md border border-bd-border bg-bd-bg-primary p-3 text-sm text-bd-text-primary ${focusStyle}`} />
      <div className="flex items-center gap-3 py-3"><button type="button" onClick={() => { saveExpertFile(projectId, file, draft); setSaved(true); }} className={`min-h-11 rounded-lg border border-bd-border px-4 py-2 text-sm text-bd-text-primary hover:bg-bd-bg-hover ${focusStyle}`}>Save</button>{saved ? <span role="status" className="text-xs text-bd-text-secondary">Saved</span> : null}</div>
    </div> : null}
  </div>;
}
