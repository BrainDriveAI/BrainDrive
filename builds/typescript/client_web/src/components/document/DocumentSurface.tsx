import MarkdownContent from "@/components/markdown/MarkdownContent";

type DocumentSurfaceProps = {
  mode: "read" | "edit";
  content: string;
  onChange?: (content: string) => void;
};

/** The readable Markdown view and plain-text editor used by page documents. */
export default function DocumentSurface({ mode, content, onChange }: DocumentSurfaceProps) {
  if (mode === "edit") {
    return (
      <textarea
        aria-label="Document content"
        value={content}
        onChange={(event) => onChange?.(event.target.value)}
        spellCheck={false}
        className="min-h-[420px] flex-1 resize-none rounded-2xl border border-bd-border bg-bd-bg-secondary px-5 py-4 font-mono text-[14px] leading-7 text-bd-text-primary outline-none transition-colors placeholder:text-bd-text-muted focus:border-bd-amber/60"
      />
    );
  }

  return (
    <article aria-label="Document content" className="py-2">
      <div className="prose-bd max-w-full text-[15px] leading-7 text-bd-text-primary">
        <MarkdownContent content={content} />
      </div>
    </article>
  );
}

export type { DocumentSurfaceProps };
