# Resume Builder fix 14: no duplicate Profile record

Non-authoritative implementation and verification record. Change authority is Dave J's ruling (forum t/356/95) that an `interview_progress` record written from the Profile counts as hidden interview state under FR-HIDDEN-1.

## Change

`resume.profile.update` previously planned two steps: a `resume.definitions.write` capability call that wrote an `interview_progress` record (audit turn topic `resume_profile`, answer = the Profile markdown), then the `resume.profile` document write. The record duplicated the Profile and the domain turned it into an `interview_turn` source record.

The plan is now one `document.write` step, `write-profile-document`, which is also the final result. The live planner (`resources/inference-program.js`) and its TypeScript mirror (`src/chat-workspace.ts`) change together, and `buildResumeProfileUpdateCapabilityInput` is removed from both.

Because the document write is now the primary step, the packaged descriptor changes with it:

- `resume.profile.update` declares `required_capabilities: []` (mirror metadata `capability: null`). The host checks declared capabilities before planning, so a document-only action no longer needs, or holds, Resume-domain write authority.
- Its result schema is a dedicated document-mutation schema requiring `result_version`, `record` and `audit`, matching `AppDocumentStorageMutationResultSchema`. It rejects `{}` and a Resume-domain capability result.
- The Profile document description no longer says it is built from Resume-domain records.

## Checks that nothing depends on the record

- `compatibilitySource: "resume-domain"` only labels test-only projections; there is no fallback reading Profile content from domain records, and document seeding uses package `initial_content`.
- `resume-lineage.ts` validates existing `interview_progress` records only; Create Resume lineage is the document `derived_from` on `resume.profile`.
- `data-conformance.ts` write kinds are unchanged: `resume.create` and the legacy form interview still need the `resume.definitions.write` capability.
- Legacy `main.html` interview is not reachable from the product UI (default presentation is the chat workspace); it remains reachable only through the owner-authenticated `POST /apps/:appKey/launch` API. It is not removed here.

## Verification

Synthetic local tests only; no live model or owner session. Tests assert one document step in both planners, no `interview_progress`/capability step, Profile read and Create still use the document, Profile Update succeeding with no Resume-domain grant and no router call, and the packaged descriptor rejecting `{}` and a capability result. A live app-chat Profile Update and Create Resume check is still needed.
