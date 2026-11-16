import { useState } from "react";
import { ExpertDialog, expertButton } from "./expert-ui";

// Confirmation for Delete page (Page changes PC-3.1): all five statements are in this text, in plain words.
export default function DeletePage({ project, onClose, onDeleted, onDeletePage }: { project: { id: string; name: string }; onClose: () => void; onDeleted: () => void; onDeletePage: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <ExpertDialog title={`Delete ${project.name}?`} description="Nothing changes until you confirm." onClose={() => { if (!busy) onClose(); }}>
    <div className="mt-5 space-y-3 text-sm leading-relaxed">
      <ul className="list-disc space-y-2 pl-5">
        <li>The page leaves your sidebar.</li>
        <li>Its Expert stops and won't run again, even after a restart or a Memory import.</li>
        <li>Every file on the page, and every file its Expert came with, stays in your Memory folder.</li>
        <li>Anything the Expert saved to Your Memory stays there. You can correct or remove it, and Memory history keeps earlier versions.</li>
        <li>There's no way to bring the page or its Expert back in this version.</li>
      </ul>
      <div className="pt-2">
        <button className={expertButton} disabled={busy} onClick={() => { setBusy(true); setError(""); void onDeletePage(project.id).then(onDeleted).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : "Deleting the page failed. Try again."); }).finally(() => setBusy(false)); }}>{busy ? "Deleting…" : "Delete page"}</button>
        <button className={`${expertButton} ml-2`} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
    {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
  </ExpertDialog>;
}
