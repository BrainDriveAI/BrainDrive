import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, History, LoaderCircle, PackagePlus, PencilLine, Save, Trash2, X } from "lucide-react";

import { deleteFileContent, readFileContent, writeFileContent } from "@/api/gateway-adapter";
import { Button } from "@/components/ui/button";
import MarkdownContent from "@/components/markdown/MarkdownContent";
import { earlierVersions, formatSavedTime, keepReplacedVersion, sampleLastSaved, type FileVersion } from "@/prototype/fileHistoryMock";

type DocumentViewProps = {
  projectId: string;
  projectName: string;
  showProjectName?: boolean;
  file: { name: string; path: string };
  onBack: () => void;
  backLabel?: string;
  // When given, the owner can delete this file. Called after the file is gone.
  onDeleted?: () => void;
  // When given, the owner can put a copy of this file inside the page's Expert (AC-3.7). Throws with a
  // plain reason when it cannot be done.
  onPutInside?: (content: string) => Promise<void>;
  // PROTOTYPE: show the last-saved time and Earlier versions (Page changes PC-7.1, PC-7.2), from the mock history.
  showHistory?: boolean;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

export default function DocumentView({
  projectId,
  projectName,
  showProjectName = true,
  file,
  onBack,
  backLabel = "Back to chat",
  onDeleted,
  onPutInside,
  showHistory = false
}: DocumentViewProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<FileVersion | null>(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState(() => sampleLastSaved(file.path));
  const [confirmingPut, setConfirmingPut] = useState(false);
  const [isPutting, setIsPutting] = useState(false);
  const [putDone, setPutDone] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadContent = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextContent = await readFileContent(projectId, file.path);
      setContent(nextContent);
      setDraft(nextContent);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [file.path, projectId]);

  useEffect(() => {
    setConfirmingPut(false);
    setPutDone(false);
    setHistoryOpen(false);
    setViewing(null);
    setRestoreNote(null);
    setIsEditing(false);
    setContent("");
    setDraft("");
    setError(null);
    void loadContent();
  }, [loadContent]);

  async function handleSave() {
    setIsSaving(true);
    setError(null);

    try {
      await writeFileContent(projectId, file.path, draft);
      if (showHistory && draft !== content) { keepReplacedVersion(file.path, content, lastSavedAt); setLastSavedAt(new Date()); }
      setIsEditing(false);
      await loadContent();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);

    try {
      await deleteFileContent(projectId, file.path);
      onDeleted?.();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
      setIsDeleting(false);
      setConfirmingDelete(false);
    }
  }

  // Making an earlier version current is an ordinary save of its text. The text it replaces is kept as
  // an earlier version, so nothing is lost.
  async function handleRestore(version: FileVersion) {
    setIsSaving(true);
    setError(null);
    try {
      await writeFileContent(projectId, file.path, version.text);
      keepReplacedVersion(file.path, content, lastSavedAt);
      setLastSavedAt(new Date());
      setViewing(null);
      setHistoryOpen(false);
      setRestoreNote(`Restored the version saved ${formatSavedTime(version.savedAt)}. The text it replaced is now an earlier version.`);
      await loadContent();
    } catch (restoreError) {
      setError(getErrorMessage(restoreError));
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePutInside() {
    setIsPutting(true);
    setError(null);
    try {
      await onPutInside?.(content);
      setPutDone(true);
    } catch (putError) {
      setError(getErrorMessage(putError));
    } finally {
      setIsPutting(false);
      setConfirmingPut(false);
    }
  }

  function handleCancel() {
    setDraft(content);
    setError(null);
    setIsEditing(false);
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-bd-bg-chat text-bd-text-primary">
      <header className="border-b border-bd-border/80 bg-bd-bg-chat/90 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex w-full max-w-[780px] items-center justify-between gap-3">
          <div className="min-w-0">
            {showProjectName ? <div className="text-[11px] uppercase tracking-[0.24em] text-bd-text-muted">
              {projectName}
            </div> : null}
            <h1 className="truncate font-heading text-lg text-bd-text-heading">{file.name}</h1>
            {showHistory ? <p className="text-xs text-bd-text-secondary">Last saved {formatSavedTime(lastSavedAt)}</p> : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={isSaving}
              className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
            >
              <ArrowLeft size={16} />
              {backLabel}
            </Button>

            {isEditing ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancel}
                  disabled={isSaving}
                  className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
                >
                  <X size={16} />
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="bg-bd-amber text-bd-bg-primary hover:bg-bd-amber-hover"
                >
                  {isSaving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                  {isSaving ? "Saving..." : "Save"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(content);
                  setError(null);
                  setIsEditing(true);
                }}
                disabled={isLoading || viewing !== null}
                className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
              >
                <PencilLine size={16} />
                Edit
              </Button>
            )}

            {showHistory && !isEditing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={historyOpen}
                onClick={() => { setHistoryOpen((open) => !open); setViewing(null); }}
                disabled={isLoading || isSaving}
                className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
              >
                <History size={16} />
                Earlier versions
              </Button>
            ) : null}

            {onPutInside && !isEditing && !putDone ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingPut(true)}
                disabled={isLoading || isPutting || confirmingPut}
                className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
              >
                <PackagePlus size={16} />
                Put inside the Expert
              </Button>
            ) : null}

            {onDeleted && !isEditing ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingDelete(true)}
                disabled={isLoading || isDeleting || confirmingDelete}
                className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
              >
                <Trash2 size={16} />
                Delete file
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--mobile-composer-height,0px)+1.5rem)] pt-6 sm:px-6 md:pb-6"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
      >
        <div className="mx-auto flex h-full w-full max-w-[780px] flex-col">
          {restoreNote && <p role="status" className="mb-4 rounded-xl border border-bd-border px-4 py-3 text-sm text-bd-text-secondary">{restoreNote}</p>}

          {historyOpen && !viewing && !isEditing && (
            <section aria-label="Earlier versions" className="mb-4 rounded-xl border border-bd-border px-4 py-3 text-sm">
              <p className="text-bd-text-primary">Earlier versions of this file. Open one to read it, and make it current if you want it back.</p>
              {earlierVersions(file.path, content).length ? <ul className="mt-2 divide-y divide-bd-border">
                {earlierVersions(file.path, content).map((version) => <li key={version.id}>
                  <button type="button" onClick={() => setViewing(version)} className="flex w-full min-h-11 items-center justify-between gap-3 py-2 text-left hover:text-bd-text-heading">
                    <span>Saved {formatSavedTime(version.savedAt)}</span>
                    <span className="text-xs text-bd-text-secondary">Open</span>
                  </button>
                </li>)}
              </ul> : <p className="mt-2 text-bd-text-secondary">No earlier versions yet.</p>}
              <p className="mt-2 text-xs text-bd-text-muted">Prototype: these times and the first versions are samples.</p>
            </section>
          )}

          {viewing && (
            <div role="region" aria-label="Earlier version" className="mb-4 rounded-xl border border-bd-amber/60 bg-bd-bg-secondary px-4 py-3 text-sm">
              <p className="text-bd-text-primary">You are reading the version saved {formatSavedTime(viewing.savedAt)}. It is read-only.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void handleRestore(viewing)} disabled={isSaving} className="bg-bd-amber text-bd-bg-primary hover:bg-bd-amber-hover">
                  {isSaving ? "Saving..." : "Make this the current version"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setViewing(null)} disabled={isSaving} className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading">
                  Back to the current version
                </Button>
              </div>
            </div>
          )}

          {confirmingPut && (
            <div role="alertdialog" aria-label="Put this file inside the Expert?" className="mb-4 rounded-xl border border-bd-amber/60 bg-bd-bg-secondary px-4 py-3 text-sm">
              <p className="text-bd-text-primary">Put "{file.name.split("/").pop()}" inside this Expert? A copy becomes one of the Expert's reference files, and it will travel with the Expert when you share it. Your own copy stays in Your Files.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handlePutInside} disabled={isPutting} className="bg-bd-amber text-bd-bg-primary hover:bg-bd-amber-hover">
                  {isPutting ? <LoaderCircle size={16} className="animate-spin" /> : <PackagePlus size={16} />}
                  {isPutting ? "Putting it inside..." : "Put it inside"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingPut(false)} disabled={isPutting} className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading">
                  Keep it in my files
                </Button>
              </div>
            </div>
          )}

          {putDone && (
            <p role="status" className="mb-4 rounded-xl border border-bd-border px-4 py-3 text-sm text-bd-text-secondary">A copy is now inside this Expert, listed in Page Settings. It will travel when you share the Expert.</p>
          )}

          {confirmingDelete && (
            <div role="alertdialog" aria-label="Delete this file?" className="mb-4 rounded-xl border border-bd-danger-border bg-bd-danger-bg px-4 py-3 text-sm">
              <p className="text-bd-text-primary">Delete this file? It will be removed from this page. You can't bring it back from inside BrainDrive yet.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={handleDelete} disabled={isDeleting} className="border border-bd-danger-border bg-transparent text-bd-danger hover:bg-bd-bg-secondary">
                  {isDeleting ? <LoaderCircle size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  {isDeleting ? "Deleting..." : "Delete file"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={isDeleting} className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading">
                  Keep it
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-bd-danger-border bg-bd-danger-bg px-4 py-3 text-sm text-bd-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div>{error}</div>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center py-12 text-bd-text-secondary">
              <div className="flex items-center gap-3">
                <LoaderCircle size={18} className="animate-spin" />
                <span>Loading document...</span>
              </div>
            </div>
          ) : isEditing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="min-h-[420px] flex-1 resize-none rounded-2xl border border-bd-border bg-bd-bg-secondary px-5 py-4 font-mono text-[14px] leading-7 text-bd-text-primary outline-none transition-colors placeholder:text-bd-text-muted focus:border-bd-amber/60"
            />
          ) : (
            <article className="py-2">
              <div className="prose-bd max-w-full text-[15px] leading-7 text-bd-text-primary">
                <MarkdownContent content={viewing ? viewing.text : content} />
              </div>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

export type { DocumentViewProps };
