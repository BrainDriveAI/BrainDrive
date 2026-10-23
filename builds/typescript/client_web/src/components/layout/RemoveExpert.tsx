import { useState } from "react";
import { ExpertDialog, expertButton } from "./AddExpert";

export default function RemoveExpert({ project, onClose, onRemoved, onRemovePage }: { project: { id: string; name: string }; onClose: () => void; onRemoved: () => void; onRemovePage: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <ExpertDialog title={`Remove ${project.name}?`} description="It will leave your sidebar. Your saved work stays in BrainDrive." onClose={() => { if (!busy) onClose(); }}>
    <div className="mt-5 space-y-4 text-sm">
      <p>Your goals, plan, journal, and other files are kept. Earlier conversation may still shape future answers.</p>
      <button className={expertButton} disabled={busy} onClick={() => { setBusy(true); setError(""); void onRemovePage(project.id).then(onRemoved).catch((failure: unknown) => { setError(failure instanceof Error ? failure.message : "Removal failed. Try again."); }).finally(() => setBusy(false)); }}>{busy ? "Removing…" : "Remove and keep my work"}</button>
      <button className={`${expertButton} ml-2`} disabled={busy} onClick={onClose}>Cancel</button>
    </div>
    {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
  </ExpertDialog>;
}
