# BrainDrive Memory Architecture

**Status:** Draft — in Library for iteration. Once locked, canonical version migrates to BrainDrive repo (`docs/architecture/memory-architecture.md`) with a Library breadcrumb pointing at it.

**Authors:** Dave W (with Claude as thinking partner), 2026-05-21

**Audience:** Anyone building features in BrainDrive, reviewing owner-memory changes, or making product decisions that touch the owner's file system / memory layout.

**When to consult this doc:** Before adding any new file type, folder, or content structure to the owner's memory layout. Before writing prompt content that tells the agent how to do something. Before reviewing a PR that touches the starter pack or any owner-facing memory file.

---

## 1. Core Model

BrainDrive's memory architecture follows a five-level process:

1. **Orient** — bring the agent up to speed.
2. **Align** — define the owner's goals and what success looks like.
3. **Plan** — design the concrete path to reach those goals.
4. **Execute** — do the work through owner-facing apps and supporting files.
5. **Propagate** — keep affected memory up to date after state changes.

The architecture is built from **11 primitives** across the four file-bearing stages. Propagate is a behavior, not a file type.

| Stage | Primitives |
|---|---|
| Orient | System prompt, `base/AGENT.md`, project `AGENT.md`, `me/profile.md` |
| Align | `spec.md` |
| Plan | `plan.md` |
| Execute | Apps, Instructions, Index, Sources, Reports |
| Propagate | — |

Domain complexity scales freely; primitive count stays flat.

### Technical Layers

| Layer | Required across all projects? | Universal in... | Varies by domain |
|---|---|---|---|
| L0 system prompt | Yes | Everything | Nothing |
| L1 BD+1 base | Yes | Everything | Nothing |
| L2 project `AGENT.md` | Yes | Shape | Persona, file list, boundary |
| L3 `spec.md` | Yes | Purpose: align on success | Structure, questions, success criteria |
| L3 `plan.md` | Yes | Purpose: plan a path | Milestones, sequence, first steps |
| L4+ apps + supporting files | No | — | Which apps exist, how deep they go |

Owner UX implication: every project starts with the same top-level contract — what this is (`AGENT.md`), what success means (`spec.md`), and how to get there (`plan.md`). The work itself happens below that.

---

## 2. Execute-Stage File Types

Every Execute-stage file is one of five stable types:

| Type | Meaning | Examples |
|---|---|---|
| **Apps** | Owner-facing capabilities. Each app is a folder containing its orient file (`AGENT.md`), the state artifact, and any workflow files. | `budget/`, `workout-log/`, `journal/`, `todo/`, `investments/` |
| **Instructions** | AI-facing procedures, rules, or composition logic. No owner-maintained artifact. | `compare-months.md`, `handle-conflicts.md`, `budget-rules.md`, `net-worth.md` |
| **Index** | Folder map with file listing and optional routing hints. For active scopes, the index function lives in `AGENT.md`. For reference collections, see `README.md`. | `AGENT.md` (active), `README.md` (reference) |
| **Sources** | Uploaded or imported source data consumed by apps. Folder uses `README.md` as its contract. | bank statements, receipts, parsed documents |
| **Reports** | Regenerated synthesis outputs the owner reads. Folder uses `README.md` as its contract; detailed workflow belongs in Instructions. Common lifecycle: `<topic>-latest.md` as a working cache (overwritten each run); optional `<period>-<id>.md` (e.g., `monthly-2026-05.md`) for durable archives when meaningful. Simpler reports may have only a `latest.md`. | `reports/latest.md`, `reports/monthly-2026-05.md`, `reports/net-worth-latest.md` |

### App Folder Structure

Every app is a folder, not a bare file. The shape is uniform across all apps:

```text
<app>/
├── AGENT.md          # orient — preservation, procedures, propagation
├── <artifact>.md     # state — what the app maintains (e.g., budget.md)
└── <workflow>.md     # one or more procedures (e.g., create.md, compare.md)
```

Simple apps may have just `AGENT.md` + artifact. Complex apps add workflow files as needed. Apps **never live as bare files at the project root** — always inside a named folder.

**Strategic framing:** Apps are the unit of owner-facing BrainDrive functionality. BrainDrive is a platform with apps owners adopt, customize, and eventually share or extend. The word "app" is not just a file label; it carries the product direction.

