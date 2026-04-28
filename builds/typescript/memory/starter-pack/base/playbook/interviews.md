# Interviews — How to Fill a Spec

Read this when running an interview to fill a `Pre-interview` or `Partial` spec.md.

## Universal interview rules

- **One question at a time.** Listen to the answer. Follow up on what matters. Do NOT bundle 3+ questions in one message — that's a form, not a conversation.
- **Landscape first, specifics second.** The owner usually comes with a specific concern, trigger, or situation. That's the entry point, not the starting point. Build the full picture first, then circle back to the trigger with real context.
- **Never accept vague answers.** "I want to get healthier" / "I'm feeling stuck" / "communication issues" — none of these are enough. Probe until specific.
- **Confirm as you go.** Play back high-stakes sections (What You Want, Where You Are, What's In The Way) and get confirmation before moving on. "Here's what I'm hearing about your finances: [summary]. Sound right?"
- **Confirm user stories before writing the plan.** "Here's what I'm hearing you want — [stories]. Does this capture it?" The plan is built to serve these stories. If stories are wrong, plan solves the wrong problem.
- **~5 minutes is the target.** Adapt — detailed answers get there fast; vague answers need more probing. Relationships and life-transition specs often run longer; that's fine.
- **The user stories are the most important output.** They should be specific enough that the owner reads them in 6 months and thinks "yes, that's exactly what I want and why."

## "What makes this spec good" rubric

A good spec passes these tests:

- **User stories use the owner's exact words** — quote, don't paraphrase.
- **Where You Are has 3+ concrete data points** — numbers, situations, names, not narratives.
- **Specificity rewarded.** "$220/month in interest" beats "high interest rates." "We argue every Sunday about chores" beats "communication issues."
- **Obstacles are specific** — "Lifestyle inflation since the raise" not "spending too much."
- **Gaps separated by impact** — "before the plan is complete" (could change direction) vs "worth exploring later" (interesting but won't shift today's plan).

## Per-domain blind spots and branches

### Finance

**Map first:** income, expenses, debt, savings, investments, employer benefits — before diving into the trigger. Show the math always: "$12K at 22% APR is $220/month in interest alone."

**Common blind spots:**
- Partner alignment on money — if a partner is mentioned, often the biggest unlock
- Employer benefits left on the table (401K match, HSA, stock options)
- Emotional avoidance of real numbers ("I don't want to look")
- Lifestyle inflation — income up, savings flat

**Common branches:** debt crisis (payoff strategy + interest math) · growth/investing (goals, risk tolerance, timeline) · life transition like new job/divorce/baby/house (decisions that can't wait — health insurance, tax filing, settlement deadlines) · general anxiety (make the invisible visible — where does the money actually go).

### Career

**Map first:** current role, industry, tenure, income, skills, satisfaction, trajectory. Trigger ≠ starting point.

**Common blind spots:**
- Impostor syndrome disguised as "exploring options"
- Golden handcuffs — good salary keeping them in a role they've outgrown
- Haven't told anyone — wanting promotion but never had a career conversation with manager
- Vesting cliffs and timelines unmapped
- Partner impact — career changes affect households

**Common branches:** promotion/advancement (gaps between current and target role) · career pivot (transferable skills, financial runway, realistic timeline) · escape from toxic / burnout (what they NEED vs what they're RUNNING from — flag professional support if trauma symptoms surface) · "I don't know what I want" (what energizes them, what drains them, pattern recognition).

### Fitness

**Map first:** activity, diet, sleep, stress, injuries, physical constraints, lifestyle. A weight-loss goal looks different when sleep is broken.

**Common blind spots:**
- All-or-nothing thinking ("if I can't go 5 days, why bother?")
- Sleep quality affecting energy and motivation
- Stress eating or skipping meals — nutrition drives results more than exercise
- Event-driven motivation that fades after the wedding/vacation

**Common branches:** weight loss (sustainable habits, relationship with food) · strength/performance (current baseline, realistic progression, injury prevention) · energy/wellbeing (may not need a "program" at all) · return from injury (when fear of re-injury is the primary blocker rather than physical limitation, flag mental health support — sports psychologist, therapist with injury-recovery experience — as a Phase 1 path-changing gap).

### Relationships

**Start with landscape, not the problem.** Get the full picture first: who are the important people, how are those relationships going generally, what patterns show up across them. Then circle back to the trigger.

**Common blind spots:**
- Surface issue isn't the real one — "the dishes" is rarely about the dishes
- Patterns across relationships — if it keeps happening with different people, the pattern is theirs
- Unspoken expectations — things they want but have never said out loud
- Avoidance disguised as patience ("I'm giving them space" = "I'm avoiding the conversation")
- They may not realize what healthy relationships look like

**Common branches:** specific conflict (landscape first, then pattern behind the conflict, not the incident) · general dissatisfaction (map relationships, look for draining vs energizing) · growing apart (what changed, what they want instead) · family dynamics (boundaries, expectations, what they can actually control) · "I don't know what's wrong" (landscape map usually reveals it).

**Sensitive topics:** if abuse, self-harm, or acute mental-health crisis surfaces during the interview, STOP the interview immediately and read `playbook/crisis.md`. The interview resumes in a future conversation only after the owner is grounded.

### New-project (catch-all custom domains)

You don't have domain-specific seeds. Adapt structure to what the owner brings.

**"Where You Are" varies by project type:**
- Home/practical (renovation, trip planning) → scope, budget, timeline, who's involved
- Creative (writing, painting, music) → what exists already, what's stuck
- Learning (a new skill) → current level, time commitment, motivation
- Life transition (move, divorce, processing grief) → emotional AND practical landscape

**Common blind spots by type:**
- Creative → overthinking, perfectionism, waiting for inspiration
- Practical → underestimated complexity, unclear budget, scope creep
- Learning → no definition of "good enough"
- Life transition → conflating urgency with importance, trying to solve everything at once

**Multiple interests:** if owner mentions two (e.g., drawing AND baking), probe connections before choosing which to develop. First-mentioned isn't always most important.

**Deeply personal topics** (grief, addiction, life crisis): be honest — "this doesn't fit a neat template. Let's figure out what progress looks like for you." Methodology still applies. Always ask about support systems. For acute crisis, follow `playbook/crisis.md`.

## When the spec is "enough" — completion checklist

The spec is ready to commit (Spec State → `Complete`, then write plan, then flip AGENT.md Status to `Active — Phase 1`) when ALL of these are true:

- [ ] At least one user story captured in the owner's exact words under "What You Want"
- [ ] "Where You Are" has 3+ concrete data points (numbers, names, situations — adapted to domain)
- [ ] "What's In The Way" has at least 1 specific obstacle
- [ ] Owner has confirmed the user story(s) by playback
- [ ] Immediate first step is nameable

If any are false, keep interviewing. If all true: `memory_write` the full spec.md (Pre-interview → Complete is a full rewrite, not a surgical edit), then write plan.md, then flip Status.

**No placeholders in committed sections.** If you don't have info for a section, leave the original `*To be filled through conversation.*` text. Don't write "TODO" or "[FILL THIS LATER]" — that's worse than the placeholder.

---

## Plan lifecycle (after the spec is Complete)

### Phase transitions

Advance Phase N → Phase N+1 when ALL of these are true:
- All Phase N steps marked complete
- Owner has reported the corresponding outcome (or sufficient time has passed for inference)
- Phase N+1 doesn't depend on info that's still missing

**When advancing:**
1. Mark Phase N status: `Complete` in plan.md
2. Mark Phase N+1 status: `In progress` in plan.md
3. Update `**Current Phase**` line at top of plan.md
4. Update AGENT.md `Status:` line: `Active — Phase N+1 — [brief description]`
5. Update profile if a goal milestone was hit
6. Tell the owner: "You wrapped Phase 1. Here's what Phase 2 looks like — [summary]."

### When the owner reports a step done

If they say "I did X" / "I finished X":

1. Find that step in the Roadmap
2. Mark it `[x]` complete with date: `- [x] Tracked spending for 1 week. (2026-04-22)`
3. Add the action item to `me/todo.md` Completed section if it was active there
4. Acknowledge concretely: "Nice — you've finished step X. The next move is Y."
5. If this completes a phase, follow Phase Transition Rules above

**Skipped-phase reports** ("I already paid off the debt!" while Current Phase is Phase 1):
- Acknowledge, mark that step done
- ASK if Phase 1 + Phase 2 milestones were also actually completed (sometimes a single big achievement legitimately skips phases; sometimes the owner is misremembering)
- Update Current Phase only after confirming

**Owner didn't do something they said they would:**
- Don't shame. Check what changed.
- If the obstacle is real, update `<project>/spec.md` "What's In The Way" section.
- Adjust the plan if needed.
