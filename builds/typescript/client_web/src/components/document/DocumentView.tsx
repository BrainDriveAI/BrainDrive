import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, LoaderCircle, PencilLine, Save, X } from "lucide-react";

import { readFileContent, writeFileContent } from "@/api/gateway-adapter";
import type { InterfaceDocumentState } from "@/api/interface-context";
import { Button } from "@/components/ui/button";
import MarkdownContent from "@/components/markdown/MarkdownContent";
import { projectDisplayLabel } from "@/components/layout/sidebar-labels";

type DocumentViewProps = {
  projectId: string;
  projectName: string;
  file: { name: string; path: string };
  onBack: () => void;
  onStateChange?: (state: InterfaceDocumentState) => void;
  onDirtyChange?: (isDirty: boolean) => void;
  navigationGuardHandledByParent?: boolean;
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
  file,
  onBack,
  onStateChange,
  onDirtyChange,
  navigationGuardHandledByParent = false
}: DocumentViewProps) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false);

  const isDirty = isEditing && draft !== content;

  const loadContent = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextContent = await readFileContent(projectId, file.path);
      setContent(nextContent);
      setDraft(nextContent);
      onStateChange?.("viewing");
      onDirtyChange?.(false);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [file.path, onDirtyChange, onStateChange, projectId]);

  useEffect(() => {
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
      setIsEditing(false);
      onStateChange?.("viewing");
      onDirtyChange?.(false);
      await loadContent();
    } catch (saveError) {
      const message = getErrorMessage(saveError);
      setError(
        /401|403|auth|permission|session|unauthorized/i.test(message)
          ? "Your session no longer allows this edit. Your changes are still here. Sign in again, then choose Save again."
          : `We couldn't save this document. Your changes are still here. ${message}`
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setDraft(content);
    setError(null);
    setIsEditing(false);
    onStateChange?.("viewing");
    onDirtyChange?.(false);
  }

  function handleBack() {
    if (isDirty && !navigationGuardHandledByParent) {
      setShowDiscardConfirmation(true);
      return;
    }

    onBack();
  }

  function startEditing() {
    setDraft(content);
    setError(null);
    setIsEditing(true);
    onStateChange?.("editing");
    onDirtyChange?.(false);
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-bd-bg-chat text-bd-text-primary">
      <header className="border-b border-bd-border/80 bg-bd-bg-chat/90 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex w-full max-w-[780px] items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.24em] text-bd-text-muted">
              {projectName}
            </div>
            <h1 className="truncate font-heading text-lg text-bd-text-heading">{file.name}</h1>
            <p className="truncate text-xs text-bd-text-muted" aria-label="Document source">
              From {projectDisplayLabel(projectId, projectName)} · Source: {file.path}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleBack}
              disabled={isSaving}
              className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
            >
              <ArrowLeft size={16} />
              Back to chat
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
                  className="bg-bd-amber text-white hover:bg-bd-amber-hover"
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
                onClick={startEditing}
                disabled={isLoading}
                className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
              >
                <PencilLine size={16} />
                Edit
              </Button>
            )}
          </div>
        </div>
      </header>

      {showDiscardConfirmation ? (
        <div
          className="border-b border-bd-amber/40 bg-bd-amber/10 px-4 py-3 sm:px-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-document-heading"
        >
          <div className="mx-auto flex w-full max-w-[780px] items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 id="discard-document-heading" className="text-sm font-medium text-bd-text-heading">
                Keep your unsaved changes?
              </h2>
              <p className="mt-1 text-xs text-bd-text-secondary">
                Your changes are still here. Choose Keep editing or discard them before returning to chat.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowDiscardConfirmation(false)}
                className="text-bd-text-secondary hover:bg-bd-bg-secondary hover:text-bd-text-heading"
              >
                Keep editing
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowDiscardConfirmation(false);
                  onBack();
                }}
                className="text-bd-danger hover:bg-bd-danger-bg"
              >
                Discard and go back
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--mobile-composer-height,0px)+1.5rem)] pt-6 sm:px-6 md:pb-6"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
      >
        <div className="mx-auto flex h-full w-full max-w-[780px] flex-col">
          {error && (
            <div role="alert" className="mb-4 flex items-start gap-3 rounded-xl border border-bd-danger-border bg-bd-danger-bg px-4 py-3 text-sm text-bd-danger">
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
              onChange={(event) => {
                setDraft(event.target.value);
                onDirtyChange?.(event.target.value !== content);
              }}
              spellCheck={false}
              className="min-h-[420px] flex-1 resize-none rounded-2xl border border-bd-border bg-bd-bg-secondary px-5 py-4 font-mono text-[14px] leading-7 text-bd-text-primary outline-none transition-colors placeholder:text-bd-text-muted focus:border-bd-amber/60"
            />
          ) : (
            <article className="py-2">
              <div className="prose-bd max-w-full text-[15px] leading-7 text-bd-text-primary">
                <MarkdownContent content={content} />
              </div>
            </article>
          )}
        </div>
      </div>
    </section>
  );
}

export type { DocumentViewProps };
