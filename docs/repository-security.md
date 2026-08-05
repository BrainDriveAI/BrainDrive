# Repository Security

## Local runtime data

The root `.gitignore` deliberately anchors BrainDrive runtime secrets and
personal memory to these paths:

- `/builds/typescript/.paa-secrets*`
- `/builds/typescript/your-memory*`

The similarly named product source at `builds/typescript/secrets/` and
`builds/typescript/memory/starter-pack/` must remain tracked. Use
`git check-ignore -v <path>` when adding a new runtime or backup naming
convention. The reported rule must come from the root `.gitignore`, not a
clone-local `.git/info/exclude`.

Ignored local data is not repository scan input. Do not open, copy, move, or
delete a local secret or personal-memory backup during routine repository
scanning. Backup containment and credential rotation require separate,
explicit operator authorization.

## Secret scanner

The repository entry point pins Gitleaks 8.30.1:

```bash
tools/security/scan-secrets.sh --current
tools/security/scan-secrets.sh --history
tools/security/scan-secrets.sh --self-test
```

`--current` builds an ephemeral snapshot from tracked and non-ignored
candidate files. This covers current tracked content and pending repository
files without traversing ignored runtime data. `--history` refuses shallow
clones and scans `git log --all --full-history`, covering every locally
reachable branch, remote ref, tag, and deleted historical content.

If an exact Gitleaks 8.30.1 binary is available, set `GITLEAKS_BIN` to it.
Otherwise the script downloads the official Linux or macOS release archive to
the user cache and verifies its embedded, reviewed SHA-256 before each
extraction. Unsupported versions, platforms, architectures, checksum
mismatches, invalid configuration, shallow history, scanner errors, and
unexplained findings fail closed.

Scanner reports are temporary and use full redaction. Console evidence is
limited to the scanner version, configuration hash, ref scope, finding count,
rule, path, commit, hashed fingerprint, disposition, reviewer, and status.
Never attach raw scanner reports or matching values to issues, pull requests,
CI logs, or repository files.

## Finding triage

Treat every finding as open until a security reviewer records one of these
dispositions outside Git:

1. `remediated`: remove the committed value or replace the fixture with a
   non-secret representation, then rescan.
2. `escalated`: identify the credential class and issuer without recording the
   value; coordinate revocation or rotation under separate authority.
3. `reviewed-false-positive`: manually prove the exact finding is fake,
   non-authorizing, or already revoked.

Do not allowlist a directory, filename family, rule, or test/fixture category.
When a reviewed false positive cannot be rewritten safely, add only the exact
Gitleaks fingerprint to `.gitleaksignore`. The external review record must
include the rule, path, commit, hashed fingerprint, disposition, reviewer,
status, and rationale without the matched value. Re-run both scan modes after
every remediation or exception.

### Approved historical exception

The exception identified publicly as `sha256:592e330f7b5b6fe6` is
`reviewed-false-positive`: authorized BrainDriveAI security reviewer
`@DJJones66` classified the historical value as synthetic, false-positive, or
expired and therefore non-authorizing on 2026-08-04. Only its exact Gitleaks
fingerprint is allowlisted; no directory, filename family, rule, or pattern is
excluded. Review expires on 2027-08-04 and must run earlier if the affected
history is republished, the rule or scanner version changes, or new evidence
questions the non-authorizing classification. The matched value is deliberately
absent from this record.

History rewriting is not incident containment. Consider it only after any real
credential is revoked, with explicit maintainer approval, scoped refs,
recovery backups, force-push coordination, contributor repair instructions,
and a complete post-rewrite history scan.
