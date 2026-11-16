import { useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import {
  AI_NOTICE, applyInstall, cancelInstall, chooseInstallRoute, startBuild, startInstallStep, submitPluginFile, uniquePageName,
  type HostEvent, type InstallRoute, type PageSetup, type PluginReview,
} from "@/api/experts";
import { expertButton, expertPrimaryButton } from "./expert-ui";


// BrainDrive-drawn messages (spec I8): fixed text rendered by BrainDrive's own code, framed and
// labelled so they cannot be mistaken for an AI reply. Nothing here comes from the model.
function Card({ label = "From BrainDrive", children, tone = "plain" }: { label?: string; children: ReactNode; tone?: "plain" | "review" }) {
  return <section aria-label={label} className={`rounded-xl border px-4 py-4 text-sm leading-relaxed ${tone === "review" ? "border-bd-amber/60 bg-bd-bg-secondary" : "border-bd-border bg-bd-bg-secondary"}`}>
    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-bd-amber"><ShieldCheck size={14} aria-hidden="true" />{label}</p>
    {children}
  </section>;
}

export function ReviewCard({ review, status, busy, onInstall, onCancel }: { review: PluginReview; status: "pending" | "installed" | "cancelled"; busy: boolean; onInstall: () => void; onCancel: () => void }) {
  const [showFiles, setShowFiles] = useState(false);
  const isExpert = review.kind === "expert";
  return <Card label="From BrainDrive: review before installing" tone="review">
    <h2 className="font-heading text-lg text-bd-text-heading">{review.name}</h2>
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt className="text-bd-text-secondary">Creator</dt><dd>{review.creator}</dd>
      <dt className="text-bd-text-secondary">License</dt><dd>{review.license}</dd>
      <dt className="text-bd-text-secondary">What it adds</dt><dd>{review.adds}</dd>
      <dt className="text-bd-text-secondary">Page</dt><dd>{isExpert ? `This page will be set up as ${review.name}.` : "This page only."}</dd>
      {review.route ? <><dt className="text-bd-text-secondary">Source</dt><dd>{review.route === "forum" ? "The BrainDrive forum, as you chose. BrainDrive cannot confirm where a file came from." : "Somewhere else. Not reviewed by BrainDrive."}</dd></> : null}
    </dl>
    {review.route === "elsewhere" ? <p className="mt-3 text-bd-amber">Warning: BrainDrive has not reviewed this. It can read all of Your Memory and shape what the AI tells you. Install it only if you trust who made it.</p> : null}
    {isExpert ? <p className="mt-3">These instructions will become this page's instructions.</p> : null}
    {review.warnings.map((warning) => <p key={warning} className="mt-2 text-bd-amber">Warning: {warning}</p>)}
    <p className="mt-3 text-bd-text-secondary">Reading does not run anything. The AI has not seen this package.</p>
    <button type="button" aria-expanded={showFiles} onClick={() => setShowFiles((open) => !open)} className={`${expertButton} mt-3`}>{showFiles ? "Hide files" : "See every file"}</button>
    {showFiles ? <div className="mt-3 space-y-3">{Object.entries(review.files).map(([name, text]) => <div key={name}><p className="break-all text-xs font-semibold text-bd-text-heading">{name}</p><pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-bd-bg-primary p-3 text-xs leading-relaxed">{text}</pre></div>)}</div> : null}
    {status === "pending" ? <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={onInstall} className={expertPrimaryButton}>{busy ? "Installing…" : "Install"}</button>
      <button type="button" disabled={busy} onClick={onCancel} className={expertButton}>Cancel</button>
    </div> : <p role="status" className="mt-4 text-bd-text-secondary">{status === "installed" ? "Installed." : "Cancelled. Nothing was installed."}</p>}
  </Card>;
}

// The install step. The forum is the main way: files there have been reviewed by the BrainDrive team.
// A file from anywhere else (GitHub included) is a second, smaller option behind a plain warning and
// an "at my own risk" tick. BrainDrive cannot check where a file came from, so the owner says which.
function InstallHelp({ mode, projectId, active }: { mode: "expert" | "plugin"; projectId: string; active: boolean }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const route = useRef<InstallRoute>("forum");
  const [elsewhereOpen, setElsewhereOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const thing = mode === "expert" ? "Expert" : "plugin";
  function choose(from: InstallRoute) {
    route.current = from;
    chooseInstallRoute(projectId, from);
    fileInput.current?.click();
  }
  return <Card>
    <p>{mode === "expert" ? "Install an Expert from the BrainDrive community forum." : "Add a plugin from the BrainDrive community forum."}</p>
    <p className="mt-2 text-bd-text-secondary">{thing}s posted on the forum (community.braindrive.ai) have been reviewed by the BrainDrive team. Download the file from the post, then choose it here.</p>
    {active ? <div className="mt-3">
      <input ref={fileInput} type="file" aria-label="Plugin file" accept=".zip,application/zip" className="sr-only" tabIndex={-1} onChange={(change) => { const file = change.target.files?.[0]; change.target.value = ""; if (file) void submitPluginFile(projectId, file.name, route.current); }} />
      <button type="button" className={expertPrimaryButton} onClick={() => choose("forum")}>Choose file from the forum</button>
      <p className="mt-2 text-xs text-bd-text-secondary">BrainDrive checks the file first.</p>
      <button type="button" aria-expanded={elsewhereOpen} onClick={() => setElsewhereOpen((open) => !open)} className="mt-4 text-xs text-bd-text-secondary underline underline-offset-2 hover:text-bd-text-primary">Install from somewhere else</button>
      {elsewhereOpen ? <div role="group" aria-label="Install from somewhere else" className="mt-2 rounded-lg border border-bd-amber/60 p-3">
        <p className="text-bd-amber">BrainDrive has not reviewed files from anywhere else, including GitHub.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>It can read all of Your Memory.</li>
          <li>It can shape what the AI tells you, and may try to get you to open a link or share a file.</li>
          <li>Only install it if you trust who made it.</li>
        </ul>
        <label className="mt-3 flex min-h-11 items-center gap-2"><input type="checkbox" checked={accepted} onChange={(change) => { setAccepted(change.target.checked); if (!change.target.checked) chooseInstallRoute(projectId, null); }} />I understand. Install at my own risk.</label>
        <button type="button" disabled={!accepted} className={`${expertButton} mt-2 disabled:opacity-50`} onClick={() => choose("elsewhere")}>Choose plugin file</button>
        <p className="mt-2 text-xs text-bd-text-secondary">BrainDrive still checks the file and shows you everything in it before anything is installed.</p>
      </div> : null}
    </div> : null}
  </Card>;
}

export default function PageHostMessages({ project, setup, takenNames, renamePage }: {
  project: { id: string; name: string }; setup: PageSetup | undefined; takenNames: string[]; renamePage: (id: string, name: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!setup || setup.events.length === 0) return null;
  const lastHelpId = [...setup.events].reverse().find((event) => event.type === "install-help")?.id;

  async function install(event: Extract<HostEvent, { type: "review" }>) {
    setBusy(true); setError("");
    try {
      const finalName = event.review.kind === "expert" ? uniquePageName(event.review.name, takenNames) : project.name;
      if (event.review.kind === "expert") await renamePage(project.id, finalName);
      applyInstall(project.id, event.id, finalName);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The install did not finish. Nothing was changed.");
    } finally { setBusy(false); }
  }

  return <>{setup.events.map((event) => {
    switch (event.type) {
      case "choose": return <Card key={event.id}>
        <p>Do you want to create an Expert for this page, or install one?</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={expertPrimaryButton} onClick={() => startBuild(project.id)}>Create an Expert</button>
          <button type="button" className={expertButton} onClick={() => startInstallStep(project.id, "expert")}>Install an Expert</button>
        </div>
        <p className="mt-2 text-xs text-bd-text-secondary">Create builds a new Expert by talking it through, and can use what's already in your BrainDrive.</p>
      </Card>;
      case "build": return <Card key={event.id}>
        <p>{event.typed ? "Got it. Let me ask a couple of questions to shape this Expert." : "Let's create your Expert. Its starting instructions are in this page's Settings. Tell me about what you want it to help with."}</p>
      </Card>;
      case "install-help": return <InstallHelp key={event.id} mode={event.mode} projectId={project.id} active={setup.installStep !== null && event.id === lastHelpId} />;
      case "refused": return <Card key={event.id}><p role="alert">{event.reason}</p></Card>;
      case "review": return <ReviewCard key={event.id} review={event.review} status={event.status} busy={busy} onInstall={() => void install(event)} onCancel={() => cancelInstall(project.id, event.id)} />;
      case "result": return <Card key={event.id}><p>{event.text}</p></Card>;
      case "notice": return <Card key={event.id} label="From BrainDrive: about AI"><p>{AI_NOTICE}</p></Card>;
    }
  })}{error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}</>;
}