Instructions has three common subtypes: **Procedures**, **Rules**, and **Composition files**. These are naming and usage subtypes, not separate primitives.

### Active vs Reference

Use the Onion Test:

> Does this file do something, or is it consumed by something that does?

- **Does something** → active file → carries self-describing instructions.
- **Consumed** → reference material → labeled, but not instruction-bearing.

Apps and Instructions are active. Sources and Reports are reference material. Index is reference material that helps the agent navigate. Reports are reference outputs; the report folder's `README.md` carries output contracts and validation rules, but detailed workflow belongs in the producing app or procedure.

---

## 3. Progressive Disclosure

Core principle:

> **Instructions live inside the files they describe — and nowhere else.**

When the agent enters a scope, it reads that scope's instructions. Sibling scopes stay invisible until entered. This keeps each turn focused, lets the architecture grow without loading everything, and makes owner customization possible through natural-language instruction edits.

An active scope uses this shape — orient file carries instructions, artifact stays clean:

```markdown
# Budget — Agent Context        ← budget/AGENT.md (orient)

## Preservation Rule
What can be written, when, by whom.

## Procedures
| Owner wants to... | Read |
|---|---|
| Create or revise the budget | `create.md` |
| Compare actuals | `compare.md` |
```

```markdown
# Budget                         ← budget/budget.md (state artifact)

*Your saved monthly spending plan.*

**Status:** Active for 2026-06
**Last updated:** 2026-05-30

## Monthly Context
[Owner-facing content — tables, values]

## Category Limits
[Owner-facing content]
```

The orient file is AI-facing (instructions, preservation rules, routing). The artifact is owner-facing (state, tables, owner-editable content). Splitting them prevents AI-instruction blocks from getting overwritten during artifact updates.

Reference material (`statements/README.md`, `reports/README.md`) describes its folder contract; it doesn't carry workflow procedures, which live in the consuming app's procedure files.

### Common Procedure-File Shape

Procedure files (`run-interview.md`, `run-planning.md`, app `AGENT.md`, workflow files like `create.md` / `compare.md`) typically share a recognizable shape. This is a recommended starter pattern, not a rigid contract — not every procedure needs every section.

```markdown
# <Procedure title>

*Opening line — what this procedure does and when it runs.*

## What This Procedure Accomplishes
The one or two jobs the procedure delivers on.

## Preservation Rule
What the procedure must protect (artifact state, file structure, etc.).

## When to Run
Triggers — a routing table from owner intent to workflow.

## Method
Behavioral defaults — how the agent runs the work conversationally.

## Done Criteria
Verification checks before the procedure can be considered complete.

## After Running
Required follow-ups: update Status / Last updated, log to changelog, propagate material implications.

## What This Procedure Is Not
Anti-patterns to avoid.
```

Procedures with multiple workflows (e.g., create vs. compare) can split the Method into separate workflow files alongside the procedure-entry file; simple procedures stay in one file.

### Common Artifact-File Shape

Artifact files (`spec.md`, `plan.md`, app state files like `budget.md`) typically share a recognizable shape. Again, recommended pattern, not rigid contract — future apps may vary based on what their state actually needs.

```markdown
# <Artifact title>

*Italic descriptor — what this file is, owner-facing.*

**Status:** <lifecycle state>
**Last updated:** <date>

## <Section 1>
*Italic description of the section.*

[content / starter examples / "To be filled..." placeholders]

## <Section 2>
...

## Changelog
Material changes — date + what changed + why.
```

The artifact is owner-facing state. The associated procedure file owns the methodology that fills and updates it.

### Simple Example

When Katie asks, "how am I doing on my budget?", the agent loads:

1. Orientation files: `base/AGENT.md`, `me/profile.md`, and Finance `AGENT.md`.
2. Budget app orient: `budget/AGENT.md` (Preservation Rule + Procedures routing).
3. The comparison workflow: `budget/compare.md`.
4. The saved plan (read-only this turn): `budget/budget.md`, plus `budget/budget-rules.md` for categorization.
5. Source folder contract and relevant statements: `statements/README.md`, then statement files for the requested period.
6. Output contract: `reports/README.md` for the report sections that must be present.

It does not load unrelated projects, unrelated apps, or deep instruction files that the current scope did not point to.

### Fractal Scope-Relative Depth

Depth is relative to the current scope, not absolute. A file can be four levels down from root and still be the broad entry point for its own local scope.

