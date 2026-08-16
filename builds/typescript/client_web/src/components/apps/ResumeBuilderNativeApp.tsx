import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, MessageSquare, Pencil, Save, Settings2, Sparkles } from "lucide-react";

import { authenticatedFetch } from "@/api/auth-adapter";
import { GATEWAY_BASE_URL } from "@/api/gateway-adapter";
import ChatPanel from "@/components/chat/ChatPanel";

type ResumeDocument = "agent" | "interview" | "profile" | "resume";
type ResumeView = "chat" | ResumeDocument;

type ResumeBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] };

function resumeBlocks(markdown: string): ResumeBlock[] {
  const blocks: ResumeBlock[] = [];
  let bullets: string[] = [];
  const flushBullets = () => { if (bullets.length > 0) { blocks.push({ kind: "bullets", items: bullets }); bullets = []; } };

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line || line === "---") { flushBullets(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushBullets();
      blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, text: heading[2]!.replace(/\*\*/g, "") });
      continue;
    }
    const bullet = line.match(/^-\s+(.+)$/);
    if (bullet) { bullets.push(bullet[1]!.replace(/\*\*/g, "")); continue; }
    flushBullets();
    blocks.push({ kind: "paragraph", text: line.replace(/\*\*/g, "") });
  }
  flushBullets();
  return blocks;
}

function ResumePreview({ content }: { content: string }) {
  const blocks = resumeBlocks(content);
  if (blocks.length === 0) return <p className="mt-5 text-sm text-bd-text-muted">Loading…</p>;
  return <article className="mt-6 rounded-sm bg-white px-7 py-8 text-slate-900 shadow-sm sm:px-12" aria-label="Rendered resume preview">
    {blocks.map((block, index) => {
      const key = `${block.kind}-${index}`;
      if (block.kind === "heading" && block.level === 1) return <h2 key={key} className="font-heading text-3xl font-semibold tracking-tight text-slate-950">{block.text}</h2>;
      if (block.kind === "heading" && block.level === 2) return <h3 key={key} className="mt-7 border-b border-slate-300 pb-1 text-xs font-bold uppercase tracking-[0.16em] text-slate-700">{block.text}</h3>;
      if (block.kind === "heading") return <h4 key={key} className="mt-4 text-sm font-semibold text-slate-900">{block.text}</h4>;
      if (block.kind === "bullets") return <ul key={key} className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">{block.items.map((item, itemIndex) => <li key={`${key}-${itemIndex}`}>{item}</li>)}</ul>;
      return <p key={key} className="mt-2 text-sm leading-6 text-slate-700">{block.text}</p>;
    })}
  </article>;
}

async function readWorkspaceDocument(document: ResumeDocument): Promise<string> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/apps/resume-builder/workspace/${document}`);
  if (!response.ok) throw new Error("Could not load this Resume Builder document.");
  return ((await response.json()) as { content: string }).content;
}

async function updateWorkspaceDocument(document: Exclude<ResumeDocument, "resume">, content: string): Promise<void> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/apps/resume-builder/workspace/${document}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }),
  });
  if (!response.ok) throw new Error("Could not save this Resume Builder document.");
}

async function renderResume(): Promise<string> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/apps/resume-builder/workspace/render`, { method: "POST" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Could not create the resume.");
  }
  return ((await response.json()) as { content: string }).content;
}

