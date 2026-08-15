import { ChevronRight, PencilLine } from "lucide-react";

import type { ResumeEvidenceSummary } from "./ResumeBuilderConversation";

export default function ResumeEvidenceTray({
  evidence,
  onEditFact,
  onOpenReview,
}: {
  evidence: ResumeEvidenceSummary;
  onEditFact: (factId: string) => void;
  onOpenReview: () => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-bd-border bg-bd-bg-secondary/70 lg:w-80 lg:border-l lg:border-t-0" aria-label="Resume evidence tray">
      <div className="flex items-center justify-between gap-3 border-b border-bd-border px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-bd-text-muted">Evidence</p>
          <h2 className="mt-0.5 font-heading text-sm font-semibold text-bd-text-heading">Live resume facts</h2>
        </div>
        <button
          type="button"
          onClick={onOpenReview}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-bd-amber hover:bg-bd-bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
        >
          Review all
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      <dl className="grid grid-cols-3 gap-px bg-bd-border" aria-label="Evidence counts">
        <div className="bg-bd-bg-secondary px-2 py-3 text-center">
          <dt className="text-[11px] leading-tight text-bd-text-muted">Confirmed</dt>
          <dd className="mt-1 font-heading text-xl font-semibold text-bd-text-heading">{evidence.confirmedCount}</dd>
        </div>
        <div className="bg-bd-bg-secondary px-2 py-3 text-center">
          <dt className="text-[11px] leading-tight text-bd-text-muted">Needs attention</dt>
          <dd className="mt-1 font-heading text-xl font-semibold text-bd-amber">{evidence.needsAttentionCount}</dd>
        </div>
        <div className="bg-bd-bg-secondary px-2 py-3 text-center">
          <dt className="text-[11px] leading-tight text-bd-text-muted">To discuss</dt>
          <dd className="mt-1 font-heading text-xl font-semibold text-bd-text-heading">{evidence.stillToDiscussCount}</dd>
        </div>
      </dl>

      <div className="hidden min-h-0 flex-1 overflow-y-auto p-4 lg:block">
        <p className="mb-2 text-xs font-medium text-bd-text-secondary">Recently confirmed</p>
        {evidence.recentFacts.length > 0 ? (
          <div className="space-y-2">
            {evidence.recentFacts.map((fact) => (
              <article key={fact.id} className="rounded-lg border border-bd-border bg-bd-bg-primary p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-bd-text-muted">{fact.label}</span>
                  <span className="text-[10px] font-medium text-bd-success">Confirmed</span>
                </div>
                <p className="mt-1 line-clamp-3 text-xs leading-5 text-bd-text-primary">{fact.value}</p>
                <button
                  type="button"
                  onClick={() => onEditFact(fact.id)}
                  className="mt-2 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-bd-text-secondary hover:bg-bd-bg-hover hover:text-bd-text-heading focus-visible:outline focus-visible:outline-2 focus-visible:outline-bd-amber"
                  aria-label={`Edit recent ${fact.label.toLowerCase()} fact`}
                >
                  <PencilLine size={12} aria-hidden="true" />
                  Edit
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-bd-border p-3 text-xs leading-5 text-bd-text-muted">
            Confirmed answers will appear here as the conversation continues.
          </p>
        )}
      </div>
    </aside>
  );
}