The same broad-to-specific shape recurses at every scope — fractally.

- **Project scope:** `AGENT.md` → `spec.md` / `plan.md` → apps → child instructions
- **App scope:** `<app>/AGENT.md` → state artifact → linked workflow docs
- **Instruction scope:** instruction header → child instructions, if needed

Apps may follow the same Orient → Align → Plan → Execute → Propagate flow internally, but that flow is expressed through the app's `AGENT.md` and workflow files — **not** by creating duplicate app-level `spec.md` or `plan.md` files. The cycle is procedural, not structural.

Test for going deeper:

> Does this app have multiple specialized concerns that each need detailed instructions?

- Yes → spawn child instruction files.
- No → keep it as a leaf.

Depth is set by the work, not by uniformity.

---

## 4. Orient and Naming Convention

### Orient Convention

Every scope has a deterministic **orient file** — the agent's first read when entering that scope.

| Orient file | Used by | Rule |
|---|---|---|
| `AGENT.md` | Active scopes — things that **do** (BrainDrive, projects, apps) | Read this before touching any artifact in the scope |
| `README.md` | Reference collections — things that **are** (source folders, report folders) | Read this before reading or writing anything inside the folder |

The agent's first read at any scope is its orient file. After orient, the agent navigates by convention and judgment — but **orient itself is not optional and not flexible**. The orient file carries:

- The scope's identity and purpose
- Preservation rules for the scope's artifacts (what's writable, what's read-only)
- Routing to workflow files or sub-procedures
- Any propagation rules for what happens after work in the scope

**Why two file names?** `AGENT.md` and `README.md` serve different conceptual roles. `AGENT.md` implies an active identity, a persona at play, and preservation responsibilities for state. `README.md` is a folder contract — what's here, how to read or write within. Using the right name signals which mode the agent (and the owner) is in.

**Deterministic at orient, conventional elsewhere.** The orient file is the only deterministic read. After orient, what to read next is determined by the orient file's routing, the procedure file's Inputs section, and the agent's judgment. The architecture trusts judgment after orient; it does not trust judgment to land on the right orient file in the first place.

### App Folder Naming

Every app is a folder. Inside the folder:

| Function | Pattern | Examples |
|---|---|---|
| Orient (always) | `AGENT.md` | `budget/AGENT.md`, `journal/AGENT.md` |
| State artifact | Folder name + `.md`, or descriptive name | `budget/budget.md`, `journal/entries.md` |
| Procedure (workflow) | Verb-first, context-implied by folder | `budget/create.md`, `budget/compare.md`, `journal/reflect.md` |
| Rules | `<topic>-rules.md` | `budget/budget-rules.md`, or project-level `rules.md` |

Notes:

- App folders use bare noun names — `budget/`, not `budget-app/`.
- The state artifact uses the folder's name when there's one canonical artifact (`budget/budget.md`); use a descriptive name when there are multiple (`journal/entries.md`).
- Procedures don't need a `-procedure` suffix; the verb signals action. Folder context lets workflow files use short names (`create.md` not `create-budget.md`).
- Composition files (Instructions that combine apps) live at the project level, not inside an app folder. They can use noun-form (`net-worth.md`) or verb-form (`compute-net-worth.md`) depending on which reads cleaner.
- No `spec.md` or `plan.md` inside an app folder. Those are project-level.

### Index Files

The index function (file listing + intent hints) lives in the scope's orient file.

- **Active scope (`AGENT.md`):** orient + preservation + routing are unified. The app's `AGENT.md` carries any file listing and routing for workflows in the same folder.
- **Reference collection (`README.md`):** describes what files are in the collection, naming conventions, and how active files should read them.

Example for an app's `AGENT.md` routing block:

```markdown
## Procedures

Start here, then read only the listed workflow file needed for the current request.

| Owner wants to... | Read |
|---|---|
| Create or revise the budget | `create.md` |
| Compare actuals against the budget | `compare.md` |
```

Example for a source folder's `README.md`:

```markdown
## What This Folder Contains

All owner-uploaded financial statements. Apps filter for the statement types they need.

## File Conventions

- Format: PDFs, CSVs, converted text
- Naming: institution + account + period
- Period overlap: read every file whose period overlaps the requested date range
```

For active scopes, the listing is the floor; routing hints are the optimization. For reference collections, conventions and contracts are the focus.

---

## 5. Cross-Project Layer

