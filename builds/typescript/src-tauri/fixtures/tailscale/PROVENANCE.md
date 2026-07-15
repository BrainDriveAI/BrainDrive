# Tailscale CLI fixture provenance

Milestone 1 captures only sanitized, non-secret structure. It never stores raw
tailnet names, user identities, Tailscale IPs, or consent tokens.

## Native Windows evidence

- Host: Windows 11, reached from the repository's WSL2 development shell.
- Client: Tailscale `1.98.8` (`1.98.8-t1241b225b-g0520dfda5`).
- Captured 2026-07-14 with the installed Windows CLI at
  `C:\Program Files\Tailscale\tailscale.exe`.
- `windows-1.98.8-status-ready.json` is a minimized projection of live
  `tailscale status --json`; the device and tailnet DNS labels were replaced.
- `windows-1.98.8-version.txt` is the non-secret live `tailscale version`
  output.
- `windows-1.98.8-serve-empty.json` is the live empty
  `tailscale serve status --json` result.
- `windows-1.98.8-consent-required.txt` is a sanitized template of the live
  consent-required classification. The real URL/query was not retained or
  opened. The bounded command left the Serve configuration empty.

HTTPS consent was not approved in this environment. Consequently the mapping,
conflict, and targeted-off JSON files are contract fixtures derived from the
official Tailscale 1.98.8 `ipn.ServeConfig` JSON schema and current Serve CLI
documentation, not native capture evidence. They use reserved example DNS
labels and loopback-only placeholder targets. Native before/after mapping and
targeted-off evidence remains required after consent is approved in an
authorized isolated Windows test environment.

The signed-out, offline, missing-DNS, malformed, truncated, Service, Funnel,
and ambiguity files are deterministic safety scenarios based on the same
documented JSON fields. They were not produced by changing the connected
Windows host into those states. Their names deliberately omit the native
Windows capture prefix.

The `service-config-*` files use the official `serve get-config --all` schema
version `0.0.1` documented by current Tailscale source/issues. They are
contract fixtures, not live service declarations from this host.

## Platform-neutral and macOS obligation

The parsers intentionally use the shared CLI JSON fields (`Version`,
`BackendState`, `Self.Online`, `Self.DNSName`, `TCP`, `Web`, `Services`,
`AllowFunnel`, and `Foreground`) rather than OS-specific presentation or map
order. Discovery includes the documented Windows application location, the
macOS app-bundle CLI, common Homebrew locations, and PATH lookup. Process
execution uses executable-plus-argument arrays, bounded time, bounded capture,
and hidden Windows child processes.

No native macOS fixture was available during Milestone 1. Do not treat these
fixtures or WSL execution as native macOS evidence. Milestone 5 must capture
and compare native macOS version/status/Serve/config/targeted-off behavior and
raise the minimum supported client version if the contracts differ.
