import { useRef, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";

import {
  AI_NOTICE, applyInstall, cancelInstall, startBuild, startInstallStep, submitPluginFile, uniquePageName,
  type HostEvent, type PageSetup, type PluginReview,
} from "@/api/experts";
import { expertButton } from "./expert-ui";

const primary = "bg-bd-amber text-bd-bg-primary hover:bg-bd-amber-hover";

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
    </dl>
    {isExpert ? <p className="mt-3">These instructions will become this page's instructions.</p> : null}
    {review.warnings.map((warning) => <p key={warning} className="mt-2 text-bd-amber">Warning: {warning}</p>)}
    <p className="mt-3 text-bd-text-secondary">Reading does not run anything. The AI has not seen this package.</p>
    <button type="button" aria-expanded={showFiles} onClick={() => setShowFiles((open) => !open)} className={`${expertButton} mt-3`}>{showFiles ? "Hide files" : "See every file"}</button>
    {showFiles ? <div className="mt-3 space-y-3">{Object.entries(review.files).map(([name, text]) => <div key={name}><p className="break-all text-xs font-semibold text-bd-text-heading">{name}</p><pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-bd-bg-primary p-3 text-xs leading-relaxed">{text}</pre></div>)}</div> : null}
    {status === "pending" ? <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={onInstall} className={`${expertButton} ${primary}`}>{busy ? "Installing…" : "Install"}</button>
      <button type="button" disabled={busy} onClick={onCancel} className={expertButton}>Cancel</button>
    </div> : <p role="status" className="mt-4 text-bd-text-secondary">{status === "installed" ? "Installed." : "Cancelled. Nothing was installed."}</p>}
  </Card>;
}

export default function PageHostMessages({ project, setup, takenNames, renamePage }: {
  project: { id: string; name: string }; setup: PageSetup | undefined; takenNames: string[]; renamePage: (id: string, name: string) => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
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
          <button type="button" className={`${expertButton} ${primary}`} onClick={() => startBuild(project.id)}>Create an Expert</button>
          <button type="button" className={expertButton} onClick={() => startInstallStep(project.id, "expert")}>Install an Expert</button>
        </div>
        <p className="mt-2 text-xs text-bd-text-secondary">Create builds a new Expert by talking it through, and can use what's already in your BrainDrive.</p>
      </Card>;
      case "build": return <Card key={event.id}>
        <p>{event.typed ? "Got it. Let me ask a couple of questions to shape this Expert." : "Let's create your Expert. Its starting instructions are in this page's Settings. Tell me about what you want it to help with."}</p>
      </Card>;
      case "install-help": {
        const active = setup.installStep !== null && event.id === lastHelpId;
        return <Card key={event.id}>
          <p>{event.mode === "expert" ? "There are three ways to install an Expert." : "There are three ways to add a plugin."}</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>From the community forum (community.braindrive.ai): download the file from the post, then choose or drop it here.</li>
            <li>From a plugin file: choose or drop it here.</li>
            <li>From a GitHub link: coming later.</li>
          </ol>
          {active ? <div className="mt-3">
            <input ref={fileInput} type="file" aria-label="Plugin file" accept=".zip,application/zip" className="sr-only" tabIndex={-1} onChange={(change) => { const file = change.target.files?.[0]; change.target.value = ""; if (file) void submitPluginFile(project.id, file.name); }} />
            <button type="button" className={`${expertButton} ${primary}`} onClick={() => fileInput.current?.click()}>Choose plugin file</button>
            <p className="mt-2 text-xs text-bd-text-secondary">Or drop the file anywhere in this conversation. BrainDrive checks it first.</p>
          </div> : null}
        </Card>;
      }
      case "refused": return <Card key={event.id}><p role="alert">{event.reason}</p></Card>;
      case "review": return <ReviewCard key={event.id} review={event.review} status={event.status} busy={busy} onInstall={() => void install(event)} onCancel={() => cancelInstall(project.id, event.id)} />;
      case "result": return <Card key={event.id}><p>{event.text}</p></Card>;
      case "notice": return <Card key={event.id} label="From BrainDrive: about AI"><p>{AI_NOTICE}</p></Card>;
    }
  })}{error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}</>;
}