export default function ResumeBuilderNativeApp({ onClose, onOpenSettings }: { onClose: () => void; onOpenSettings?: () => void }) {
  const [view, setView] = useState<ResumeView>("chat");
  const [conversationId, setConversationId] = useState<string | null>(() => window.localStorage.getItem("resume-builder-conversation-id"));
  const [documentContent, setDocumentContent] = useState<string>("");
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftContent, setDraftContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const showDocument = useCallback(async (next: ResumeDocument) => {
    setView(next); setDocumentError(null); setDocumentContent(""); setIsEditing(false);
    try { setDocumentContent(await readWorkspaceDocument(next)); }
    catch (error) { setDocumentError(error instanceof Error ? error.message : "Could not load this document."); }
  }, []);

  useEffect(() => { if (view === "chat") return; void showDocument(view); }, [showDocument, view]);

  const completeConversation = useCallback((nextId: string) => {
    setConversationId(nextId);
    window.localStorage.setItem("resume-builder-conversation-id", nextId);
  }, []);

  const createResume = async () => {
    setIsRendering(true); setDocumentError(null);
    try { setDocumentContent(await renderResume()); setView("resume"); }
    catch (error) { setDocumentError(error instanceof Error ? error.message : "Could not create the resume."); }
    finally { setIsRendering(false); }
  };

  const saveDocument = async () => {
    if (view === "chat" || view === "resume") return;
    setIsSaving(true); setDocumentError(null);
    try { await updateWorkspaceDocument(view, draftContent); setDocumentContent(draftContent); setIsEditing(false); }
    catch (error) { setDocumentError(error instanceof Error ? error.message : "Could not save this document."); }
    finally { setIsSaving(false); }
  };

  const selectView = (next: ResumeView) => {
    if (next === "chat") { setView("chat"); setIsEditing(false); return; }
    void showDocument(next);
  };

  const Navigation = () => <aside className="w-56 shrink-0 border-r border-bd-border bg-bd-bg-secondary px-3 py-4" aria-label="Resume Builder workspace">
    <button type="button" onClick={onClose} className="mb-4 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-bd-text-secondary hover:bg-bd-bg-hover"><ArrowLeft size={15} />Back to Apps</button>
    <p className="px-2 text-xs font-medium uppercase tracking-[0.14em] text-bd-text-muted">Resume Builder</p>
    <div className="mt-2 space-y-1">
      <button type="button" onClick={() => selectView("chat")} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${view === "chat" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><MessageSquare size={15} />Conversation</button>
      <button type="button" onClick={() => selectView("profile")} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${view === "profile" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><Sparkles size={15} />Your Resume Profile</button>
      <button type="button" onClick={() => selectView("resume")} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${view === "resume" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><FileText size={15} />Your Resume</button>
    </div>
    <button type="button" onClick={() => setIsAdvancedOpen((value) => !value)} className="mt-5 flex w-full items-center justify-between rounded-md px-2 py-2 text-xs text-bd-text-muted hover:bg-bd-bg-hover"><span>{isAdvancedOpen ? "Hide advanced" : "Show advanced"}</span><Settings2 size={14} /></button>
    {isAdvancedOpen ? <div className="space-y-1 border-l border-bd-border pl-2"><p className="px-2 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-bd-text-muted">Advanced</p>
      <button type="button" onClick={() => selectView("agent")} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${view === "agent" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><FileText size={14} />Agent Instructions</button>
      <button type="button" onClick={() => selectView("interview")} className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${view === "interview" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><FileText size={14} />Interview Guide</button>
    </div> : null}
  </aside>;

  return <div className="flex min-h-0 flex-1 flex-col bg-bd-bg-chat" data-testid="resume-builder-native-app">
    <header className="flex items-center border-b border-bd-border bg-bd-bg-secondary px-4 py-3 sm:px-6">
      <div><p className="text-xs uppercase tracking-[0.14em] text-bd-text-muted">BrainDrive</p><h1 className="font-heading text-base font-semibold text-bd-text-heading">Resume Builder</h1></div>
    </header>
    <div className="flex min-h-0 flex-1 overflow-hidden"><Navigation />
    {view === "chat" ? <ChatPanel activeConversationId={conversationId} draftKey="resume-builder" isEmpty={conversationId === null} introProjectId="resume-builder" messageMetadata={{ resume_builder: true }} onConversationComplete={completeConversation} onOpenSettings={onOpenSettings} /> : <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8"><div className="mx-auto max-w-3xl rounded-xl border border-bd-border bg-bd-bg-secondary p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-xl font-semibold text-bd-text-heading">{view === "agent" ? "Agent Instructions" : view === "interview" ? "Interview Guide" : view === "profile" ? "Your Resume Profile" : "Your Resume"}</h2>{view === "resume" ? <p className="mt-1 text-sm text-bd-text-muted">Rendered from Your Resume Profile. Edit the profile to change the source.</p> : null}</div><div className="flex items-center gap-2">{view === "profile" ? <button type="button" onClick={() => void createResume()} disabled={isRendering} className="rounded-md bg-bd-amber px-3 py-2 text-sm font-medium text-bd-bg-primary disabled:opacity-60">{isRendering ? "Creating resume…" : "Create resume"}</button> : null}{view !== "resume" ? <button type="button" onClick={() => { setDraftContent(documentContent); setIsEditing(true); }} className="rounded-md border border-bd-border px-3 py-2 text-sm text-bd-text-secondary hover:bg-bd-bg-hover"><Pencil className="mr-1 inline" size={14} />Edit</button> : null}</div></div>{documentError ? <p className="mt-4 text-sm text-bd-danger">{documentError}</p> : isEditing ? <><textarea aria-label={`Edit ${view}`} value={draftContent} onChange={(event) => setDraftContent(event.target.value)} className="mt-5 min-h-96 w-full rounded-md border border-bd-border bg-bd-bg-primary p-3 font-mono text-sm leading-6 text-bd-text-primary focus:border-bd-amber focus:outline-none" /><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setIsEditing(false)} className="rounded-md px-3 py-2 text-sm text-bd-text-secondary hover:bg-bd-bg-hover">Cancel</button><button type="button" onClick={() => void saveDocument()} disabled={isSaving} className="rounded-md bg-bd-amber px-3 py-2 text-sm font-medium text-bd-bg-primary disabled:opacity-60"><Save className="mr-1 inline" size={14} />{isSaving ? "Saving…" : "Save changes"}</button></div></> : view === "resume" ? <ResumePreview content={documentContent} /> : <pre className="mt-5 whitespace-pre-wrap font-sans text-sm leading-6 text-bd-text-primary">{documentContent || "Loading…"}</pre>}</div></main>}</div>
  </div>;
}
