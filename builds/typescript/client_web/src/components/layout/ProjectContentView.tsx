import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Copy, FileText } from "lucide-react";

import { getProjectSkills, listSkills } from "@/api/gateway-adapter";
import type { Project, ProjectFile } from "@/types/ui";
import { buildProjectSidebarModel, type SidebarFileItem } from "./sidebar-categorize";
import { expertPurpose } from "./expert-context";
import { localPreviewFolder } from "./local-preview-folder";

export type ProjectView = "files" | "tools" | "expert";
export const PROJECT_VIEW_LABELS: Record<ProjectView, string> = {
  files: "Your Files", tools: "Tools", expert: "Behavior",
};
type DisplayFile = SidebarFileItem & { description?: string };
const focusStyle = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber";

export default function ProjectContentView({ view, project, files, isLoading, hasFilesError, onOpenFile, onBack, onOpenApps }: {
  view: ProjectView;
  project: Project;
  files: ProjectFile[];
  isLoading: boolean;
  hasFilesError?: boolean;
  onOpenFile: (file: ProjectFile) => void;
  onBack: () => void;
  onOpenApps: () => void;
}) {
  const model = buildProjectSidebarModel(project.id, files);
  const direction = ([
    [model.goals, "Goals", "What you want to achieve"],
    [model.plan, "Plan", "Your approach and next steps"],
    [model.todo, "To-do", "Your saved task list"],
    [model.journal, "Journal", "Notes and progress over time"],
  ] as const).flatMap(([item, label, description]) => item ? [{ ...item, label, description }] : []);
  const preferences = model.expert.instructions.find((item) => item.canonicalPath === "AGENT-user.md")
    ?? model.expert.instructions.find((item) => item.canonicalPath === "AGENT.md");
  const interviewGuide = model.expert.skills.find((item) => item.canonicalPath === "business-idea-interview.md");
  const interviewPreferences = model.expert.instructions.find((item) => item.canonicalPath === "run-interview-user.md");
  const interview: DisplayFile[] = [
    ...(interviewGuide ? [{ ...interviewGuide, label: "Interview guide", description: "The questions and process used for this Expert" }] : []),
    ...(interviewPreferences ? [{ ...interviewPreferences, label: "Interview preferences", description: "Your guidance for the interview" }] : []),
  ];
  const remaining = model.advanced.filter((item) => item !== preferences && item !== interviewGuide && item !== interviewPreferences && !model.expert.templates.includes(item));
  const title = PROJECT_VIEW_LABELS[view];

  return (
    <section aria-label={`${title} content`} className="flex h-full min-h-0 flex-1 flex-col bg-bd-bg-chat pb-[var(--mobile-composer-height,0px)] md:pb-0">
      <header className="border-b border-bd-border px-4 py-4 sm:px-8">
        <div className="mx-auto flex max-w-[780px] flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h1 className="font-heading text-xl text-bd-text-heading">{title}</h1>
          <button type="button" onClick={onBack} className={`flex shrink-0 items-center gap-2 rounded-md p-2 text-sm text-bd-text-secondary hover:bg-bd-bg-hover ${focusStyle}`}><ArrowLeft size={16} aria-hidden="true" />Back to Conversation</button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto max-w-[780px] space-y-7">
          {view === "tools" ? <ProjectTools key={project.id} projectId={project.id} onOpenApps={onOpenApps} /> : isLoading ? <p role="status" className="text-bd-text-secondary">Loading your files…</p> : hasFilesError ? <p role="alert" className="text-bd-text-primary">Your files could not be loaded. Reopen this Expert to try again.</p> : view === "files" ? <>
            <ContentSection title="Direction & progress">
              <FileList items={direction} onOpenFile={onOpenFile} empty="No direction or progress files saved yet. Your goals, plans, task lists, and journal will appear here when available." />
            </ContentSection>
            <ContentSection title="Your work"><FileList items={model.files} onOpenFile={onOpenFile} empty="No outputs saved yet. Briefs, documents, and other work saved for this Expert will appear here." /></ContentSection>
            <StorageDetails projectId={project.id} />
          </> : <>
            <p className="text-sm text-bd-text-secondary">See and change how your Expert helps you</p>
            <ContentSection title="What this Expert is for"><p className="text-sm leading-relaxed text-bd-text-primary">{expertPurpose(project)}</p></ContentSection>
            <ContentSection title="How it works with you">
              <FileList items={preferences ? [{ ...preferences, label: "Your instructions", description: "Preferences and guidance for this Expert" }] : []} onOpenFile={onOpenFile} empty="No instruction file is available for this Expert yet." />
            </ContentSection>
            <ContentSection title="Interview guidance"><FileList items={interview} onOpenFile={onOpenFile} empty="No interview guidance is saved for this Expert yet." /></ContentSection>
            <ContentSection title="Reusable templates"><FileList items={model.expert.templates} onOpenFile={onOpenFile} empty="No reusable templates saved yet." /><p className="mt-2 text-xs text-bd-text-secondary">Templates stay separate from the work in Your Files.</p></ContentSection>
            <details className="border-t border-bd-border pt-4">
              <summary className={`cursor-pointer rounded text-sm text-bd-text-secondary ${focusStyle}`}>Technical details</summary>
              <div className="mt-4 space-y-4">
                <p className="text-sm text-bd-text-secondary">Base instructions and supporting files. These are editable documents; opening them does not run an interview or register a skill.</p>
                <FileList items={remaining} onOpenFile={onOpenFile} showPaths allFiles={files} empty="No additional setup files." />
                <details><summary className={`cursor-pointer rounded text-sm text-bd-text-secondary ${focusStyle}`}>File paths for the settings above</summary><ul className="mt-3 space-y-2 text-xs text-bd-text-secondary">{[preferences, interviewGuide, interviewPreferences, ...model.expert.templates].filter((item): item is SidebarFileItem => Boolean(item)).map((item) => <li key={item.file.path}><code className="break-all">{item.file.path}</code></li>)}</ul></details>
              </div>
            </details>
          </>}
        </div>
      </div>
    </section>
  );
}

