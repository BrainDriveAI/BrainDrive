import { useState } from "react";
import { cn } from "@/lib/utils";
import { Dialog } from "radix-ui";
import { MessageSquarePlus, PackageOpen, X } from "lucide-react";
import { STARTER_SOURCE, createExpert, installExpert, reviewExpert, type ExpertReview } from "@/api/experts";

export const expertButton = "min-h-11 rounded-lg border border-bd-border px-4 py-2 text-sm text-bd-text-primary hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber disabled:opacity-50";
export function ExpertDialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-[680px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl border border-bd-border bg-bd-bg-primary p-5 text-bd-text-primary shadow-xl sm:p-7">
      <div className="flex items-start justify-between gap-3"><Dialog.Title className="font-heading text-xl text-bd-text-heading">{title}</Dialog.Title><Dialog.Close aria-label="Close" className={expertButton}><X size={18} /></Dialog.Close></div>
      <Dialog.Description className="mt-2 pr-5 text-sm leading-relaxed text-bd-text-secondary">{description}</Dialog.Description>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export default function AddExpert({ onClose, onOpenExpert }: { onClose: () => void; onOpenExpert: (id: string) => void }) {
  const [installing, setInstalling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<ExpertReview | null>(null);
  const [bundledSource, setBundledSource] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "The request failed. Try again."); }
    finally { setBusy(false); }
  };
  return <ExpertDialog title={installing ? "Install Expert" : "Add Expert"} description={installing ? "Choose a starter Expert or a downloaded package. Review its contents before adding it to your BrainDrive." : "Shape an Expert around what you need, or bring one with you."} onClose={() => { if (!busy) onClose(); }}>
    {!installing ? <div className="mt-6 divide-y divide-bd-border rounded-lg border border-bd-border">
      <button disabled={busy} className="flex min-h-24 w-full items-center gap-4 rounded-t-lg p-5 text-left hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber" onClick={() => { void run(async () => onOpenExpert((await createExpert()).id)); }}><MessageSquarePlus size={22} className="shrink-0 text-bd-amber" /><span><span className="block text-base text-bd-text-heading">Create your own</span><span className="mt-1 block text-sm text-bd-text-secondary">Open a new Expert and shape it through conversation.</span></span></button>
      <button disabled={busy} className="flex min-h-24 w-full items-center gap-4 rounded-b-lg p-5 text-left hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber" onClick={() => setInstalling(true)}><PackageOpen size={22} className="shrink-0 text-bd-text-secondary" /><span><span className="block text-base text-bd-text-heading">Install Expert</span><span className="mt-1 block text-sm text-bd-text-secondary">Choose a starter or import a downloaded package.</span></span></button>
    </div> : <div className="mt-5 space-y-5">
      <label className="block text-sm text-bd-text-heading">Import a downloaded ZIP<input aria-label="Expert package (.zip)" disabled={busy} type="file" accept=".zip,application/zip" className="mt-2 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-bd-border file:bg-bd-bg-secondary file:px-3 file:text-bd-text-primary" onChange={(event) => {
        const file = event.target.files?.[0]; setReview(null); setAcknowledged(false); setBundledSource(false);
        if (file) void run(async () => { setReview(await reviewExpert(file.name)); });
      }} /></label>
      {!review ? <div className="rounded-lg border border-bd-border p-4 text-sm"><p className="text-bd-text-heading">Try Start a Business</p><p className="mt-1 text-bd-text-secondary">Explore an idea or find one, then keep an editable brief and a next learning test.</p><button disabled={busy} className={cn(expertButton, "mt-3 mr-2 bg-bd-amber text-bd-bg-primary hover:bg-bd-amber-hover")} onClick={() => { setAcknowledged(false); void run(async () => { setReview(null); setBundledSource(true); setReview(await reviewExpert(STARTER_SOURCE)); }); }}>Install Start a Business</button></div> : <>
        <section className="space-y-3 text-sm"><h2 className="font-heading text-lg text-bd-text-heading">{review.manifest.name}</h2><p>{review.manifest.description}</p><dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2"><dt>Version</dt><dd>{review.manifest.version}</dd><dt>File</dt><dd className="break-all">{review.source}</dd><dt>Creator</dt><dd>{review.manifest.creator} (not checked)</dd><dt>Source origin</dt><dd>{bundledSource ? "Included with BrainDrive." : "A file you chose. Its author is not checked."}</dd><dt>Licence</dt><dd>{review.manifest.licence}. See LICENSE.txt below.</dd><dt>Destination</dt><dd>New page: {review.manifest.name}</dd></dl><p className="text-bd-text-secondary">{review.verification}</p><details><summary className="cursor-pointer py-2">Fingerprint</summary><p className="break-all text-xs">{review.digest}</p></details></section>
        <section><h3 className="text-sm font-semibold text-bd-text-heading">Contents ({Object.keys(review.files).length} files)</h3><p className="my-2 text-sm text-bd-text-secondary">Open a file to read it. Reading does not run anything.</p><div className="max-h-64 overflow-y-auto rounded-lg border border-bd-border">{Object.entries(review.files).map(([name, content]) => <details key={name} className="border-b border-bd-border px-3 last:border-0"><summary className="cursor-pointer break-all py-3 text-sm">{name}</summary><pre className="whitespace-pre-wrap break-words pb-4 text-xs leading-relaxed">{content}</pre></details>)}</div></section>
        <section className="space-y-3 text-sm"><h3 className="font-semibold text-bd-text-heading">Access and limits</h3><p>{review.permissions}</p><p className="text-bd-text-secondary">Adding an Expert does not start a conversation. Using it later uses your chosen model and may cost what that model normally costs.</p></section>
        {review.conflicts.length ? <div role="alert" className="text-sm text-red-300">{review.conflicts.join(" ")}</div> : <label className="flex min-h-11 items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />I looked through the files and want to add this Expert.</label>}
        {review.existingProjectId ? <button className={`${expertButton} w-full`} disabled={busy} onClick={() => onOpenExpert(review.existingProjectId!)}>Open existing Expert</button> : null}
        <button disabled={busy || !acknowledged || review.conflicts.length > 0} className={cn(expertButton, "w-full bg-bd-amber text-bd-bg-primary hover:bg-bd-amber-hover")} onClick={() => { void run(async () => onOpenExpert((await installExpert(review)).projectId)); }}>Install Expert</button>
      </>}
    </div>}
    {busy ? <p role="status" className="mt-4 text-sm">{review ? "Installing…" : "Preparing…"}</p> : null}
    {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
  </ExpertDialog>;
}
