---
name: test-plan
description: Generate a test plan from a feature spec and build plan. Defines baseline checks, property-based tests, feature tests by phase, and verification commands. Use when the user wants to plan testing strategy before building.
---

# Test Plan Skill

Use this skill to generate a test plan that defines how a feature will be verified. The test plan sits between the build plan and actual implementation — it specifies what tests to write and what commands to run.

**Framework Phase:** 3 - Test Planning (between Plan and Build)
**Output Location:** `BrainDrive-Library/projects/active/[project-name]/test-plan.md`

## Trigger

`/test-plan [optional: project name]`

## Pipeline Position

```
/interview → /feature-spec → /plan → /test-plan → build → /milestone-check → /retro
```

The test plan is the **contract** between planning and verification. The build plan says *what* to build. The test plan says *how to prove it works*. The milestone check *executes* that proof.

## Instructions

When this skill is triggered, generate a test plan based on three inputs:

1. **The spec** (`spec.md`) — invariants, acceptance criteria, edge cases, test strategy, security risk level
2. **The build plan** (`build-plan.md`) — phases, API endpoints, database schema, components
3. **The testing baseline** (`projects/production/braindrive-core/testing-baseline.md`) — always-run checks for BrainDrive-Core

### Process

1. **Read Inputs**
   - Read `spec.md` from the project directory
   - Read `build-plan.md` from the project directory
   - Read `projects/production/braindrive-core/testing-baseline.md` from the Library root
   - If any are missing, ask the user for the location or note as `[TODO]`

2. **Determine Baseline Applicability**
   - All Tier 1 checks always apply
   - Check which Tier 2 checks apply based on what the build plan touches:
     - Touching `migrations/` or `models/`? → T2-1, T2-2
     - Adding new migrations? → T2-3
     - Touching `frontend/src/`? → T2-4
     - Touching `backend/app/`? → T2-5
     - Touching encryption? → T2-6
   - Check which global properties (G-1 through G-8) this feature affects

3. **Extract Properties and Invariants**
   - Pull invariants from the spec's "Invariants & Edge Cases" section
   - Translate each invariant into a formal property statement (e.g., `decrypt(encrypt(x, k), k) == x`)
   - These become the property-based test definitions
   - If the spec has no invariants section, identify properties from:
     - Roundtrip operations (save/load, encode/decode, encrypt/decrypt)
     - Idempotent operations (applying same change twice)
     - Ordering invariants (sort stability, priority ordering)
     - Boundary conditions (max/min values, empty inputs)
     - Security boundaries (user isolation, permission checks)

4. **Map Tests to Phases**
   For each phase in the build plan:
   - Identify what acceptance criteria from the spec are covered by this phase
   - Determine test types needed:
     - **Unit** — Pure logic, transformations, utilities, validators
     - **Integration** — API endpoints, database operations, service interactions
     - **Property-based** — Invariants (Hypothesis for Python, fast-check for TypeScript)
     - **E2E** — Critical user flows (only if applicable)
   - Specify exact test files to create
   - Map each test back to a spec reference (user story, acceptance criterion, or invariant)

5. **Catalog Edge Cases**
   - Pull from spec's edge case section
   - Add standard edge cases for the types of operations involved:
     - Empty/null inputs for string operations
     - Zero/negative values for numeric operations
     - Concurrent access for shared resources
     - Network failure for external calls
     - Unicode/special characters for text processing
     - Maximum length inputs for bounded fields

6. **Assess Security Testing Needs**
   - Check the spec's security risk level:
     - **Low** — Baseline checks sufficient
     - **Medium** — Add targeted tests for identified threats
     - **High** — Require security-specific tests for each threat in the spec
   - Reference the security-critical modules from the baseline

7. **Generate Test Plan**
   - Read `system/templates/test-plan-template.md`
   - Fill in all sections
   - Compile verification commands for each phase (used by `/milestone-check`)
   - Calculate test architecture summary (counts by type)

8. **Write to File**
   - Save to `projects/active/[project-name]/test-plan.md`

9. **Review with User**
   - Summarize what's covered
   - Highlight any gaps or open items
   - Confirm the test architecture makes sense

### Test Plan Quality Checklist

