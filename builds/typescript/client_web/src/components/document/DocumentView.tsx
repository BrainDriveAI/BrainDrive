import { useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, LoaderCircle, PencilLine, Save, X } from "lucide-react";

import { readFileContent, writeFileContent } from "@/api/gateway-adapter";
import { Button } from "@/components/ui/button";
import MarkdownContent from "@/components/markdown/MarkdownContent";

type DocumentViewProps = {
  projectId: string;
  projectName: string;
  file: { name: string; path: string };
  onBack: () => void;
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
  onBack
}: DocumentViewProps) {
  const [content, setContent] = useState("");
  const [draft, setDraft] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadContent() {
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
  }

  useEffect(() => {
    setIsEditing(false);
    setContent("");
    setDraft("");
    setError(null);
    void loadContent();
  }, [projectId, file.path]);

  async function handleSave() {
    setIsSaving(true);
    setError(null);

    try {
      await writeFileContent(projectId, file.path, draft);
      setIsEditing(false);
      await loadContent();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setIsSaving(false);
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
            <div className="text-[11px] uppercase tracking-[0.24em] text-bd-text-muted">
              {projectName}
            </div>
            <h1 className="truncate font-heading text-lg text-bd-text-heading">{file.name}</h1>
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
                onClick={() => {
                  setDraft(content);
                  setError(null);
                  setIsEditing(true);
                }}
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
