# Cross-Domain — Mirror Life States, Read Siblings Cheaply

## Major Life States — Mirror to Profile + Relevant Projects

When you learn one of these, write to BOTH `me/profile.md` Active Life States AND a **Current Context** line at the top of EACH **relevant** project's AGENT.md.

**Major life states:**
- **Crisis:** divorce, separation, job loss, serious health issue, death of family member
- **Transition:** new baby, marriage, moving cities, career change, retirement
- **Financial shock:** bankruptcy, large debt, large windfall, lost income
- **Health change:** serious diagnosis, recovery from injury, new disability

**Relevance heuristic:**
- Divorce → Relationships, Finance, Career
- Job loss → Career, Finance (sometimes Relationships)
- New baby → all default domains
- Hobby project → usually skip unless directly impacted

**When in doubt, mirror.** Current Context lines are small. Better noisy than missing.

## Mirror Pattern

Add or update a single line near the top of project AGENT.md:
```
**Current Context:** Owner is going through divorce (filed April 2026) — keep relevant.
```

## Current Context Aging

- ~6 months without reference → demote profile entry to "Past Life States" + clear the Current Context line.
- Owner brings Past entry back up → restore to Active + re-add Current Context.
- Use rough heuristics (see `playbook/profile.md` Date Inference). Don't try precise time math.

## Reading Other Projects' AGENT.md — Cheap Probe First

DON'T read all 6 sibling AGENT.md files. Blows context budget.

**HTML one-line summary is sufficient by default.** Every project AGENT.md begins with:
```
<!-- ONE-LINE-SUMMARY: Finance project — personal money advisor (debt, savings, investments). Status: see Status line. Cross-pollination flags: see Current Context line. -->
```
That comment IS the project's elevator pitch.

**Decision flow (cheapest first):**
1. **Default:** `project_list({})`. Most cross-domain decisions need nothing more.
2. **Need a Current Context line?** Read sibling AGENT.md but STOP after HTML summary + Status line + Current Context line.
3. **Read the FULL sibling AGENT.md** ONLY when:
   - Owner explicitly asks about that project, OR
   - Routing a brain-dump from BD+1 and need fit verification, OR
   - HTML summary + Status + Current Context genuinely insufficient.
4. **Multi-domain conversations:** read active project's full file; read siblings ONLY when conversation actually crosses into them. Not upfront.

NEVER read other projects' `spec.md` or `plan.md` unless owner explicitly asks.

## Cross-Domain Links — Write to Both Sides

If you uncover a connection, write to BOTH project files:

1. CURRENT project's `spec.md` "What's In The Way": `[Other domain] connection — see [other-project].`
2. OTHER project's `AGENT.md` Current Context: `[summary of relevance].`

**Example (in Finance):** Owner says "we fight about money every Sunday."
- `documents/finance/spec.md` What's In The Way: `Partner conflict over money — recurring Sunday conflicts. Connected: Relationships.`
- `documents/relationships/AGENT.md` Current Context: `Money tension recurring Sunday conflicts (April 2026). See Finance spec.`

**Don't invent connections.** Only propose links the owner explicitly mentioned this conversation OR that appear in the profile.
