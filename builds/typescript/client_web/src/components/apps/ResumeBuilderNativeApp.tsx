import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, FileText, MessageSquare, Sparkles } from "lucide-react";

import { authenticatedFetch } from "@/api/auth-adapter";
import { GATEWAY_BASE_URL } from "@/api/gateway-adapter";
import ChatPanel from "@/components/chat/ChatPanel";

type ResumeView = "chat" | "profile" | "resume";

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

async function readWorkspaceDocument(document: "profile" | "resume"): Promise<string> {
  const response = await authenticatedFetch(`${GATEWAY_BASE_URL}/apps/resume-builder/workspace/${document}`);
  if (!response.ok) throw new Error("Could not load this Resume Builder document.");
  return ((await response.json()) as { content: string }).content;
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

  const showDocument = useCallback(async (next: "profile" | "resume") => {
    setView(next); setDocumentError(null); setDocumentContent("");
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

  return <div className="flex min-h-0 flex-1 flex-col bg-bd-bg-chat" data-testid="resume-builder-native-app">
    <header className="flex items-center justify-between border-b border-bd-border bg-bd-bg-secondary px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3"><button type="button" onClick={onClose} aria-label="Back to Apps" className="rounded-md p-2 text-bd-text-secondary hover:bg-bd-bg-hover"><ArrowLeft size={18} /></button><div><p className="text-xs uppercase tracking-[0.14em] text-bd-text-muted">BrainDrive</p><h1 className="font-heading text-base font-semibold text-bd-text-heading">Resume Builder</h1></div></div>
      <nav className="flex items-center gap-1" aria-label="Resume Builder sections">
        <button type="button" onClick={() => setView("chat")} className={`rounded-md px-3 py-2 text-sm ${view === "chat" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><MessageSquare className="mr-1 inline" size={15} />Conversation</button>
        <button type="button" onClick={() => void showDocument("profile")} className={`rounded-md px-3 py-2 text-sm ${view === "profile" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><Sparkles className="mr-1 inline" size={15} />Resume Profile</button>
        <button type="button" onClick={() => void showDocument("resume")} className={`rounded-md px-3 py-2 text-sm ${view === "resume" ? "bg-bd-bg-hover text-bd-text-heading" : "text-bd-text-secondary hover:bg-bd-bg-hover"}`}><FileText className="mr-1 inline" size={15} />Resume</button>
      </nav>
    </header>
    {view === "chat" ? <ChatPanel activeConversationId={conversationId} draftKey="resume-builder" isEmpty={conversationId === null} introProjectId="resume-builder" messageMetadata={{ resume_builder: true }} onConversationComplete={completeConversation} onOpenSettings={onOpenSettings} /> : <main className="min-h-0 flex-1 overflow-y-auto px-6 py-8"><div className="mx-auto max-w-3xl rounded-xl border border-bd-border bg-bd-bg-secondary p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-heading text-xl font-semibold text-bd-text-heading">{view === "profile" ? "Resume Profile" : "Resume"}</h2>{view === "profile" ? <button type="button" onClick={() => void createResume()} disabled={isRendering} className="rounded-md bg-bd-amber px-3 py-2 text-sm font-medium text-bd-bg-primary disabled:opacity-60">{isRendering ? "Creating resume…" : "Create resume"}</button> : null}</div>{documentError ? <p className="mt-4 text-sm text-bd-danger">{documentError}</p> : view === "resume" ? <ResumePreview content={documentContent} /> : <pre className="mt-5 whitespace-pre-wrap font-sans text-sm leading-6 text-bd-text-primary">{documentContent || "Loading…"}</pre>}</div></main>}
  </div>;
}