function ContentSection({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title}><h2 className="mb-3 font-heading text-base text-bd-text-heading">{title}</h2>{children}</section>;
}

function FileList({ items, onOpenFile, empty, showPaths = false, allFiles = [] }: { items: DisplayFile[]; onOpenFile: (file: ProjectFile) => void; empty?: string; showPaths?: boolean; allFiles?: ProjectFile[] }) {
  if (items.length === 0) return empty ? <p className="rounded-lg border border-dashed border-bd-border p-5 text-sm leading-relaxed text-bd-text-secondary">{empty}</p> : null;
  return <div className="divide-y divide-bd-border rounded-lg border border-bd-border">{items.map((item) => <div key={item.file.path} className="flex items-center gap-2 rounded-lg px-3 hover:bg-bd-bg-secondary">
    <button type="button" aria-label={item.label} title={item.canonicalPath} onClick={() => onOpenFile(item.file)} className={`flex min-w-0 flex-1 items-center gap-3 rounded-md py-4 text-left ${focusStyle}`}>
      <FileText size={18} className="shrink-0 text-bd-text-secondary" aria-hidden="true" />
      <span className="min-w-0 flex-1"><span className="block text-sm text-bd-text-primary">{item.label}</span>{item.description || showPaths ? <span className="mt-1 block break-words text-xs text-bd-text-secondary">{showPaths ? item.canonicalPath : item.description}</span> : null}</span>
      {item.badge ? <span className="text-xs text-bd-text-secondary">{item.badge}</span> : null}<ArrowUpRight size={16} className="shrink-0 text-bd-text-secondary" aria-hidden="true" />
    </button>
    {showPaths && item.overlayPath && !allFiles.some((file) => file.path === item.overlayPath) ? <button type="button" aria-label={`Customize ${item.label}`} onClick={() => onOpenFile({ name: item.overlayPath!.split("/").pop()!, path: item.overlayPath! })} className={`rounded px-2 py-1 text-xs text-bd-text-secondary hover:bg-bd-bg-hover ${focusStyle}`}>Customize</button> : null}
  </div>)}</div>;
}

