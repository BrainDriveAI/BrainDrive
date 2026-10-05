import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, LoaderCircle, PencilLine } from "lucide-react";

import { readFileContent, writeFileContent } from "@/api/gateway-adapter";
import DocumentEditActions from "./DocumentEditActions";
import MarkdownContent from "@/components/markdown/MarkdownContent";
import { DocumentButton, DocumentHeader, documentStyles } from "./DocumentSurface";
import type { ProjectFile } from "@/types/ui";

type DocumentViewProps = {
  projectId: string;
  projectName: string;
  file: ProjectFile;
  onBack: () => void;
};

const DOCUMENT_DRAFT_PREFIX = "braindrive:document-draft:";

function documentDraftKey(projectId: string, filePath: string): string {
  return `${DOCUMENT_DRAFT_PREFIX}${projectId}:${filePath}`;
}

function readStoredDraft(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredDraft(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
  }
}

function removeStoredDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or constrained browser contexts.
  }
}

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
  onBack
}: DocumentViewProps) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draftKey = useMemo(() => documentDraftKey(projectId, file.path), [file.path, projectId]);

  const loadContent = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotice(null);

    try {
      const nextContent = await readFileContent(projectId, file.path);
      const storedDraft = readStoredDraft(draftKey);
      setContent(nextContent);
      if (storedDraft !== null && storedDraft !== nextContent) {
        setDraft(storedDraft);
        setIsEditing(true);
        setError("Unsaved changes were restored. Review and save or cancel them.");
      } else {
        setDraft(nextContent);
        if (storedDraft === nextContent) removeStoredDraft(draftKey);
      }
    } catch (loadError) {
      const storedDraft = readStoredDraft(draftKey);
      if (storedDraft !== null) {
        setDraft(storedDraft);
        setIsEditing(true);
        setError(`${getErrorMessage(loadError)} Unsaved changes were restored.`);
      } else {
        setError(getErrorMessage(loadError));
      }
    } finally {
      setIsLoading(false);
    }
  }, [draftKey, file.path, projectId]);

  useEffect(() => {
    setIsEditing(false);
    setContent("");
    setDraft("");
    setError(null);
    setNotice(null);
    void loadContent();
  }, [loadContent]);

  useEffect(() => {
    if (!isEditing) return;
    if (draft !== content) {
      writeStoredDraft(draftKey, draft);
    } else {
      removeStoredDraft(draftKey);
    }
  }, [content, draft, draftKey, isEditing]);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      await writeFileContent(projectId, file.path, draft);
      removeStoredDraft(draftKey);
      setIsEditing(false);
      await loadContent();
      setNotice(`Saved ${file.displayName ?? file.name}.`);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
      setNotice(null);
    } finally {
      setIsSaving(false);
    }
  }

  function handleCancel() {
    setDraft(content);
    setError(null);
    setNotice(null);
    setIsEditing(false);
    removeStoredDraft(draftKey);
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col bg-bd-bg-chat text-bd-text-primary">
      <DocumentHeader>
          <div className="min-w-0">
            <div className={documentStyles.eyebrow}>
              {projectName}
            </div>
            <h1 className={documentStyles.title}>{file.displayName ?? file.name}</h1>
            {file.sourceType === "app_published" && file.sourceLabel ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-bd-text-secondary">
                <span>Published by {file.sourceLabel}</span>
                {file.quality ? (
                  <span
                    className="rounded-full border border-bd-border bg-bd-bg-secondary px-2 py-0.5 text-bd-text-primary"
                    role="status"
                    aria-label={`Resume quality status: ${file.quality.label}`}
                  >
                    {file.quality.label}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className={documentStyles.headerActions}>
            <DocumentButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={onBack}
              disabled={isSaving}
              className={documentStyles.secondary}
            >
              <ArrowLeft size={16} />
              Back to chat
            </DocumentButton>

            {isEditing ? (
              <DocumentEditActions onCancel={handleCancel} onSave={handleSave} isSaving={isSaving} />
            ) : file.readOnly ? null : (
              <DocumentButton
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(content);
                  setError(null);
                  setIsEditing(true);
                }}
                disabled={isLoading}
                className={documentStyles.secondary}
              >
                <PencilLine size={16} />
                Edit
              </DocumentButton>
            )}
          </div>
      </DocumentHeader>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--mobile-composer-height,0px)+1.5rem)] pt-6 sm:px-6 md:pb-6"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
      >
        <div className="mx-auto flex h-full w-full max-w-[780px] flex-col">
          {error && (
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-bd-danger-border bg-bd-danger-bg px-4 py-3 text-sm text-bd-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div>{error}</div>
              </div>
            </div>
          )}

          {notice ? (
            <div role="status" aria-live="polite" className="mb-4 rounded-xl border border-bd-success/35 bg-bd-success/10 px-4 py-3 text-sm text-bd-text-primary">
              {notice}
            </div>
          ) : null}

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
                setNotice(null);
              }}
              spellCheck={false}
              className={documentStyles.editor}
            />
          ) : (
            <article className="py-2">
              <div className={documentStyles.body}>
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
