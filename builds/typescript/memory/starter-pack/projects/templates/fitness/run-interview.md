# Fitness Interview

*Procedure for filling `spec.md` through conversation.*

## Preservation Rule

Update sections in place in `spec.md`; never replace the whole file. Keep every section header, `**Status:**`, `**Last updated:**`, and `## Changelog`. The italic section descriptions and the quick-start note are guidance for you, not the owner — replace each with the owner's actual content as you fill the section, so the finished spec shows their content, not the instructions. Use today's date from system context for Last updated and changelog entries.

## What This Procedure Accomplishes

This conversation produces the two most important owner-facing artifacts in BrainDrive: **Your Goals** (the Fitness `spec.md`) and **Your Plan** (the Fitness `plan.md`). When no written spec or plan exist, your job is to run this interview and write them. Once they exist, your job shifts to keeping them current and using them to personalize your coaching and move the owner forward.

The conversation is not the output; the written spec and plan are.

## When to Run

- The Fitness spec is empty or materially stale.
- The owner wants to clarify fitness goals before planning.
- New activity, nutrition, sleep, stress, injury, medical, schedule, or lifestyle context could change the direction.

## Method

Read `me/profile.md`, the Fitness `spec.md`, and the Fitness `plan.md` before asking broad setup questions. Briefly summarize known context, then ask what is missing, stale, or unconfirmed.

The interview should feel like sitting down with an expert fitness coach. Your job is to get the owner started, not to capture every detail about them — aim for roughly ten focused exchanges (about five minutes) and then write. A useful first pass beats a complete one; the picture deepens with every future conversation.

Ask one meaningful question at a time — treat related details (duration, equipment, target date, injuries, schedule, preferences) as separate turns, not one bundled checklist. Start with the owner's presenting goal, then adaptively gather the few facts that matter most: current activity, nutrition patterns, sleep, stress, injuries, physical constraints, schedule, equipment, experience level, preferences, past attempts, and success criteria. Do not ask for the whole landscape at once.

Mirror important constraints in the owner's own numbers and wording: injury, pain, safety, time, equipment, schedule, sleep, and recovery. If they raise injury, symptoms, medication, or safety concerns, keep the not-a-diagnosis boundary. Ask for health documents only when they could materially improve the plan, and make them optional.

Probe for what the owner actually does, not just what they intend to do. Watch for all-or-nothing thinking, low adherence, shame, injury fear, sleep or stress blockers, event-driven motivation, and nutrition patterns that could make the plan fail. If the owner gives adjacent information instead of answering, record the asked-for detail as unknown and move to the next highest-impact question — with the required baseline floor below as the exception.

**Required baseline floor.** For fat-loss, muscle-gain, body-composition, or performance goals, make sure you have three things before playback: a rough current training/activity baseline, a rough current nutrition/eating baseline, and a measurable anchor the owner can track progress against — a number (weight, measurements), a non-scale marker of where they are now (current strength/cardio benchmark, energy, sleep, how clothes fit), or the owner's explicit decline. A future target ("run a 5K") is a goal, not an anchor — capture the current starting point ("can jog 10 minutes," "current mile pace"). If one of the three is still missing after about five answers, ask that one question before playback rather than deferring it into "step one of the plan"; deferring is only acceptable when the owner declined or genuinely cannot provide it.

When the owner gives a success criterion, or after about four or five useful answers, stop intake and run user-story playback.

User-story playback is the final exchange before writing. Synthesize the owner's main goal as: "I want to [outcome] so that [why]," plus any supporting stories that ladder up to it. Play them back and invite changes: "Here's what I think you're trying to do: [main story]; [supporting stories]. Change anything before I turn this into Your Goals and Your Plan."

Once the owner confirms, corrects, or otherwise responds, stop asking intake questions and write both **Your Goals** and **Your Plan** in the same turn. Never reply with only an acknowledgment. If information is incomplete, write provisional artifacts with explicit unknowns rather than waiting for perfect context.

Write the quick-start using the spec template's shape and section limits: essentials only, not a comprehensive report. Route facts correctly: stable cross-project facts to `me/profile.md` with confirmation; Fitness goals, current state, constraints, preferences, and success criteria to `spec.md`; ordered next steps, decisions, timing, and status to `plan.md`.

## Done Criteria

`spec.md` has owner-specific goals, current reality, success criteria, important assumptions, and unknowns. High-stakes health claims stay within the available evidence.

## After Running

Update `spec.md`, summarize material changes, propose `me/profile.md` updates only for confirmed stable cross-project facts, and return to Fitness scope before planning.

## What This Procedure Is Not

It is not medical advice, diagnosis, treatment, medication guidance, symptom triage, required daily logging, or a substitute for a clinician, dietitian, physical therapist, or qualified coach.
