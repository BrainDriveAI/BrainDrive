---
name: milestone-check
description: Verify that a build phase's success criteria are met by running verification commands. Use when the user wants to check milestone progress, validate a build phase, or confirm readiness to proceed.
---

# Milestone Check Skill

Verify that a build phase's success criteria are met by running the verification commands and checking results.

**Framework Phase:** 4/5 - Build/Test
**Input:** Build plan with success criteria
**Output:** Pass/fail report with recommendations

## Trigger

`/milestone-check [phase name or number]`

Examples:
- `/milestone-check` - Check the current "In Progress" phase
- `/milestone-check 1` - Check Phase 1
- `/milestone-check "Planning Foundation"` - Check by phase name
- `/milestone-check all` - Check all phases

## Instructions

When this skill is triggered, verify that a build phase's success criteria are met.

### Process

1. **Locate Build Plan**
   - Check if user specified a project or path
   - Otherwise, infer from current working directory or conversation context
   - Look for `build-plan.md` in:
     - Current directory
     - `~/BrainDrive-Library/projects/active/[project]/build-plan.md`
   - If not found, ask user for location

2. **Find Target Phase**
   - If phase specified: find that phase by name or number
   - If no phase specified: find the phase marked "In Progress" or "Status: In Progress"
   - If "all" specified: iterate through all phases

3. **Run Baseline Checks**
   - Read `projects/production/braindrive-core/testing-baseline.md` from the Library
   - Always run all Tier 1 checks (T1-1 through T1-5)
   - Determine which Tier 2 checks apply based on files changed in this phase
   - If a `test-plan.md` exists for the project, read it for phase-specific verification commands
   - Report baseline results separately from feature-specific criteria

4. **Extract Success Criteria**
   Look for the `### Success Criteria` section under the phase. Parse the bash code blocks:

   ```markdown
   ### Success Criteria

   ```bash
   # Description of what we're checking
   command to run
   # Expected: description of expected result
   ```
   ```

   Extract:
   - **Description** - The comment line before the command
   - **Command** - The actual bash command(s)
   - **Expected** - The "Expected:" comment describing success

5. **Run Verification**
   For each criterion:
   - Display what we're checking
   - Run the command using Bash tool
   - Capture the output and exit code
   - Compare against expected result

6. **Determine Pass/Fail**
   A criterion passes if:
   - Exit code is 0 (unless expected to fail)
   - Output matches the expected description
   - Use judgment for fuzzy matches (e.g., "files exist" = ls returns without error)

7. **Report Results**
   Generate a clear report showing:
   - Each criterion checked
   - Pass/fail status
   - Actual output (truncated if long)
   - Summary with counts
   - Recommendation (proceed, fix, or investigate)

### Handling Different Criteria Formats

**Bash commands with expected output:**
```bash
# Check that config exists
cat ~/.config/app/settings.json | jq '.version'
# Expected: "1.0.0"
```
→ Run command, compare output to "1.0.0"

**File existence checks:**
```bash
# Required files exist
ls src/index.ts src/config.ts
# Expected: both files listed
```
→ Run ls, pass if exit code 0

**Process/service checks:**
```bash
# Server is running
curl -s http://localhost:3000/health
# Expected: {"status": "ok"}
```
→ Run curl, check for expected JSON

**Manual verification notes:**
```bash
# UI displays correctly
# Expected: Manual check - open browser and verify layout
```
→ Skip automated check, note as "Manual verification required"

**Table format (alternative):**
```markdown
| Criterion | Verification | Expected Result |
|-----------|--------------|-----------------|
| Build succeeds | `npm run build` | Exit code 0 |
```
→ Parse table, run verification column, check expected

### Output Format

```markdown
## Milestone Check: [Phase Name]

**Build Plan:** [path to build-plan.md]
**Phase:** [phase number and name]
**Status:** [current status from build plan]
**Verification:** Independent (commands run by this check)

---

### Test Results

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | [description] | ✅ PASS | [brief note] |
| 2 | [description] | ❌ FAIL | [what went wrong] |
| 3 | [description] | ⏭️ SKIP | Manual verification required |

### Coverage Report (if applicable)

| Metric | Current | Threshold | Status |
|--------|---------|-----------|--------|
| Statements | X% | 70% | ✅/❌ |
| Branches | X% | 70% | ✅/❌ |
| Functions | X% | 70% | ✅/❌ |
| Lines | X% | 70% | ✅/❌ |

---

### Baseline Results

| Check | Status | Notes |
|-------|--------|-------|
| T1-1: Backend tests | ✅/❌ | [note] |
| T1-2: Frontend tests | ✅/❌ | [note] |
| T1-3: Frontend builds | ✅/❌ | [note] |
| T1-4: Frontend lint | ✅/❌ | [note] |
| T1-5: Security patterns | ✅/❌ | [note] |
| [T2-N: conditional] | ✅/❌/⏭️ | [if applicable] |

### Summary

**Criteria Passed:** X/Y
**Criteria Failed:** Z
**Baseline:** ✅ PASS / ❌ FAIL
**Coverage Gate:** ✅ PASS / ❌ FAIL / ⏭️ N/A
**Test Quality:** ✅ PASS / ❌ GAPS / ⏭️ N/A
**Skipped:** W criteria (manual)

### Recommendation

[One of:]
- ✅ **PROCEED** - All criteria met AND coverage gate passed. Ready to move to next phase.
- 🔧 **FIX** - X criteria failed. Address issues before proceeding.
- 📊 **COVERAGE** - Tests pass but coverage below 70%. Add more tests.
- 🔍 **INVESTIGATE** - Mixed results. Review failures before deciding.
- 👀 **MANUAL CHECK** - Automated checks pass but manual verification needed.

### Failed Criteria Details

[For each failure, show:]
#### [Criterion name]
**Command:** `[command that was run]`
**Expected:** [what was expected]
**Actual:** [what actually happened]
**Suggestion:** [how to fix]
```

