# Intent Layer Implementation Log

Date: 2026-03-26
Scope: Implement the intent exception layer in `builds/typescript` with transient skill preselection, workflow lock lease semantics, and drift-safe gateway integration.

## Baseline

1. No existing intent layer files in `builds/typescript`.
2. Gateway `/message` currently composes prompt from persisted conversation/project skill bindings only.
3. No workflow lock state exists today.

## Work Journal

### Entry 01 - Start

1. Confirmed clean working tree in `/home/hex/Project/BrainDrive-Test-01`.
2. Confirmed all implementation changes will be limited to the `builds` repo tree.
3. Prepared implementation plan:
   - add `intent_layer` core modules
   - integrate gateway request path
   - add starter artifacts and config scaffold
   - add tests and run validation

### Entry 02 - Contract-Safe Intent Layer Foundation

1. Expanded `builds/typescript/intent_layer/types.ts` to include:
   - workflow lock store config/snapshot/update result types
   - tool-name context input for suggestion logic
2. Expanded `builds/typescript/intent_layer/config.ts` to support:
   - `profile_registry_sources` (`skills_memory`, `built_in`)
   - `profile_alias_overrides`
   - `default_profile_by_action`
   - merge behavior with strict fallback-to-default safety
3. Added new IEL modules (isolated from gateway internals):
   - `profile-registry.ts`
   - `profile-resolver.ts`
   - `capability-map.ts`
   - `policy.ts`
   - `workflow-lock-policy.ts`
   - `workflow-lock-store.ts`
   - `prompt-guidance.ts`
   - `detector.ts`
   - `index.ts`
4. Added Phase-3 forward-compat stubs:
   - `adjudicator-budget.ts`
   - `model-adjudicator.ts`
   - `adjudicator-config.ts` (loader/validator for `adapters/intent-adjudicator.json`)
5. Drift guard check:
   - no new API route introduced
   - no Gateway -> Engine payload shape change
   - no new SSE event type introduced
   - no hidden request-time provider/tool config channel introduced

### Entry 03 - Gateway Integration (Single Seam)

1. Updated `builds/typescript/gateway/server.ts` with a single `/message` integration seam:
   - load intent config (`preferences/intent-component.json` with safe defaults)
   - load lock snapshot per conversation turn (`WorkflowLockStore`)
   - resolve `IntentPlan` using message + skill catalog + active lock + tool names
   - apply lock transitions (`set`, `keep`, `clear`) only in `mode=active`
   - compose prompt in this order:
     - bootstrap prompt
     - persisted bound skills (project + conversation)
     - transient one-turn skills from intent
     - compact intent guidance block
2. Explicitly preserved no-drift constraints:
   - persistent skill bindings are never auto-mutated by intent inference
   - no off-contract metadata fields sent to Engine
   - approval and auth paths unchanged
3. Added intent audit events:
   - `intent.config.fallback`
   - `intent.detected`
   - `intent.plan.generated`
   - `intent.policy.confirm_required`
   - `intent.workflow_lock.set`
   - `intent.workflow_lock.renewed`
   - `intent.workflow_lock.cleared`
   - `intent.workflow_lock.expired`

### Entry 04 - Skill Pack and Runtime Artifacts

1. Added missing starter-pack validation skills:
   - `builds/typescript/memory/starter-pack/skills/intent-routing-check.md`
   - `builds/typescript/memory/starter-pack/skills/intent-profile-plan-check.md`
2. Added adjudicator runtime config scaffold:
   - `builds/typescript/adapters/intent-adjudicator.json`

### Entry 05 - Test Coverage Added

1. Added intent behavior tests:
   - `builds/typescript/intent_layer/intent-layer.test.ts`
   - validates profile inference for interview
   - validates lock `set`/`keep`/`clear` planning
   - validates pass-through fallback plan
2. Added lease-lock tests:
   - `builds/typescript/intent_layer/workflow-lock.test.ts`
   - validates TTL lease consumption and renewal
   - validates max-total-turns expiry
   - validates explicit clear behavior

### Entry 06 - Validation Run

1. Build validation:
   - Command: `npm run build` (executed in WSL at `builds/typescript`)
   - Result: pass
2. Test validation:
   - Command: `npm test` (executed in WSL at `builds/typescript`)
   - Result: pass (`4` test files, `19` tests)
3. Observed and fixed during validation:
   - initial type mismatch in `intent_layer/profile-resolver.ts` (token set typing)
   - one lock test expectation adjusted to isolate `max_total_turns` behavior from TTL expiry
4. Post-fix rerun:
   - build pass
   - test pass

### Entry 07 - Post-Integration Validation Fix (Request Schema)

1. User-reported issue: `Invalid request` when sending initial natural-language prompt from web flow.
2. Root cause:
   - `builds/typescript/adapters/gateway-openai-compatible.ts` required `metadata.client` when metadata existed.
   - web app commonly sends project-scoped metadata (`{ project: "<id>" }`) without `client`.
3. Fix applied:
   - made `metadata.client` optional while keeping strict metadata field allowlist.
   - preserved rejection for unknown metadata keys to avoid request-channel drift.
4. Added regression tests:
   - `builds/typescript/adapters/gateway-openai-compatible.test.ts`
   - verifies project-only metadata is accepted.
   - verifies unknown metadata keys are still rejected.
5. Validation rerun:
   - `npm run build` pass
   - `npm test` pass (`5` files, `21` tests)

## Validation Notes

1. Validation commands were executed through WSL because `npm` was unavailable on the Windows shell path in this environment.
2. No Gateway API contract shape changes introduced.
3. No Gateway -> Engine bounded contract drift introduced.
4. No persistent skill-binding auto-mutation introduced by inferred intent logic.

## Open Items

1. Workflow lock state is currently in-memory only (conversation-scoped for current process lifetime); persistent metadata storage can be added in a future increment if restart continuity is required.
2. Model-adjudicator is scaffolded but intentionally not active yet (`rules` resolver remains default, with safe fallback behavior).
