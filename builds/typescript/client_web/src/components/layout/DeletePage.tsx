import { useState } from "react";
import { ExpertDialog, expertButton } from "./expert-ui";

// Confirmation for Delete page (spec AC-11.1): all four statements are in this text.
export default function DeletePage({ project, onClose, onDeleted, onDeletePage }: { project: { id: string; name: string }; onClose: () => void; onDeleted: () => void; onDeletePage: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <ExpertDialog title={`Delete ${project.name}?`} description="Nothing changes until you confirm." onClose={() => { if (!busy) onClose(); }}>
    <div className="mt-5 space-y-3 text-sm leading-relaxed">
      <ul className="list-disc space-y-2 pl-5">
        <li>Its files stay in Your Memory.</li>
        <li>Its plugins are detached from the page. The page's Expert and its install record move into the kept files as plain files. Other plugins stay available to your other pages.</li>
        <li>The page leaves your sidebar.</li>
        <li>BrainDrive has no way to restore a deleted page in this version.</li>
      </ul>
      <div className="pt-2">
        <button className={expertButton} disabled={busy} onClick={() => { setBusy(true); setError(""); void onDeletePage(project.id).then(onDeleted).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : "Deleting the page failed. Try again."); }).finally(() => setBusy(false)); }}>{busy ? "Deleting…" : "Delete page"}</button>
        <button className={`${expertButton} ml-2`} disabled={busy} onClick={onClose}>Cancel</button>
      </div>
    </div>
    {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
  </ExpertDialog>;
}
