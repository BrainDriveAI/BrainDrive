# Native desktop verifier prototype

This is an exploratory native-app entry smoke for the App Lifecycle verifier. It uses Tauri's embedded W3C WebDriver endpoint with a small Node built-in HTTP client, so it needs no external driver or additional npm test packages. The same scenario can run on Windows and macOS, including over SSH when the Mac has an active GUI session.

From `builds/typescript`, run:

```sh
npm run desktop:verify:native
```

The command builds the local runtime and frontend, compiles the debug Tauri app with the opt-in `desktop-verifier` Cargo feature, and runs one native scenario. The scenario uses an isolated app-data and log profile under the OS temporary directory, captures the first-run setup screen, verifies and clears synthetic Username input, creates a synthetic local account inside that isolated profile, opens the real Apps page, inspects the Resume Builder pre-install entry, and performs one isolated install transition. It never records the generated password. The Apps page requires a valid catalog at runtime startup. Smoke runs use the BrainDrive-controlled Stage 1 HTTPS catalog and its referenced artifacts; deterministic evaluation runs can set `BRAINDRIVE_DESKTOP_VERIFIER_CATALOG_PATH` to a frozen local catalog fixture, or `BRAINDRIVE_DESKTOP_VERIFIER_CATALOG_URL` to an explicitly selected HTTPS fixture. Read-only downloads are cached under the isolated verifier artifacts root. Set `BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS` to choose a persistent evidence directory.

Each run creates a new subdirectory under the OS temporary directory (or under the directory supplied via `BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS`) and writes `candidate.json`, `qualification-disposition.json`, `run-result.json`, `desktop-entry-evidence.json`, screenshots, and app logs. The synthetic account and app-data profile are intentionally retained for inspection and are not automatically deleted. The evidence contains all 72 row IDs; the executable slice records timestamped owner actions, managed-profile file-tree digests, native process snapshots, visible dialog inventories, and per-state control inventories. The install transition also evaluates whether exactly one approval prompt was shown; a missing prompt is recorded as a row failure. Proof rows use only `pass`, `fail`, `blocked`, and `not_run`; legacy `implemented`/`pending` records are downgraded to `not_run`.

`run-result.json` reports technical execution status only. Every native run also emits a `qualification-disposition.json` sidecar with `disposition: "diagnostic_only"` and `qualificationEligible: false` until the verifier integrity review is explicitly closed. The sidecar is not a substitute for raw evidence and does not rewrite it; a technical `pass` result must not be counted as a qualification pass while this disposition is present.

The E-21 portability review is executed as part of the native run for `TB-6` and `FR-10`. It acquires the selected reviewed package from the catalog, its GitHub release asset, and a byte-preserving copied ZIP; records each acquisition receipt; verifies the catalog archive digest; compares the embedded, descriptor, and release manifests; and checks the catalog relationship/security projection for catalog-only authority. The Apps-page Install action is the catalog-mediated GitHub download path; the GitHub release acquisition and copied ZIP are independent reviewer artifact fixtures, not additional owner-facing buttons. `BRAINDRIVE_DESKTOP_VERIFIER_PACKAGE_ID` selects the package (default `ai.braindrive.resume-builder`). `BRAINDRIVE_DESKTOP_VERIFIER_RELEASE_ASSET_URL` and `BRAINDRIVE_DESKTOP_VERIFIER_RELEASE_MANIFEST_URL` override the derived GitHub release URLs when a package uses a different release layout. The live leg requires the catalog-mediated download and its activated package digest; no separate ZIP/import UI is required by the desktop UX.

The US-2 acquisition review is also emitted as `acquisition-review.json`. It records the catalog, reviewed-link, and ZIP paths independently; checks whether the Apps surface exposes the accepted BrainDrive-origin rule before input; joins the catalog approval/lifecycle evidence; and lists the eight PK-2–PK-5 negative-path cells (each fixture by link and ZIP). Set `BRAINDRIVE_DESKTOP_VERIFIER_FIXTURE_ROOT` only when the concrete, test-authority-controlled PK-2–PK-5 packet is available. Missing owner-facing link/ZIP paths are recorded as product failures under the accepted plan; missing concrete fixtures are recorded separately as a blocked fixture prerequisite. The verifier does not invent a ZIP/import control.

The US-3 update review is emitted as `update-review.json`. It records the Update control/change-note surface, update lifecycle events joined to owner input, fresh-approval observations, owner-data hash comparison, and the C-B/C-C/C-D/C-G/D-2 fixture prerequisites. Set `BRAINDRIVE_DESKTOP_VERIFIER_UPDATE_FIXTURE_ROOT` only when those concrete update fixtures and fault inputs are available. Missing update fixtures are reported as `blocked`; the native run treats failed, blocked, and not-implemented rows as incomplete and exits non-zero.

