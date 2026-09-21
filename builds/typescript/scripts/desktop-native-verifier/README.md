# Native desktop verifier prototype

This is an exploratory first slice of AL-INST-0.2's screen/input-capture instrument. It uses Tauri's embedded W3C WebDriver endpoint with a small Node built-in HTTP client, so it needs no external driver or additional npm test packages. The same scenario can run on Windows and macOS, including over SSH when the Mac has an active GUI session.

From `builds/typescript`, run:

```sh
npm run desktop:verify:native
```

The command builds the local runtime and frontend, compiles the debug Tauri app with the opt-in `desktop-verifier` Cargo feature, and runs one native scenario. The scenario uses an isolated app-data and log profile under the OS temporary directory, captures the first-run setup screen, types a synthetic value into the Username field, verifies and clears it, and never submits credentials. Set `BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS` to choose a persistent evidence directory.

Each run creates a new subdirectory under the OS temporary directory (or under the directory supplied via `BRAINDRIVE_DESKTOP_VERIFIER_ARTIFACTS`) and writes `candidate.json`, `run-result.json`, `screen-input-evidence.json`, screenshots, and app logs. The app-data profile is intentionally retained for inspection and is not automatically deleted.

This does not qualify AL-INST-0.2, cover lifecycle install/update/uninstall behavior, verify all plan rows, validate a packaged/signed release build, or prove parity. The WebDriver dependency is opt-in and compile-time guarded against release builds; this prototype is not a release test harness.