The BD+1 layer has the same structural shape as a project layer, one scope up:

- `base/AGENT.md` — cross-project orientation.
- `me/profile.md` — cross-project orientation to the owner.
- `me/todo.md` — cross-project task artifact (may evolve into a `me/todo/` app folder if it grows).

There is no BD+1 `spec.md` or `plan.md` for now. The BD+1 scope is the platform itself; project-level Align and Plan stay inside projects.

### `base/AGENT.md`

Loaded on every project conversation. It is the single source of truth for cross-project context, routing signals, and active state that affects multiple projects.

Target size: ~50 lines. It is orientation, not a dump.

Belongs here:

- Project names with one-line descriptions.
- Cross-cutting correlations the agent should always carry.
- Routing signals.
- Active state that affects multiple projects.

Does not belong here:

- Project-specific procedures.
- Detailed project state.
- Owner identity facts.

When in doubt, push detail down into the project.

### `me/profile.md`

Canonical cross-project context about the owner. Read by every project's agent before conversation.

Boundary rule:

> Relevant in multiple projects → profile. Relevant in one project → that project's `spec.md`.

Examples:

| Fact | Goes to | Why |
|---|---|---|
| "I'm 47" | Profile | Identity, cross-cutting |
| "I'm self-employed" | Profile | Affects Finance, Career, taxes, work-life |
| "Wife is on maternity leave" | Profile, time-marked | Temporary but cross-cutting |
| "I value financial independence over career prestige" | Profile | Deep value, cross-cutting |
| "I want to retire at 55" | Finance spec | Domain-specific goal |
| "I carry $30K credit card debt at 22% APR" | Finance spec | Domain-specific situation |
| "I do Stronglifts 3x/week" | Fitness spec | Domain-specific |

Suggested structure:

```markdown
## Identity & Situation
Basic identity, family, location, work, health, life stage.

## What Matters To Them
Deep values and cross-cutting priorities.

## How to Work with Me
Communication and interaction preferences.
```

Stated facts can be written silently. Inferred facts require confirmation before adding. Example: "Your kids have come up a few times — should I add them to your profile?" Profile is the highest-trust file in the system.

No tiering for now. If profile grows too large to load efficiently, revisit.

---

## 6. Composition

When apps combine, the composition is just another file. No new primitive.

Example: `net-worth.md`

- Reaches the Budget app through `budget/AGENT.md`, then `budget/budget.md`.
- Reaches the Investments app through `investments/AGENT.md`, then `investments/investments.md`.
- Carries instructions for how to compose them.
- Produces `reports/net-worth-latest.md` (per `reports/README.md` output contract).

Composition reaches apps **through their orient files**, never directly to the artifact — that would skip preservation rules.

In Finance, net worth is typically Instructions + Report, not an app, because the owner does not maintain net-worth state directly. They ask "what's my net worth?", the agent uses `net-worth.md`, and the output lands in a report.

The architecture is closed under composition:

- budget + investments -> net worth
- net worth + fitness -> wellness score
- finance + career + relationships -> life dashboard

Composition can live at project scope or BD+1 scope, depending on what it combines.

---

## 7. Propagation

Propagate is the post-execution behavior that pushes affected memory upward when work materially changes higher-level state. It is **a behavior, not a file primitive** — propagation rules live inside the procedure or app `AGENT.md` whose work triggered the propagation.

### Core rules

- **Material changes only.** Don't propagate routine work. A monthly comparison report that confirms what's already known doesn't propagate; one that shows debt cleared or savings milestone hit does.
- **Summarize the implication, don't copy content.** Project-level files (`spec.md`, `plan.md`) carry summary state; they don't carry full reports or budget tables. Propagation captures *"Card 1 balance now $4,200, down from $5,400"* — not the transaction list.
- **Update higher-level files only.** Propagation flows up: app → project → cross-project. App work can affect `spec.md` (current state) and `plan.md` (phase progress). It does not write to other apps directly.
- **Propagation is owner-confirmable.** When the propagated update materially shifts plan or goal framing, surface the update for owner review rather than writing silently.

### Where propagation rules live

Each procedure or app `AGENT.md` carries its own Propagate section describing what to update after work in that scope:

- Workflow files name **propagation triggers** — when the workflow's output should prompt a project-level update.
- App `AGENT.md` carries the **Propagate** section with the rules and examples for that app.
- Project-level `run-interview.md` / `run-planning.md` propagate to `spec.md` / `plan.md` directly as part of After Running.

