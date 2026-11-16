import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Info, ShieldCheck } from "lucide-react";

import {
  AI_NOTICE, MEMORY_NOTICE, applyInstall, claimsBrainDriveFalsely, applyInstructionChange, keepInstructions, cancelExport, cancelInstall, cancelInstallStep, chooseInstallRoute, exportFileList, fileFingerprint, pluginSlug, reviewInstructions, reviewSkills, saveExport, startBuild, startInstallStep, submitPluginFile, uniquePageName,
  type ExportChoices, type ExportDraft, type HostEvent, type InstallRoute, type PageSetup, type PluginReview,
} from "@/api/experts";
import { downloadPluginZip } from "@/prototype/pluginZip";
import { expertButton, expertPrimaryButton } from "./expert-ui";


// BrainDrive-drawn messages (spec I8): fixed text rendered by BrainDrive's own code, framed and
// labelled so they cannot be mistaken for an AI reply. Nothing here comes from the model.
function Card({ label = "From BrainDrive", children, tone = "plain" }: { label?: string; children: ReactNode; tone?: "plain" | "review" }) {
  return <section aria-label={label} className={`rounded-xl border px-4 py-4 text-sm leading-relaxed ${tone === "review" ? "border-bd-amber/60 bg-bd-bg-secondary" : "border-bd-border bg-bd-bg-secondary"}`}>
    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-bd-amber"><ShieldCheck size={14} aria-hidden="true" />{label}</p>
    {children}
  </section>;
}

const FINGERPRINT_CHECK = "If you got this file from the forum, check that these first 12 characters match the fingerprint in the post. If they don't, don't install it.";