The US-6 catalog/refresh review is emitted as `catalog-review.json`. The Apps response now carries owner-safe catalog source, as-of, refresh/cache status, and a digest; the explicit Refresh action is marked with a catalog-trigger header. The host records redacted catalog-request trace entries at `BRAINDRIVE_STAGE1_CATALOG_TRACE_PATH`, including the trigger and empty owner-data/installed-app/usage field sets. Deterministic desktop runs may set `BRAINDRIVE_DESKTOP_VERIFIER_BUNDLED_CATALOG_PATH` for the startup snapshot and `BRAINDRIVE_DESKTOP_VERIFIER_CATALOG_URL` for the separate repository refresh source; startup/page-load reads the bundled snapshot, while refresh/install use the repository source and fall back to the last-known cache. Set `BRAINDRIVE_DESKTOP_VERIFIER_CE_CATALOG_PATH` for the C-E new-entry fixture. The native verifier records a repository-unreachable observation only when the refresh receives a last-known-good response, the cache digest is preserved, the outage message is visible, and the installed app remains openable.

The owner-data retention review is emitted as `retention-review.json`. It seeds only a synthetic fixture in the isolated `memory/apps/resume-builder` namespace, hashes that namespace before and after uninstall, verifies that canceling deletion preserves the digest, and verifies that a separately confirmed deletion changes it. The UI delete action is app-named and confirmation-gated. AC-5.2 remains blocked until `BRAINDRIVE_DESKTOP_VERIFIER_RETENTION_FIXTURE_ROOT` supplies the D-3 incompatible-retained-data fixture. DC-5 remains blocked until `BRAINDRIVE_DESKTOP_VERIFIER_ACCESS_TRACE_PATH` supplies host access-trace records for the authorized mediated branch and both denied direct/stopped branches. The trace and fixture inputs are intentionally not inferred from filesystem hashes.

The US-9 recovery review is emitted as `recovery-review.json`. It covers AC-9.1–AC-9.6, CF-5, IF-2, and IF-3. A formal run supplies `BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_FIXTURE_ROOT` containing the accepted S-1 durable-state seed and RV-1 signed-revocation inputs, plus `BRAINDRIVE_DESKTOP_VERIFIER_RECOVERY_OBSERVATION_PATH` containing the native-driver observations. The observation packet has this shape:

```json
{
  "states": [
    {
      "id": "failed_recoverable",
      "hostState": "failed_recoverable",
      "ownerState": "Needs attention",
      "reason": "The last app change didn't finish. Your data is kept.",
      "actions": ["retry"],
      "visibleText": "Needs attention The last app change didn't finish. Your data is kept. Retry",
      "screenshot": "failed-recoverable.png",
      "ownerDataBefore": { "sha256": "sha256:..." },
      "ownerDataAfter": { "sha256": "sha256:..." },
      "transition": { "deadEnd": false }
    }
  ],
  "retries": [
    {
      "scenario": "interrupted_update",
      "operationBefore": { "operationId": "..." },
      "operationAfter": { "operationId": "...", "recoveryAction": "restore_last_known_good" },
      "noPartialActivation": true,
      "lastKnownGoodSafe": true,
      "ownerDataBefore": { "sha256": "sha256:..." },
      "ownerDataAfter": { "sha256": "sha256:..." }
    }
  ],
  "revocation": {
    "openAttempt": { "opened": false },
    "ownerState": "Needs attention",
    "reason": "BrainDrive stopped this app for safety. Your data is kept.",
    "nextAction": "remove",
    "screenshot": "revoked.png",
    "ownerDataBefore": { "sha256": "sha256:..." },
    "ownerDataAfter": { "sha256": "sha256:..." }
  }
}
```

The native run records a missing S-1/RV-1 packet as `Blocked`; it never treats an unseeded normal app as proof of a failure-state row. A supplied packet with contradictory UI, action-count, screenshot, operation-record, or owner-data evidence is `Failed`. The owner-facing API exposes an additive `owner_attention` projection for recoverable, quarantined, and host-disabled states; the durable host state remains available only in the diagnostic/status record.

