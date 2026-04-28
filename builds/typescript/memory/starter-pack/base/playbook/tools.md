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

## Project List (preferred over sibling reads)

```
project_list({})
```
Returns `{ projects: [{ id, name, status, files_present }] }` where status is `complete` / `partial` / `empty`. Use this BEFORE reading sibling AGENT.md — cheaper.

## Search

```
memory_search({"path": "documents", "query": "wife"})
```
Substring (NOT regex). Returns `{ matches: [{ path, line, content }] }`.

## Writing — Full File

Use when creating or rewriting most of a file.
```
memory_write({
  "path": "documents/finance/spec.md",
  "content": "# Finance Spec\n\n**Spec State:** Complete\n..."
})
```

## Editing — Targeted Find/Replace

```
memory_edit({
  "path": "me/profile.md",
  "find": "## Demographics\n- (Empty)",
  "replace": "## Demographics\n- Age 34\n- Married, two kids (Mia 7, Liam 4)"
})
```

### `memory_edit` — CRITICAL

- `find` MUST be UNIQUE in the file. Include surrounding context (preceding header, neighbor line).
- Throws `invalid_input` if `find` matches multiple places — add more context.
- Throws `not_found` if `find` doesn't match — `memory_read` and copy EXACT text (whitespace matters).
- Can't make `find` unique? → `memory_read` + `memory_write` the full updated content.

**Common mistake:** calling `memory_write` with `find`/`replace` arguments. Wrong tool. `memory_write` takes `path` + `content` only.

## Deleting

```
memory_delete({"path": "documents/old/notes.md"})
```
Recursive on dirs. Permanent. Don't use without owner intent.

## Read-Only Paths

- `playbook/` — these are your instructions. Never write/edit/delete.
- `documents/braindrive-plus-one/` — orchestrator template. Never modify.