function Fingerprint({ value, checkHint }: { value?: string; checkHint?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <>Not available. BrainDrive could not read this file.</>;
  async function copy() {
    try { await navigator.clipboard.writeText(value!); setCopied(true); } catch { setCopied(false); }
  }
  return <div>
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono font-semibold">{value.slice(0, 12)}</span>
      <button type="button" onClick={() => void copy()} className="rounded-md border border-bd-border px-2 py-0.5 text-xs hover:bg-bd-bg-hover">{copied ? "Copied" : "Copy"}</button>
    </div>
    <p className="mt-1 break-all font-mono text-xs text-bd-text-secondary">{value}</p>
    {checkHint ? <p className="mt-1 text-xs text-bd-text-secondary">{checkHint}</p> : null}
  </div>;
}

export function ReviewCard({ review, status, busy, onInstall, onCancel }: { review: PluginReview; status: "pending" | "installed" | "cancelled"; busy: boolean; onInstall: () => void; onCancel: () => void }) {
  const [showFiles, setShowFiles] = useState(false);
  const instructions = reviewInstructions(review.files);
  const skills = reviewSkills(review.files);
  return <Card label="From BrainDrive: review before installing" tone="review">
    <h2 className="font-heading text-lg text-bd-text-heading">{review.name}</h2>
    <p className="mt-1">{review.adds}</p>
    <section aria-label="Instructions" className="mt-3">
      <p className="font-semibold text-bd-text-heading">These instructions will guide this page's Expert.</p>
      <pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-bd-bg-primary p-3 text-xs leading-relaxed">{instructions || "(This package has no instructions file.)"}</pre>
    </section>
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      <dt className="text-bd-text-secondary">Creator</dt><dd>{review.creator && review.creator !== "unknown" ? `The file says it's by ${review.creator}. BrainDrive can't check this.` : "The file doesn't say who made it."}</dd>
      <dt className="text-bd-text-secondary">License</dt><dd>{review.license}</dd>
      <dt className="text-bd-text-secondary">Fingerprint</dt><dd><Fingerprint value={review.fingerprint} checkHint={FINGERPRINT_CHECK} /></dd>
      <dt className="text-bd-text-secondary">Skills</dt><dd>{skills.length ? <ul className="space-y-1">{skills.map((skill) => <li key={skill.name}><span className="font-semibold">{skill.name}</span>{skill.description ? `: ${skill.description}` : ""}</li>)}</ul> : "None"}</dd>
      {review.route ? <><dt className="text-bd-text-secondary">Source</dt><dd>{review.route === "forum" ? "The BrainDrive forum, as you chose. BrainDrive cannot confirm where a file came from." : "Somewhere else. Not reviewed by BrainDrive."}</dd></> : null}
    </dl>
    <p className="mt-3">{MEMORY_NOTICE}</p>
    {claimsBrainDriveFalsely(review) ? <p role="alert" className="mt-3 font-semibold text-bd-amber">Warning: this file says it's by BrainDrive, but it isn't one of the Experts BrainDrive made. Someone may be using BrainDrive's name. Don't install it.</p> : null}
    {review.route === "elsewhere" ? <p className="mt-3 text-bd-amber">Warning: BrainDrive has not reviewed this. Install it only if you trust who made it.</p> : null}
    {review.warnings.map((warning) => <p key={warning} className="mt-2 text-bd-amber">Warning: {warning}</p>)}
    <p className="mt-3">{`Installing sets this page up as ${review.name} and renames it to that name (numbered if the name is taken).`}</p>
    <p className="mt-3 text-bd-text-secondary">Reading does not run anything. The AI has not seen this package.</p>
    <button type="button" aria-expanded={showFiles} onClick={() => setShowFiles((open) => !open)} className={`${expertButton} mt-3`}>{showFiles ? "Hide files" : "See every file"}</button>
    {showFiles ? <div className="mt-3 space-y-3">{Object.entries(review.files).map(([name, text]) => <div key={name}><p className="break-all text-xs font-semibold text-bd-text-heading">{name}</p><pre className="mt-1 whitespace-pre-wrap break-words rounded-md bg-bd-bg-primary p-3 text-xs leading-relaxed">{text}</pre></div>)}</div> : null}
    {status === "pending" ? <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={onInstall} className={expertPrimaryButton}>{busy ? "Installing…" : "Install"}</button>
      <button type="button" disabled={busy} onClick={onCancel} className={expertButton}>Cancel</button>
    </div> : <p role="status" className="mt-4 text-bd-text-secondary">{status === "installed" ? "Installed." : "Cancelled. Nothing was installed."}</p>}
  </Card>;
}

// The confirm card for a change to the Expert's own instructions (AC-2.5, AC-7.14). BrainDrive draws it
// from the proposed change, never from model text, and shows the exact wording in plain text. Only a
// press of Change it saves anything. Changes to the owner's own work are saved without this card.
export function ChangeCard({ event, onApply, onKeep }: { event: Extract<HostEvent, { type: "change" }>; onApply: () => void; onKeep: () => void }) {
  return <Card label="From BrainDrive: change this Expert's instructions" tone="review">
    <h2 className="font-heading text-base text-bd-text-heading">{event.reverses ? "Undo this change to the Expert's instructions?" : "Change this Expert's instructions?"}</h2>
    {event.adding ? <p className="mt-2"><span className="text-bd-text-secondary">Adding: </span>"{event.adding}"</p> : null}
    {event.removing ? <p className="mt-2"><span className="text-bd-text-secondary">Removing: </span>"{event.removing}"</p> : null}
    {event.status === "pending" ? <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" onClick={onApply} className={expertPrimaryButton}>{event.reverses ? "Undo it" : "Change it"}</button>
      <button type="button" onClick={onKeep} className={expertButton}>Keep as is</button>
    </div> : <p role="status" className="mt-3 text-bd-text-secondary">{event.status === "applied" ? (event.reverses ? "Undone." : "Changed.") : "Kept as is. Nothing was changed."}</p>}
  </Card>;
}

export const FORUM_URL = "https://community.braindrive.ai";

// The export card (ES-5). BrainDrive draws it, not the model. It lists every file that will be in the
// plugin file, each opening in full. There is nothing to tick: the file is everything in the plugin.
// Save as a plugin saves the file to the owner's computer and sends nothing anywhere.
export function ExportCard({ draft, status, savedAs, fingerprint, onSave, onCancel }: { draft: ExportDraft; status: "pending" | "saved" | "cancelled"; savedAs?: string; fingerprint?: string; onSave: (fileName: string, files: [string, string][]) => void; onCancel: () => void }) {
  const [choices, setChoices] = useState<ExportChoices>({ creator: "", license: "MIT", otherLicense: "" });
  const [open, setOpen] = useState<string | null>(null);
  const [licenseHelp, setLicenseHelp] = useState(false);
  const licenseId = useId();
  const files = exportFileList(draft, choices);
  const fileName = `${pluginSlug(draft.name)}.zip`;
  const field = "mt-1 w-full rounded-lg border border-bd-border bg-bd-bg-primary px-3 py-2 text-sm text-bd-text-primary";
  return <Card label="From BrainDrive: share this Expert" tone="review">
    <h2 className="font-heading text-lg text-bd-text-heading">{draft.name}</h2>
    <p className="mt-2 text-bd-amber">Everything inside this Expert goes with it. If you're not sure what it's sharing, don't share it.</p>
    <p className="mt-2">Everything listed here will be readable by anyone who installs it. BrainDrive cannot promise the text is free of private details, so open each file and check.</p>
    <p className="mt-2 text-bd-text-secondary">BrainDrive pages, Your Memory and BrainDrive's tools don't travel with this Expert.</p>
    {status === "pending" ? (draft.original
      ? <p className="mt-3">Creator: {draft.original.creator}. License: {draft.original.license}. Both are kept from the original and cannot be changed here.</p>
      : <div className="mt-3 space-y-3">
        <label className="block">Creator name (optional)<input type="text" value={choices.creator} onChange={(change) => setChoices({ ...choices, creator: change.target.value })} className={field} /></label>
        <div>
          <div className="flex items-center gap-1">
            <label htmlFor={licenseId}>License</label>
            <button type="button" aria-label="What is a license?" aria-expanded={licenseHelp} aria-controls={`${licenseId}-help`} onClick={() => setLicenseHelp((shown) => !shown)} className="flex h-6 w-6 items-center justify-center rounded-full text-bd-text-secondary hover:bg-bd-bg-hover hover:text-bd-text-primary"><Info size={14} aria-hidden="true" /></button>
          </div>
          {licenseHelp ? <p id={`${licenseId}-help`} className="mt-1 rounded-lg border border-bd-border p-3 text-xs leading-relaxed text-bd-text-secondary">A license tells other people what they are allowed to do with your Expert. MIT is a common choice: anyone may use it, change it and share it, as long as they keep your license notice with it. None means you state no license, so others have no stated permission to reuse it. Other lets you name a different license.</p> : null}
          <span className="relative block">
          <select id={licenseId} value={choices.license} onChange={(change) => setChoices({ ...choices, license: change.target.value as ExportChoices["license"] })} className={`${field} cursor-pointer appearance-none pr-10`}>
            <option value="MIT">MIT</option><option value="none">None</option><option value="other">Other</option>
          </select>
          <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-bd-text-muted" />
          </span>
        </div>
        {choices.license === "other" ? <label className="block">Your license<input type="text" value={choices.otherLicense} onChange={(change) => setChoices({ ...choices, otherLicense: change.target.value })} className={field} /></label> : null}
        <p className="text-xs text-bd-text-secondary">The BrainDrive forum accepts MIT only.</p>
      </div>) : null}
    <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-bd-text-secondary">Files in the plugin file ({files.length})</h3>
    <ul className="mt-2 space-y-2">{files.map(([path, text]) => <li key={path}>
      <button type="button" aria-expanded={open === path} onClick={() => setOpen(open === path ? null : path)} className="break-all text-left text-xs font-semibold text-bd-text-heading underline underline-offset-2">{path}</button>
      {open === path ? <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bd-bg-primary p-3 text-xs leading-relaxed">{text}</pre> : null}
    </li>)}</ul>
    {status === "pending" ? <>
      <p className="mt-3 text-xs text-bd-text-secondary">You can edit any of these files in Page Settings before you share.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => onSave(fileName, files)} className={expertPrimaryButton}>Save as a plugin</button>
        <button type="button" onClick={onCancel} className={expertButton}>Cancel</button>
      </div>
    </> : status === "cancelled" ? <p role="status" className="mt-4 text-bd-text-secondary">Cancelled. Nothing was saved.</p> : <>
      <p role="status" className="mt-4">Saved {savedAs} to your computer. Nothing was sent anywhere.</p>
      <div className="mt-3 rounded-lg border border-bd-border p-3">
        <p>To share it with other owners, post it on the BrainDrive forum. You make the post yourself; BrainDrive posts nothing.</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Open the forum's sharing category.</li>
          <li>Start a new post and attach {savedAs}.</li>
          <li>Paste this file's fingerprint into the post, so people who install it can check they have your file.</li>
          <li>Your post is held until a moderator has checked it. Only you and the moderators can see it until then.</li>
        </ol>
        <div className="mt-3"><p className="text-xs font-semibold uppercase tracking-wide text-bd-text-secondary">Fingerprint</p><Fingerprint value={fingerprint} /></div>
        <a href={FORUM_URL} target="_blank" rel="noopener noreferrer" className={`${expertButton} mt-3 inline-flex items-center`}>Share on the forum</a>
        <p className="mt-2 text-xs text-bd-text-secondary">If the forum does not open, go to community.braindrive.ai.</p>
      </div>
    </>}
  </Card>;
}

// The install step. The forum is the main way: files there have been reviewed by the BrainDrive team.
// A file from anywhere else (GitHub included) is a second, smaller option behind a plain warning and
// an "at my own risk" tick. BrainDrive cannot check where a file came from, so the owner says which.
function InstallHelp({ projectId, active }: { projectId: string; active: boolean }) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const route = useRef<InstallRoute>("forum");
  const [elsewhereOpen, setElsewhereOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  function choose(from: InstallRoute) {
    route.current = from;
    chooseInstallRoute(projectId, from);
    fileInput.current?.click();
  }
  return <Card>
    <p>Install an Expert from the BrainDrive community forum.</p>
    <p className="mt-2 text-bd-text-secondary">Experts posted on the <a href={FORUM_URL} target="_blank" rel="noopener noreferrer" className="text-bd-amber underline underline-offset-2 hover:text-bd-amber-hover">BrainDrive forum (community.braindrive.ai)</a> have been reviewed by the BrainDrive team. Download the file from the post, then choose it here.</p>
    {active ? <div className="mt-3">
      <input ref={fileInput} type="file" aria-label="Plugin file" accept=".zip,application/zip" className="sr-only" tabIndex={-1} onChange={(change) => { const file = change.target.files?.[0]; change.target.value = ""; if (file) { const from = route.current; void fileFingerprint(file).then((fingerprint) => submitPluginFile(projectId, file.name, from, fingerprint)); } }} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={expertPrimaryButton} onClick={() => choose("forum")}>Choose file from the forum</button>
        <button type="button" className={expertButton} onClick={() => cancelInstallStep(projectId)}>Cancel</button>
      </div>
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
  // While a review card is waiting for Install or Cancel, the install box shows no controls of its own,
  // so there is only one Cancel on screen.
  const reviewPending = setup.events.some((event) => event.type === "review" && event.status === "pending");

  async function install(event: Extract<HostEvent, { type: "review" }>) {
    setBusy(true); setError("");
    try {
      const finalName = uniquePageName(event.review.name, takenNames);
      await renamePage(project.id, finalName);
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
          <button type="button" className={expertButton} onClick={() => startInstallStep(project.id)}>Install an Expert</button>
        </div>
        <p className="mt-2 text-xs text-bd-text-secondary">Create builds a new Expert by talking it through, and can use what's already in your BrainDrive.</p>
      </Card>;
      case "build": return <Card key={event.id}>
        <p>{event.typed ? "Got it. Here's what an Expert can do today:" : "Let's create your Expert. Here's what an Expert can do today:"}</p>
        <ul aria-label="What an Expert can do today" className="mt-2 list-disc space-y-1 pl-5">
          <li><span className="font-semibold">Follow your instructions:</span> what it's for, how it works with you, how it talks.</li>
          <li><span className="font-semibold">Work from files you give it,</span> like a price list, your notes or a checklist.</li>
          <li><span className="font-semibold">Learn how you like a task done</span> and do it that way every time.</li>
          <li><span className="font-semibold">Use what's already in your BrainDrive,</span> and keep goals and a plan with you if that helps.</li>
        </ul>
        <p className="mt-2 text-bd-text-secondary">Coming later: looking things up on the web, connecting to your other apps, and working on its own.</p>
        <p className="mt-2">{event.typed ? "Let me ask a couple of questions to shape it." : "What would you like it to help with?"}</p>
      </Card>;
      case "install-help": return <InstallHelp key={event.id} projectId={project.id} active={setup.installStep !== null && event.id === lastHelpId && !reviewPending} />;
      case "refused": return <Card key={event.id}><p role="alert">{event.reason}</p></Card>;
      case "review": return <ReviewCard key={event.id} review={event.review} status={event.status} busy={busy} onInstall={() => void install(event)} onCancel={() => cancelInstall(project.id, event.id)} />;
      case "export": return <ExportCard key={event.id} draft={event.draft} status={event.status} savedAs={event.savedAs} fingerprint={event.fingerprint}
        onSave={(fileName, files) => { const saved = downloadPluginZip(fileName, files); void fileFingerprint(saved).then((value) => saveExport(project.id, event.id, fileName, value)); }} onCancel={() => cancelExport(project.id, event.id)} />;
      case "change": return <ChangeCard key={event.id} event={event} onApply={() => applyInstructionChange(project.id, event.id)} onKeep={() => keepInstructions(project.id, event.id)} />;
      case "result": return <Card key={event.id}><p>{event.text}</p></Card>;
      case "notice": return <Card key={event.id} label="From BrainDrive: about AI"><p>{AI_NOTICE}</p></Card>;
    }
  })}{error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}</>;
}