### After Verification

Based on results:

**All Pass:**
- Congratulate and confirm ready for next phase
- Offer to update build-plan.md status to "Complete"
- Remind about human checkpoint if this phase requires one

**Some Failures:**
- List specific failures with context
- Suggest fixes if obvious
- Ask if user wants to proceed anyway or fix first

**All Fail:**
- Something may be fundamentally wrong
- Check if build plan is outdated or environment not set up
- Don't update status

### Updating Build Plan Status

If user confirms phase is complete:
- Update the phase status from "In Progress" to "Complete"
- Add completion date if format supports it
- Mark next phase as "In Progress" if appropriate

## Example Session

```
User: /milestone-check

Claude: ## Milestone Check: Phase 1 - Planning Foundation

**Build Plan:** ~/BrainDrive-Library/projects/active/claude-code-workflow/build-plan.md
**Phase:** 1 - Planning Foundation
**Status:** Complete

---

### Results

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Planning skills exist | ✅ PASS | All 4 files found |
| 2 | Context management working | ✅ PASS | AGENT.md has expected content |

---

### Summary

**Passed:** 2/2 criteria
**Failed:** 0 criteria

### Recommendation

✅ **PROCEED** - All criteria met. Phase 1 is verified complete.

The build plan already shows this phase as Complete.
Would you like to check Phase 2 (Development Automation Skills)?
```

## Independent Verification Requirement

> **CRITICAL:** Never trust self-reported "tests passing" - always run verification independently.

Research shows AI-generated code has **75% more logic errors** than human-written code. The most common failure mode is AI agents reporting success without actually verifying.

### Verification Rules

1. **Always run tests yourself** - Don't accept "I ran the tests and they pass"
2. **Check actual output** - Verify the command output matches expectations
3. **Run the full suite** - Not just the tests for changed files
4. **Capture evidence** - Log command output in the milestone report

### What NOT to Accept as Verification

- "The tests should pass now"
- "I've verified this works"
- "This matches the expected behavior"
- "The implementation is complete"

### What TO Accept

- Actual test command output showing pass/fail counts
- Build output showing successful compilation
- Coverage report with actual percentages
- Lint output showing no errors

## Coverage Gate

If the project has test coverage tooling configured, enforce a minimum coverage threshold.

### Default Threshold: 70%

```bash
# Check coverage (adjust command for project's test runner)
npm run test:coverage 2>&1 | grep -E "All files|Statements|Branches|Functions|Lines"
# Expected: All metrics >= 70%
```

### Coverage Check Process

1. Run coverage command for the project
2. Parse output for coverage percentages
3. Compare against threshold (default 70%, or project-specific if defined)
4. **FAIL the milestone if coverage is below threshold**

### Reporting Coverage

Add a coverage section to the milestone report:

```markdown
### Coverage Report

| Metric | Current | Threshold | Status |
|--------|---------|-----------|--------|
| Statements | 82% | 70% | ✅ PASS |
| Branches | 68% | 70% | ❌ FAIL |
| Functions | 91% | 70% | ✅ PASS |
| Lines | 80% | 70% | ✅ PASS |

**Overall:** ❌ FAIL - Branch coverage below threshold
```

## Test Quality Check

Beyond coverage percentage, verify that tests are meaningful:

### Tests-First Compliance
- If a `test-plan.md` exists, check that the tests specified for this phase actually exist
- Verify test files are present for new/modified modules (not just pre-existing tests passing)
- Check that property-based tests exist for invariants defined in the spec

### Test Quality Signals

**Good signs:**
- Tests fail when the implementation is broken (not just trivially passing)
- Property-based tests cover invariants from the spec
- Integration tests exercise actual API endpoints, not just mocked layers
- Edge cases from the spec have corresponding test cases

**Red flags:**
- Tests only assert `true` or test trivial getters/setters
- All tests are unit tests with heavy mocking (no integration coverage)
- Test count is high but coverage of new code is low
- No tests for error paths or failure modes

### Reporting Test Quality

Add to the milestone report:

```markdown
### Test Quality Assessment

| Check | Status | Notes |
|-------|--------|-------|
| Tests exist for new/modified files | [Pass/Fail] | [Which files lack tests] |
| Spec acceptance criteria have tests | [X/Y covered] | [Which AC lack tests] |
| Invariants have property tests | [X/Y covered] | [Which need property tests] |
| Edge cases have tests | [X/Y covered] | [Which edge cases untested] |
```

## Notes

- Run verification commands carefully - some may have side effects
- For destructive or slow commands, ask before running
- If a command requires sudo or elevated permissions, note it but don't run
- Keep output concise - truncate long command outputs
- When in doubt about pass/fail, ask the user
- This skill is about verification, not fixing - report issues, don't auto-fix
- **Never mark a milestone complete without running verification commands**
- **Never accept AI self-reports as evidence of passing tests**
