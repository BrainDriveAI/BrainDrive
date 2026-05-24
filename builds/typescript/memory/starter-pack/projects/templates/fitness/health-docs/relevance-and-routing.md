# Health Document Relevance And Routing

Use uploaded documents as Fitness context only when they are relevant to the owner's Fitness goals, health constraints, or plan execution.

Expected relevant document types:

- labs and biomarker reports
- doctor's notes or visit summaries
- prescription or medication lists
- PT, rehab, or return-to-activity notes
- imaging summaries when tied to movement constraints
- fitness-tracker exports when tied to activity, sleep, recovery, or energy

Out-of-scope examples:

- bank statements
- resumes
- legal documents
- unrelated school, work, or career files
- documents that belong in Finance, Career, Relationships, or another project

## Behavior

- Do not silently ingest irrelevant docs as Fitness context.
- If substrate `doc_type` or document content indicates a non-health document, say what it appears to be and offer to route or capture it in the right project.
- If a document is ambiguous, ask the owner how they want it used before treating it as Fitness context.
- If part of a document is relevant and part is not, use only the relevant portion and say what you are ignoring.

## Routing Language

Use concise routing language:

> This looks like a finance document, not Fitness context. I should not use it to shape your workout or nutrition plan. Want me to route it to Finance instead?
