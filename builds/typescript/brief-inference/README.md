# Brief Builder protected inference

`brief.generate@1` is a fixed, bounded, credential-isolated, no-tools structured purpose. The host resolves the owner's active compatible provider/model and passes only an immutable Brief source snapshot plus explicitly supplied owner context. Provider credentials, transport tokens, raw paths, unrestricted prompts, the main agent loop, and general tools are never passed to the app or stored with results.

Strict schema parsing is followed by deterministic quote/context grounding. Fixture outputs prove only workflow and contract behavior. Natural-language usefulness, concision, coherence, and faithfulness require the rubric in `fixtures/evaluation-rubric.json` and named human review; no live-model quality claim is made by automated fixture tests.

The live resolver reads the owner-active profile, checks a versioned Brief-specific compatibility entry before resolving credentials, and adapts only `completeStructuredNoTools`. The shipped registry is deliberately empty until a Brief conformance run is accepted, so non-fixture execution fails closed instead of borrowing Resume compatibility evidence.

The real sandbox capability path is gated first by the capability dispatcher, then by the generic inference dispatcher keyed by `(ai.braindrive.brief-builder, brief.generate, 1)`. The latter verifies the current app/install/package grant and exact manifest purpose request before executing this broker. Cancellation is bound to the originating host session and forwards through both dispatchers to the provider signal; closing the session also cancels its active operations, and late provider results cannot persist source or draft records.
