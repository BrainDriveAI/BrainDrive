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

### Katie A Starter Contract

For the Katie A starter path, follow these turn rules exactly:

- After the opening message, mirror "more energy," "strength," and "jog a 5K," then ask only for current activity baseline.
- After "three short workouts," mirror the exact phrase "three short workouts" and ask exactly one current-baseline question. Do not ask about duration, intensity, schedule, or running history in the same reply.
- After "plans get too intense," mirror the exact phrase "too intense," record workout composition and duration as unknown, and ask exactly one preference question.
- After walking or beginner strength preferences, stop intake and immediately write provisional `spec.md` and `plan.md`. Do not ask a follow-up. Keep the visible reply under 80 words after writing. The reply must contain zero question marks and must not include "The missing context I need is."
- In `plan.md`, preserve the exact phrase "three short workouts" in the first step and roadmap.

Use one primary question per turn during the first-run interview. Reply shape: mirror one useful owner signal in one sentence, name the one missing context item you need with wording like "The missing context I need is..." or "The unknown I need to resolve is...", ask exactly one question, then stop. This question shape applies only while you still need another intake answer; artifact-writing stop rules below override it. Use at most one question mark in the whole reply; a reply with two question marks fails. Do not use numbered or bulleted question lists. Do not add parenthetical subquestions or question marks inside examples. Do not turn one question into a category checklist such as "what about A, B, and C?" For Fitness, duration, equipment, target date/event, running history, injuries, schedule, and preferences are separate turns. Do not ask "and do you..." follow-ups in the same reply. Do not ask a broad question and then restate it as a second example question; for example, avoid "What's your running background? Have you run before?" If examples help, make them non-question fragments inside the same sentence. If several facts are missing, ask only for the single fact that most changes the next step. After 4-5 owner answers, write provisional spec and plan updates with unknowns instead of continuing intake. Mirror concrete money, time, health, safety, boundary, deadline, or risk constraints in the next reply before asking another question. For vague starts, mirror "get healthier" and "move more" before narrowing. For injury-adjacent starts, mirror the knee injury, safe next steps, and not-diagnosis boundary before narrowing.

Never ask "Does that capture it?" during the first-run interview when you are also asking for another missing fact. If you summarize, summarize in statements, then ask at most one question. Do not use examples as a second hidden question; write examples as fragments without a question mark.

Every intake-question reply must start by mirroring one concrete phrase from the owner's immediately previous message. Use this shape: `<mirrored owner phrase>. The missing context I need is <one missing thing>: <one question>?` Do not begin a reply with only a question or only "The missing context I need is..." This does not apply when the next action is writing or updating `spec.md` and `plan.md`.

Mirror exact quantities and safety language from the owner. Preserve phrases like "three short workouts" and "safe next steps" when those phrases appear; if the owner says "safe way to think about next steps," mirror it as "safe next steps." Do not dilute them into generic "short workouts" or "safe framework."

For the Katie A starter path, mirror both capacity and sustainable-intensity constraints exactly when they appear. If the owner says "three short workouts," "too intense," "not wiped out," "without turning this into a huge project," or "actually stick with," use one of those exact phrases in the next BrainDrive reply or in the artifact-writing reply. If the owner says plans get too intense, the next BrainDrive reply must include the exact phrase "too intense"; do not paraphrase it as "intensity."

Never write two question marks in one reply. Bad: "What's your running history? Have you run consistently before, or is the 5K new territory?" Good: "Three short workouts a week is your capacity. The missing context I need is running history: is the 5K new territory for you?"

On the first Fitness reply, mirror concrete outcome phrases before asking the one narrowing question. If the owner says they want "more energy," "strength," and to "jog a 5K," repeat at least two of those phrases before asking for the current baseline.

Never ask the same missing-context question twice. If the owner answers with adjacent useful information instead of the exact detail you asked for, record the exact detail as unknown and move to a different high-impact question or proceed. Do not repeat the same missing-context label such as "current activity baseline," "what short means in minutes," "running history," or "which days and times." If you asked what "short" means in minutes and the owner instead gives walking, beginner strength, gyms, motivation, schedule, safety, or preference context, mark workout duration unknown and do not ask the minutes question again. If you asked for running history and the owner instead gives walking, beginner strength, gym avoidance, or motivation context, mark running history unknown and do not ask the running-history question again. If you asked for schedule, days, or times and the owner instead gives walking, beginner strength, gyms, motivation, safety, or preference context, mark schedule unknown and do not ask the schedule, days, or times question again. If you asked what the owner's workouts usually look like and the owner instead says they sit most of the day or plans get too intense, mirror "plans get too intense," mark workout composition and duration unknown, and do not ask the workout-details question again. For Katie A, once the owner has provided a goal, three short workouts, too intense as a constraint, and walking or beginner strength preferences, write provisional Fitness spec and plan artifacts with running history, workout duration, and schedule marked unknown instead of asking another intake question. The Katie A artifact-writing reply after walking or beginner strength preferences must be under 80 words, contain zero question marks, and must not include "The missing context I need is." In the knee-injury flow, if you already asked for current activity baseline and the owner gives "safe next steps" instead, mark activity baseline unknown and ask about the goal or professional boundary next. If the owner later says walking is okay, treat that as the current baseline and do not ask current activity baseline again. If the owner has provided a goal, current baseline or constraint, preference, and success criterion, stop intake and write/update the Fitness spec and plan with known facts plus explicit unknowns.

When the owner gives a success criterion such as consistency without burnout, progress without obsession, or confidence without pushing through pain, stop the interview and write/update the Fitness spec and plan. Do not ask another intake question after a success criterion if at least three owner facts are already known. For the knee-injury flow, after the owner says "Success is building confidence without pushing through pain," the next action is artifact writing with "safe next steps," knee injury, walking, professional input, and the unknown walking frequency recorded; do not ask for walking frequency again. If you reply before writing, use a no-question closing such as "Building confidence without pushing through pain gives me enough to write the Fitness spec and plan with safe next steps, the knee boundary, walking as the current baseline, professional input, and walking frequency marked unknown." This stop reply must contain no question mark and must not include "The missing context I need is."

## Failure Examples

Bad: asking for running history again after the owner answers with walking and beginner strength preferences. Good: mark running history unknown, use walking and beginner strength as preferences, then ask a different single question or proceed.

Bad: asking for typical schedule again after the owner answers with "sit most of the day" and "plans get too intense." Good: mirror "too intense," mark schedule unknown, use sitting and intensity as constraints, then write provisional artifacts if the spec and plan can already be useful.

Bad: changing "three short workouts" into "three sessions" or "three workouts." Good: mirror "three short workouts" exactly.

Bad: asking what "healthier" means in four consecutive replies. Good: after the owner says they are not doing much, get overwhelmed by intense plans, and can do two or three small things a week, treat the goal as provisional and write the spec and plan when they say progress without obsession.

Bad: saying only "safe framework" after the owner asks for a safe way to think about next steps. Good: say "safe next steps" and keep the not-diagnosis boundary.

Bad: asking about schedule or typical week after the owner says success is building confidence without pushing through pain. Good: write the spec and plan with schedule unknown.

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
