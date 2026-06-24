# Fitness Interview

*Procedure for filling `spec.md` through conversation.*

## Preservation Rule

Update sections in place in `spec.md`; never replace the whole file. Always keep every section header, every italic section description, every `**Status:**` line, every `**Last updated:**` line, and `## Changelog`. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

Build a clear health and fitness picture and capture the owner's goals, current reality, constraints, preferences, assumptions, success criteria, and missing information.

## When to Run

- The Fitness spec is empty or materially stale.
- The owner wants to clarify fitness goals before planning.
- New activity, nutrition, sleep, stress, injury, medical, schedule, or lifestyle context could materially change the project direction.

## Method

Read `me/profile.md`, the Fitness `spec.md`, the Fitness `plan.md`, and relevant child-app summaries before asking broad setup questions. Summarize the known context briefly and ask what is missing, stale, or unconfirmed.

Use one primary question per turn during the first-run interview. Reply shape: mirror one useful owner signal in one sentence, name the one missing context item you need with wording like "The missing context I need is..." or "The unknown I need to resolve is...", ask exactly one question, then stop. This question shape applies only while you still need another intake answer; artifact-writing stop rules below override it. Use at most one question mark in the whole reply. Do not use numbered or bulleted question lists. Do not add parenthetical subquestions or question marks inside examples. Do not turn one question into a category checklist such as "what about A, B, and C?" For Fitness, duration, equipment, target date/event, running history, injuries, schedule, and preferences are separate turns. Do not ask "and do you..." follow-ups in the same reply. Do not ask a broad question and then restate it as a second example question; for example, avoid "What's your running background? Have you run before?" If examples help, make them non-question fragments inside the same sentence. If several facts are missing, ask only for the single fact that most changes the next step. After 4-5 owner answers, write provisional spec and plan updates with unknowns instead of continuing intake. Mirror concrete money, time, health, safety, boundary, deadline, or risk constraints in the next reply before asking another question. For vague starts, mirror "get healthier" and "move more" before narrowing. For injury-adjacent starts, mirror the knee injury, safe next steps, and not-diagnosis boundary before narrowing.

Never ask "Does that capture it?" during the first-run interview when you are also asking for another missing fact. If you summarize, summarize in statements, then ask at most one question. Do not use examples as a second hidden question; write examples as fragments without a question mark.

Every intake-question reply must start by mirroring one concrete phrase from the owner's immediately previous message. Use this shape: `<mirrored owner phrase>. The missing context I need is <one missing thing>: <one question>?` Do not begin a reply with only a question or only "The missing context I need is..." This does not apply when the next action is writing or updating `spec.md` and `plan.md`.

Mirror exact quantities and safety language from the owner. Reflect the owner's own numbers and wording back rather than softening them into generic terms — say the owner's specific figure or phrase, not a paraphrase of it. When the owner raises an injury or safety concern, preserve their framing and keep the not-diagnosis boundary.

Never write two question marks in one reply. If the owner already gave you a capacity or constraint, mirror it in one sentence, then name the one missing context item and ask a single question about it.

On the first Fitness reply, mirror the owner's concrete outcome phrases before asking the one narrowing question. Repeat at least one of their stated outcomes before asking for the current baseline.

Never ask the same missing-context question twice. If the owner answers with adjacent useful information instead of the exact detail you asked for, record the exact detail as unknown and move to a different high-impact question or proceed. Do not repeat the same missing-context label across replies. If you asked for one detail and the owner instead gives related context, mark the asked-for detail unknown and move to a different high-impact question rather than re-asking. Once the owner has provided a goal, a capacity or constraint, a preference, and a success criterion, write the provisional Fitness spec and plan with remaining details marked unknown instead of continuing intake.

When the owner gives a success criterion such as consistency without burnout or progress without obsession, stop the interview and write/update the Fitness spec and plan. Do not ask another intake question after a success criterion if at least three owner facts are already known. If you reply before writing, use a no-question closing that names what you now have enough to write.

## Failure Examples

Bad: asking for running history again after the owner answers with workout-style preferences. Good: mark running history unknown, use the preferences they gave, then ask a different single question or proceed.

Bad: re-asking for typical schedule after the owner answers with adjacent context. Good: mark schedule unknown, use what they gave as constraints, then write provisional artifacts if the spec and plan can already be useful.

Bad: paraphrasing the owner's exact numbers or phrases into generic terms. Good: mirror the owner's own words exactly.

Bad: asking what a vague goal word like "healthier" means in four consecutive replies. Good: treat the goal as provisional and write the spec and plan once the owner gives a success criterion.

Start with the owner's presenting goal, then map the full health and fitness landscape over multiple adaptive turns: current activity, nutrition patterns, sleep, stress, injuries, physical constraints, medications or health constraints they volunteer, schedule, equipment, experience level, and past attempts. Do not ask for the whole landscape at once; choose the next most useful missing piece.

Adapt follow-ups to the owner's starting position. Watch for starting from scratch, weight or fat-loss focus, strength or performance focus, health-adjacent concern, busy schedule or low adherence, returning after lapse, experienced optimizer, and cross-page constraints. If more than one applies, name the overlap and ask which one should drive the first plan.

Probe for what the owner actually does, not what they intend to do. Surface all-or-nothing thinking, sleep or stress blockers, event-driven motivation, shame, injury fear, and nutrition patterns that could make a plan fail. Ask for health documents only when they could materially improve the Fitness plan, and make them optional.

Classify new facts before writing: stable cross-project facts belong in `me/profile.md` with confirmation; Fitness goals/current state/constraints/preferences/success criteria belong in `spec.md`; ordered next steps, decisions, timing, status, and child-app handoffs belong in `plan.md`; detailed logs, evidence, reports, rules, calculations, and app state belong in the relevant child app when one exists.

Every first-run spec update must include a concise BrainDrive experience note. Cover setup/model readiness in owner language; provider credentials, API keys, and tokens as redacted and not stored in owner artifacts; sidebar/page access to `AGENT.md`, `spec.md`, and `plan.md` instead of raw file paths; owner editability; return/resume from current artifacts; plain-language errors and recovery; support logs/support bundles with secrets redacted; visible progress states such as thinking, writing the spec, writing the plan, saving, and updating the page; quality scoring for interview/spec/plan/propagation; and replay across Finance, Fitness, Career, Relationships, New Project, and Your Agent with page-specific quality.

## Done Criteria

`spec.md` has useful owner-specific content, success criteria, important assumptions and unknowns, and high-stakes health claims are not presented beyond the available evidence.

## After Running

Update `spec.md`, summarize material changes, propose `me/profile.md` updates only for confirmed stable cross-project facts, add todos only for concrete next actions, and return to Fitness scope before proposing planning.

## What This Procedure Is Not

It is not medical advice, diagnosis, treatment, medication guidance, symptom triage, daily logging as a required page behavior, or a substitute for a clinician, dietitian, physical therapist, or qualified coach.
