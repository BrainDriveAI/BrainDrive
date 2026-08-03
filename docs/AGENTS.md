# Documentation scope instructions

The repository-wide authority is [`../AGENTS.md`](../AGENTS.md). This file supplements it only for work below `docs/`.

- Treat [`developers/catalog.json`](developers/catalog.json) as the sole machine-readable registry for topic authority, lifecycle status, routes, role ownership, mappings, aliases, and controlled projections. Source, tests, schemas, and package scripts remain executable authorities for their own behavior.
- Maintain one current canonical path per topic. Link to cross-cutting contracts instead of copying them. Declare mirrors, generated projections, aliases, replacements, and historical paths before retaining duplicate material.
- Classify existing material before moving it. Preserve stable pointers and useful migration/history context; never make legacy, historical, internal, experimental, deprecated, removed, unsupported, or unresolved material appear current.
- When documentation conflicts with source, tests, configuration, security policy, or applicable instructions, record the mismatch. Stop before a material security, data, compatibility, production, provider, migration, or release behavior change.
- Use Git-derived candidate enumeration. Never open, scan, copy, move, delete, or package ignored `docs/Security/`, owner memory, backups, runtime state, credential paths, generated output, or vendored dependencies.
- Use unmistakably synthetic examples and sanitized evidence. Never retain live credentials, raw secret matches, owner data, private URLs, network identifiers, production details, or restricted procedures.
- Evidence records are revision-bound, sanitized, non-authoritative execution traces. They do not replace current documentation, source, tests, CI, or human review, and they contain no acceptance or approval metadata.
- Run `npm run docs:verify` from `builds/typescript/` and `node tools/docs/sync-generated.mjs --check` from the repository root after changes in this scope. Use `--write` only for an explicitly intended projection update.
