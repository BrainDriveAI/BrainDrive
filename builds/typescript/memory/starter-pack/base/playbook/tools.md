# Tool Recipes — Exact Shapes

All paths relative to `your-memory/`. Don't include `your-memory/` in the path argument. `..` segments rejected.

## Reading + Listing

```
memory_read({"path": "documents/finance/spec.md"})
memory_read({"path": "me/profile.md"})
memory_list({"path": "documents"})    // returns ["AGENT.md", "spec.md/", ...] — trailing / = dir
memory_list({})                       // memory root
```

`memory_read` throws `not_found` if file missing → `memory_list` parent first, don't guess.

## Project List

```
project_list({})
```
Returns `{ projects: [{ id, name, status, files_present }] }` where status is `complete` (all 3 template files present) / `partial` / `empty`. **Use this BEFORE reading sibling AGENT.md files** — it's much cheaper.

## Search

```
memory_search({"path": "documents", "query": "wife"})
memory_search({"query": "401k"})              // path optional, defaults to memory root
```
Substring (NOT regex). Returns `{ matches: [{ path, line, content }] }`.

## Writing — Full File

Use `memory_write` for these cases:
- **Creating a file** for the first time (e.g., `me/profile.md` on first stable fact, or `<project>/spec.md` on first interview completion)
- **Pre-interview → Complete spec/plan transitions** — always full rewrite, not surgical edit. The placeholder text inside template `*To be filled through conversation.*` blocks is finicky for `memory_edit` because the template syntax has block quotes that don't always match cleanly. Just rewrite the whole file.
- **Large rewrites** that touch multiple sections

```
memory_write({
  "path": "documents/finance/spec.md",
  "content": "# Finance Spec\n\n**Spec State:** Complete\n..."
})
```

## Editing — Targeted Find/Replace

Use `memory_edit` for **surgical updates to existing committed content**: marking a single Roadmap step done, adding one fact under an existing profile section, updating the Status line, updating one Current Context line.

```
memory_edit({
  "path": "me/profile.md",
  "find": "## Demographics\n- Age 32, married, two kids.",
  "replace": "## Demographics\n- Age 33, married, two kids."
})
```

### `memory_edit` — CRITICAL

- `find` MUST be UNIQUE in the file. Include surrounding context (preceding header, neighbor line).
- Throws `invalid_input` if `find` matches multiple places — add more context.
- Throws `not_found` if `find` doesn't match — `memory_read` and copy EXACT text (whitespace matters).
- Can't make `find` unique? → `memory_read` + `memory_write` the full updated content.

**Don't use `memory_edit` to fill template placeholders.** The `*To be filled through conversation.*` text appears in every section and edits won't be unique. Use `memory_write` to fully populate the file when transitioning Pre-interview → Complete.

**Common mistake:** calling `memory_write` with `find`/`replace` arguments. Wrong tool. `memory_write` takes `path` + `content` only.

## Deleting

```
memory_delete({"path": "documents/old/notes.md"})
```
Recursive on dirs. Permanent. Don't use without owner intent.

## Read-Only Paths

- `playbook/` — these are your instructions. Never write/edit/delete.
- `documents/braindrive-plus-one/` — orchestrator template. Never modify.
