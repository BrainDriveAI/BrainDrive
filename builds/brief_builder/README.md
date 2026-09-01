# Brief Builder

Brief Builder is BrainDrive's small second first-party proof app. Its sandboxed `ui://brief-builder/main` screen accepts owner source text, requests the fixed protected `brief.generate@1` purpose, lets the owner edit the grounded result, and asks the host for confirmation before creating an immutable approved revision.

It also includes a bounded Internet Search proof tab that consumes only generic `web.search@1` and `web.read@1` operations through the host bridge. Selected read content is appended to Brief source text only as labeled `external-untrusted` source material.

The package does not call providers directly, use agent tools, read Career or Resume data, export documents, expose provider credentials, or make Job Discovery claims. Automated fixtures prove package, workflow, schema, grounding, and generic consumption contracts only. The repository rubric requires named human review before making live natural-language usefulness or quality claims.