### What propagation prevents

Without propagation, project-level files drift from reality — `spec.md`'s "Where You Are" stays stale while monthly comparisons show steady progress. With propagation, project-level files reflect what's actually happened, and the agent always knows the current shape of the work.

The goal is **signal, not noise.** Routine updates clutter; meaningful updates orient.

---

## 8. Placement and Review Tests

### Where Does This Content Go?

1. **Scope**
   - Identity / cross-project context → `me/profile.md`
   - Cross-project tasks → `me/todo.md`
   - Project orientation → project `AGENT.md`
   - Project goals / current state / success criteria → `spec.md`
   - Project sequence / milestones / next steps → `plan.md`
   - App-specific work → app file or child instruction tree

2. **Active or Reference**
   - Orients, holds work, or carries procedure → active file with instructions.
   - Consumed as data or generated output → reference material.

3. **Execute-stage Type**
   - Owner uses or maintains it directly → App.
   - AI-only procedure, rules, or composition → Instructions.
   - Folder map / routing → Index.
   - Uploaded or imported data → Sources.
   - Regenerated synthesis output → Reports.

4. **Leaf or Subtree**
   - Multiple specialized concerns → child instruction files.
   - Single coherent concern → leaf.

### When Adding Rules

Before adding a rule to a file, ask:

- Is this restating something a template already enforces? Trust the template.
- Is this a runtime invariant? Enforce it in code.
- Is this about how to use a different file? Move it into that file's header.
- Is this a workflow procedure? Put it in the app or instruction file that owns that operation.

If most answers point elsewhere, the current file is doing too many jobs.

### Bloat Signals

- A file restates rules that exist elsewhere.
- Repeated "don't do X" phrasing.
- `AGENT.md` grows past ~80 lines in a complex domain or ~50 in a simple one.
- The same procedure appears in multiple files.
- Prompt content tries to enforce runtime invariants.

### PR Review Checklist

When reviewing owner-memory changes:

- Does every new file fit one of the existing primitives?
- Is it at the right scope?
- If active, does it self-describe in its header? Active scopes use `AGENT.md`; reference collections use `README.md`.
- If reference material, is it labeled and free of detailed procedures?
- Does it duplicate instructions from another file?
- Are runtime invariants enforced by tools/templates instead of prompt repetition?
- Does the orient file (`AGENT.md` or `README.md`) route common requests without hiding the underlying files?
- For new apps: is it structured as a folder containing `AGENT.md` + artifact + workflow files?
- Are starter examples removable once real owner content fills the section?

---

## 9. Deliberate Non-Choices

These were considered and rejected or deferred.

| Option | Decision | Why |
|---|---|---|
| **Skills as a separate primitive** | Rejected for now | Owner-facing needs reduce to composition files, AGENT-described conversation modes, or scheduled triggers that read existing apps. Triggering is runtime, not memory architecture. |
| **BD+1 `spec.md` / `plan.md`** | Deferred | Profile handles owner identity/values; project specs handle domain goals. Revisit when Whyfinder introduces a life-level "why" artifact. |
| **Importance tiers inside profile** | Rejected for now | Adds maintenance burden before there is a load-efficiency problem. |
| **Separate `.instructions.md` files for every app** | Rejected | Unified files make natural-language owner customization possible; the display layer separates owner view from edit view. |
| **"Executable" as file-type noun** | Retired | Collided with the Execute stage and obscured the owner-facing distinction between Apps and supporting files. |

The current `memory/starter-pack/skills/` folder is dev-process residue that ships into owner installs but is not invoked by owner-facing flows. Clean it up separately.

If a real owner-facing use case appears that does not fit existing primitives, add a primitive then, not preemptively.

---

## 10. Vocabulary

| Term | Meaning |
|---|---|
| **Primitive** | Atomic file type in the architecture. The count stays flat while domain complexity grows. |
| **Active file** | A file that does something: orients, holds app state, or carries procedure. Carries instructions. |
| **Reference material** | A file consumed by active files but not instruction-bearing itself. |
| **App** | Owner-facing capability at Execute stage, represented as a folder containing `AGENT.md` (orient), a state artifact, and workflow files. The unit of BrainDrive functionality. |
| **Instructions** | AI-facing procedure, rules, or composition logic. |
| **Index** | Folder map with file listing and optional intent hints. |
| **Sources** | Uploaded or imported source data consumed by apps. |
| **Reports** | Regenerated synthesis output the owner reads. |
| **Onion Test** | Does this file do something, or is it consumed by something that does? |
| **BD+1 scope** | Cross-project layer: `base/AGENT.md`, `me/profile.md`, and `me/todo.md`. |
| **Fractal** | The broad-to-specific gradient resets at every scope. |
| **Propagate** | Post-execution behavior that updates affected memory and returns the agent to higher-level context. |