function StorageDetails({ projectId }: { projectId: string }) {
  const folderPath = localPreviewFolder(projectId);
  const path = folderPath ?? `documents/${projectId}/`;
  const [notice, setNotice] = useState("");
  async function copyPath() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(path);
      setNotice(folderPath ? "Folder path copied." : "Relative path copied.");
    } catch {
      setNotice("Copy is unavailable in this browser. You can select the path above and copy it manually.");
    }
  }
  return <section aria-label="File location" className="border-t border-bd-border pt-5">
    <h2 className="mb-3 font-heading text-base text-bd-text-heading">File location</h2>
    <div className="space-y-3 text-sm leading-relaxed text-bd-text-secondary">
      <p>{folderPath ? "These files are saved on this computer. You can open the folder in Finder." : "These files are stored by BrainDrive. A folder path for this computer is not available here."}</p>
      {!folderPath ? <p>Path within BrainDrive storage</p> : null}
      <code className="block select-text break-all rounded-md bg-bd-bg-secondary p-3 text-bd-text-primary">{path}</code>
      <button type="button" onClick={() => void copyPath()} className={`flex min-h-11 items-center gap-2 rounded-md border border-bd-border px-3 py-2 text-bd-text-primary hover:bg-bd-bg-hover ${focusStyle}`}><Copy size={15} aria-hidden="true" />{folderPath ? "Copy folder path" : "Copy relative path"}</button>
      {folderPath ? <p>In Finder, choose <span className="text-bd-text-primary">Go &gt; Go to Folder…</span>, paste the folder path, then press Return.</p> : null}
      {notice ? <p role="status" className="text-xs">{notice}</p> : null}
    </div>
  </section>;
}

function ProjectTools({ projectId, onOpenApps }: { projectId: string; onOpenApps: () => void }) {
  const [skills, setSkills] = useState<Array<{ id: string; name: string; description: string }> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getProjectSkills(projectId), listSkills()]).then(([ids, catalog]) => {
      if (!cancelled) setSkills(ids.map((id) => {
        const skill = catalog.find((candidate) => candidate.id === id);
        return { id, name: skill?.name ?? id, description: skill?.description ?? "Assigned skill details are unavailable." };
      }));
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [projectId]);
  return <>
    <p className="text-sm text-bd-text-secondary">Tools for this page. Availability here does not grant access to other pages or accounts.</p>
    <ContentSection title="Skills">{error ? <p role="status" className="text-sm text-bd-text-secondary">Skill assignments could not be loaded.</p> : skills === null ? <p className="text-sm text-bd-text-secondary">Loading assigned skills…</p> : skills.length === 0 ? <p className="text-sm text-bd-text-secondary">No registered skills assigned to this page. Manual interview guidance is in Behavior.</p> : <ul className="space-y-3">{skills.map((skill) => <li key={skill.id}><p className="text-sm">{skill.name}</p><p className="text-sm text-bd-text-secondary">{skill.description}</p></li>)}</ul>}</ContentSection>
    <ContentSection title="Connections"><p className="text-sm leading-relaxed text-bd-text-secondary">Page connection permissions are not available in this prototype. Planned: connect an account once globally, then grant access separately to each page. No credentials are copied or permissions granted here.</p></ContentSection>
    <ContentSection title="Agents"><p className="text-sm text-bd-text-secondary">Page agent assignments are not available in this prototype.</p></ContentSection>
    <ContentSection title="Apps"><p className="mb-3 text-sm text-bd-text-secondary">Page-specific app assignments are not available yet. The global catalog remains available; opening it does not assign an app to this page.</p><button type="button" onClick={onOpenApps} className="rounded-md border border-bd-border px-4 py-2 text-sm hover:bg-bd-bg-hover">Open global app catalog</button></ContentSection>
  </>;
}