Before presenting the plan, ensure:

- [ ] **Baseline checks** are fully populated (all Tier 1, applicable Tier 2)
- [ ] **Every acceptance criterion** in the spec has at least one corresponding test
- [ ] **Every invariant** has a property-based test definition
- [ ] **Edge cases** are cataloged with expected behavior
- [ ] **Security tests** match the risk level from the spec
- [ ] **Each phase** has tests listed to write BEFORE implementation
- [ ] **Verification commands** are exact (copy-paste runnable)
- [ ] **Test files** are named and located consistently with existing test structure
- [ ] **Open items** capture any test infrastructure not yet set up

### Test Type Selection Guide

Use this to decide what type of test to write:

| Situation | Test Type | Framework |
|-----------|-----------|-----------|
| Pure function, no side effects | Unit | pytest / Jest |
| "This must be true for ALL inputs" | Property-based | Hypothesis / fast-check |
| API endpoint behavior | Integration | pytest + AsyncClient / supertest |
| Database CRUD operations | Integration | pytest + async session |
| React component rendering | Component | Jest + testing-library |
| Full user flow across pages | E2E | Playwright |
| Security boundary | Integration + Property | pytest + Hypothesis |
| Error handling / failure modes | Unit + Integration | pytest / Jest |

### Property Identification Patterns

When specs don't explicitly list invariants, look for these patterns:

| Pattern | Property Type | Example |
|---------|--------------|---------|
| Encode/decode, encrypt/decrypt, serialize/deserialize | Roundtrip | `decode(encode(x)) == x` |
| Save/load, create/read | Persistence roundtrip | `read(create(x).id) == x` |
| Apply setting, save, reload | Idempotency | `save(save(x)) == save(x)` |
| User A's data vs User B's data | Isolation | `get(user_a_token, user_b_resource) == 404` |
| Rate limiter, quota system | Threshold | `allow(n) == True, allow(n+1) == False` |
| Sorting, ordering | Stability | `sort(sort(x)) == sort(x)` |
| Input validation | Rejection | `validate(invalid_input)` raises error, never passes silently |

### Handling Missing Information

- If the spec has no invariants section, derive properties from the patterns above
- If the spec has no test strategy section, default to: unit + integration for all, property-based for security-critical modules
- If the build plan has no API endpoints, skip integration test stubs
- Mark any assumptions as `[ASSUMED: ...]` so the user can validate

### Output

The skill outputs:
1. A complete `test-plan.md` file saved to Library
2. A summary of test coverage (counts by type, mapped to spec)
3. Any open items or infrastructure needed
4. Recommendation for next step (begin Phase 1 by writing the listed tests first)

## Example Output Summary

```
## Test Plan Generated

I've created `BrainDrive-Library/projects/active/settings-encryption/test-plan.md` with:

**Baseline:**
- All 5 Tier 1 checks apply
- Tier 2: T2-5 (backend coverage), T2-6 (encryption integrity)

**Properties Defined:**
- P-1: Encryption roundtrip (any string)
- P-2: Unique ciphertexts (nonce randomness)
- P-3: Wrong key rejection (never silent failure)

**Tests by Phase:**
- Phase 1: 4 property tests + 3 integration tests (write before implementing)
- Phase 2: 6 integration tests + 2 unit tests
- Phase 3: 3 security tests + coverage audit

**Architecture:**
- 6 new test files, 18 total test cases
- Frameworks: pytest + Hypothesis (backend)

**Open Items:**
- [ ] Install Hypothesis: `pip install hypothesis`
- [ ] Add pytest-cov: `pip install pytest-cov`

**Next Step:**
Begin Phase 1 by writing the 7 tests listed. Then implement until they pass.
Run `/milestone-check 1` after Phase 1 to verify.
```

## Notes

- The test plan does NOT write actual test code — it specifies what to write
- The test plan does NOT run anything — that's `/milestone-check`'s job
- The test plan does NOT decide architecture — that's `/plan`'s job
- Focus on tests that catch real bugs, not tests that inflate coverage
- Property-based tests are highest leverage for security-critical code
- Always map tests back to spec references so coverage is traceable
- Update the test plan if the build plan changes during implementation
