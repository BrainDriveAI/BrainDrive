import { ArrowRight, Pencil, X } from "lucide-react";

import type { ResumeConversationState } from "./ResumeBuilderConversation";

export default function ResumeReviewRail({
  facts,
  onClose,
  onEditFact,
  onOpenWorkspace,
}: {
  facts: ResumeConversationState["reviewFacts"];
  onClose: () => void;
  onEditFact: (factId: string) => void;
  onOpenWorkspace: () => void;
}) {
  return (
    <aside
      aria-label="Resume review summary"
      className="flex min-h-[18rem] min-w-0 flex-col border-t border-bd-border bg-bd-bg-primary lg:w-[24%] lg:min-w-[18rem] lg:border-l lg:border-t-0"
    >
      <header className="flex items-start justify-between gap-3 border-b border-bd-border px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-bd-text-muted">Review</p>
          <h2 className="mt-1 font-heading text-base font-semibold text-bd-text-heading">What you’ve shared</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close review summary"
          className="rounded-md p-1.5 text-bd-text-muted hover:bg-bd-bg-hover hover:text-bd-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="text-xs leading-5 text-bd-text-muted">
          A quiet glance at recent confirmed details. Nothing changes unless you choose Edit.
        </p>
        <div className="mt-3 divide-y divide-bd-border">
          {facts.length > 0 ? facts.map((fact) => (
            <article key={fact.id} className="py-3 first:pt-0">
              <p className="text-[11px] uppercase tracking-[0.12em] text-bd-text-muted">{fact.label}</p>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-bd-text-primary">{fact.value}</p>
              <button
                type="button"
                onClick={() => onEditFact(fact.id)}
                className="mt-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-bd-text-secondary hover:bg-bd-bg-hover hover:text-bd-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
              >
                <Pencil size={12} aria-hidden="true" />
                Edit
              </button>
            </article>
          )) : (
            <p className="py-3 text-sm leading-6 text-bd-text-secondary">Confirmed details will appear here as the conversation develops.</p>
          )}
        </div>
      </div>

      <footer className="border-t border-bd-border p-3">
        <button
          type="button"
          onClick={onOpenWorkspace}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium text-bd-text-primary hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
        >
          <span>Open full review</span>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}