---

## 11. Worked Example — Adding Investments to Finance

Katie has a working Finance budget app. She now wants to track investments and see net worth.

New files:

```text
documents/finance/
├── investments/                # app folder
│   ├── AGENT.md                # orient — preservation, procedures, propagation
│   ├── investments.md          # state — accounts/current values
│   └── manage-accounts.md      # workflow, if needed
├── investment-statements/      # sources collection
│   ├── README.md               # collection contract
│   └── 2026-Q1-vanguard.md     # source
├── net-worth.md                # instructions: compose budget + investments (project-level composition)
└── reports/
    ├── README.md               # collection contract
    └── net-worth-latest.md     # report
```

Where pieces live:

- `investments/` is an App folder. `investments/AGENT.md` orients the agent; `investments/investments.md` holds account state.
- `investment-statements/` is Sources. Its `README.md` describes what's in the collection and conventions for reading.
- `net-worth.md` is Instructions at the project level. It composes the Budget app + Investments app to compute net worth — composition stays at project level, not inside either app folder.
- `reports/net-worth-latest.md` is a Report. It is regenerated, not maintained edit-by-edit.

What did not need to change:

- No new layer.
- No new primitive.
- No new skill.
- No universal-layer change.
- `budget.md` does not need to know investments exist.

On "what's my net worth?", the agent loads:

1. System prompt.
2. `base/AGENT.md`.
3. `me/profile.md`.
4. Finance `AGENT.md`.
5. `net-worth.md`.
6. Files named by `net-worth.md`: `budget/AGENT.md` (then `budget/budget.md`), `investments/AGENT.md` (then `investments/investments.md`), relevant sources.

It does not load unrelated projects or unrelated deep instruction files. Note: composition reaches apps **through their AGENT.md** — never directly to the artifact, which would skip preservation rules.

After a state-changing turn such as "I just put $5K into Vanguard," Propagate should:

- Update `investments/investments.md` (via the app's `AGENT.md` preservation rules).
- Add source material if applicable.
- Mark dependent reports stale or regenerate when asked.
- Check Finance `spec.md` / `plan.md` for affected goals or milestones.
- Check `me/profile.md` only if a cross-project life fact changed.
- Check `me/todo.md` for new actions.

---

## 12. How to Use This Document

When adding a feature to BrainDrive:

1. Identify the scope.
2. Classify every file using Active/Reference and the five Execute-stage types.
3. Place files at the right layer.
4. For active scopes (BrainDrive, projects, apps), put orientation + preservation + routing in `AGENT.md`. For reference collections (sources, reports), put the folder contract in `README.md`.
5. New apps are folders containing `AGENT.md` (orient) + artifact (state) + workflow files; never bare files at the project root.
6. Keep sources instruction-free; keep report contracts limited to output structure + validation rules, not workflow.
7. Run the bloat and rule-placement tests.
8. Do not invent a new primitive unless the existing model genuinely cannot express the use case.

Current working decisions and open items:

- Vocabulary decided: Apps, Instructions, Index, Sources, Reports.
- Index pattern decided: orient file (`AGENT.md` for active scopes, `README.md` for reference collections) carries listing and routing.
- Cross-project context decided: always-loaded `base/AGENT.md`, kept tight.
- BD+1 `spec.md` / `plan.md` deferred until Whyfinder or a similar life-level artifact requires it.
- Open implementation alignment: the current BrainDrive repo still treats BrainDrive+1 as a seeded special project in some places; reconcile that with this BD+1-scope model before locking the canonical repo copy.
- Strategic commitment: BrainDrive as a platform with owner-facing apps.
- Next application: Finance scaffold migration to the starter pack, then Fitness and resume builder.
- Follow-up: clean up dev-side `memory/starter-pack/skills/`.
- Open: add a worked example for creating a new project type from scratch when the next vertical scaffolds.