The US-8 automatic-check review is emitted as `automatic-review.json`. The Apps preference is off by default, requires the same anonymous-fetch disclosure as the manual catalog check, persists in the isolated browser profile, and refreshes only when the controlled verifier clock crosses the stated six-hour cadence. Automatic requests carry the distinct `automatic` trace trigger; automatic failures are silent; and the verifier compares lifecycle/package state before and after the cadence window so discovery cannot be mistaken for install/update. The optional `BRAINDRIVE_DESKTOP_VERIFIER_BRAINDRIVE_UPDATE_VERSION` input supplies a newer BrainDrive version for the sidebar-indicator leg. C-B automatic app-update and full desktop-restart/BrainDrive-update persistence legs remain blocked until their concrete fixture/build inputs exist.

The E-19 owned-UI review is emitted as `control-inventory-review.json`. It records screenshots and visible controls for the Apps summary, detailed Apps cards, dependency-blocked state, active state, post-uninstall state, other navigation, and Settings. Controls are classified as the five primary actions (Install, Open, Update, Uninstall, Delete data), supporting controls (Refresh, Check automatically, Retry), catalog navigation, or other UI. A visible owner-facing Disable, Enable, or Rollback fails FR-2 and NG-1; lifecycle controls found in Settings or other navigation fail FR-1. The review also records the DOM placement check proving that Check automatically is beside Refresh in Apps.

The remaining E-1/E-2/E-3/TB-5 reviews are emitted as `persona-review.json`, `fault-recovery-review.json`, `authority-review.json`, and `catalog-inventory-review.json`. External packets must be Ed25519-signed and include `candidateDigest` and `fixtureDigest`; the verifier recomputes both before any row can pass. Katie additionally requires raw events beginning with `forum_post_opened` and ending with `open_visible`; setup-screen timestamps or an unsigned `informationBoundary.signed` flag are not accepted. Create a signed packet with `node packet-tools.mjs sign-katie <capture.json> <packet.json> [private-key.pem] [public-key.pem]`, then set the Katie packet, public-key, and fixture-root variables. The F-1 review consumes the fixture root and driver observations through `BRAINDRIVE_DESKTOP_VERIFIER_FAULT_FIXTURE_ROOT` and `BRAINDRIVE_DESKTOP_VERIFIER_FAULT_OBSERVATION_PATH`; it recomputes action counts, lifecycle failure/activation state, owner-data hashes, and durable package-state hashes from raw evidence and never accepts injector-supplied recovery. Desktop fault creation is opt-in with `BRAINDRIVE_DESKTOP_VERIFIER_FAULT_INJECTION=1`, `BRAINDRIVE_DESKTOP_VERIFIER_FAULT_ACTION=install|update`, and `BRAINDRIVE_DESKTOP_VERIFIER_FAULT_POINT=network|disk|restart|verification|activation`. TB-5 consumes a signed manifest/approval/Host capability packet through `BRAINDRIVE_DESKTOP_VERIFIER_TB5_AUTHORITY_PATH`; assemble it with `node packet-tools.mjs assemble-authority <manifest.json> <approval.json> <host-contract.json>`, then sign it with `node packet-tools.mjs sign-packet`. FR-7/FR-8 consume a signed C-F snapshot through `BRAINDRIVE_DESKTOP_VERIFIER_CF_CATALOG_PATH` and the C-F observation packet through `BRAINDRIVE_DESKTOP_VERIFIER_CF_BROWSE_OBSERVATION_PATH` (`packageDownloadRequests: 0`, `packageNetworkCapture`, and `manifestParity`). Metadata-only catalog tracing cannot close the zero-download bar. Missing concrete packets remain `blocked`.

The F-1 legs can be run sequentially on a native host with `npm run desktop:verify:fault-matrix -- --fixture-root <fixture-root> --output <evidence-root>`. It creates fresh isolated profiles for network, disk, restart, verification, and update-activation faults, aggregates the five emitted observations, and writes a separate review result. A non-zero exit from an individual full verifier run is expected while the remaining proof rows are not part of that fault leg; the matrix itself is judged by the aggregate F-1 review. The command is intentionally rejected on Linux and never creates a passing observation without a real desktop run.

Packet signing requires candidate and raw-fixture inputs so the signer writes the digests required by the verifier. Use `sign-katie <capture.json> <packet.json> <private-key.pem> <public-key.pem> <candidate.json> <fixture-root>` or `sign-packet <packet.json> <signed-packet.json> <private-key.pem> <candidate.json> <fixture-root>`.

This does not qualify AL-INST-0.2, cover lifecycle install/update/uninstall behavior, verify any plan row, validate a packaged/signed release build, or prove parity. The WebDriver dependency is opt-in and compile-time guarded against release builds; this prototype is not a release test harness.
