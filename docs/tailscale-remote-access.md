# Tailscale Remote Access

BrainDrive Desktop can make your local BrainDrive available to your own trusted devices through a private Tailscale network. It uses a private HTTPS `*.ts.net` address. BrainDrive sign-in is still required.

This feature does not create a public link. It does not use Tailscale Funnel, invite another person, support tagged or shared devices, or replace BrainDrive authentication.

## Supported systems

- BrainDrive Desktop on Windows or macOS. Browser-only, managed, Docker, Linux, and WSL installations cannot manage this feature.
- Tailscale 1.98.8 or newer on the computer running BrainDrive and a current Tailscale client on each trusted device.
- Windows 10 or later, Windows Server 2016 or later, or macOS 12 Monterey or later, following Tailscale's current client requirements.

Install Tailscale separately using its official instructions:

- [Install Tailscale on Windows](https://tailscale.com/docs/install/windows)
- [Install Tailscale on macOS](https://tailscale.com/docs/install/mac)

BrainDrive does not install Tailscale, create a Tailscale account, sign you in, collect Tailscale credentials, issue auth keys, or change your tailnet access policy. No Tailscale or BrainDrive credentials are bundled with Remote Access.

## Before you enable Remote Access

1. Open BrainDrive Desktop on the host computer and create the local BrainDrive owner account if you have not already done so.
2. Install Tailscale on the host computer and sign in through Tailscale's normal flow.
3. Install Tailscale on the second device you control and sign it in to the same private Tailscale network.
4. Confirm that Tailscale shows both devices as connected.
5. Keep the host awake, online, connected to Tailscale, and running BrainDrive while using Remote Access.

Use an owner-controlled device. V1 does not support borrowed devices, another person's Tailscale identity, cross-user sharing, machine sharing, or tagged devices.

## Enable Remote Access

1. In BrainDrive Desktop, open **Settings > Remote Access**.
2. Review the private-access and host-availability disclosures.
3. Select **Enable Remote Access**.
4. If the panel shows **Needs setup**, complete the indicated Tailscale step. When **Complete Tailscale setup** is available, it opens the setup or HTTPS-consent page supplied by Tailscale. BrainDrive never asks you to paste Tailscale credentials into the app.
5. Return to BrainDrive and select **Check again** or **Retry**.
6. Wait for **Running** and one private HTTPS address ending in `.ts.net`.

BrainDrive checks the existing Tailscale Serve configuration before changing anything. It refuses to enable when the HTTPS listener is occupied or ownership is uncertain. It never runs a global Serve reset and never falls back to a LAN address, raw Tailscale IP, direct gateway bind, or public endpoint.

## Connect from another trusted device

1. Leave BrainDrive Desktop running on the host.
2. On the second device, confirm that Tailscale is connected to the same tailnet.
3. Use **Copy** to copy the private address, then open it on the second device. **Open Remote Access** opens it on the host and is useful only as a local check; it does not prove that another device can connect.
4. Sign in with the normal BrainDrive owner credentials.

An unauthenticated device can load the sign-in surface but cannot read owner data or use protected BrainDrive actions. Tailscale identity and the desktop bridge's internal transport token are not BrainDrive owner authentication.

## Statuses and actions

| Status | Meaning | Usual next action |
| --- | --- | --- |
| **Off** | BrainDrive Remote Access is disabled. | **Enable Remote Access** |
| **Needs setup** | Tailscale is missing, signed out, offline, too old, unavailable, or waiting for HTTPS consent. | Follow the guidance, then **Check again** or **Complete Tailscale setup**. |
| **Ready to enable** | Tailscale and the selected Serve listener are ready. | **Enable Remote Access** |
| **Starting** | BrainDrive is starting and verifying the private bridge and Serve mapping. | Wait; the panel checks again automatically. |
| **Running** | The localhost bridge and exact BrainDrive-owned Serve mapping were verified live. | **Copy**, **Open Remote Access**, **Check again**, or **Turn off** |
| **Conflict** | Existing or changed Tailscale configuration cannot safely be adopted or overwritten. | Preserve it, inspect the conflict, and retry only after it is resolved. |
| **Needs attention** | A command, bridge, status read, saved ownership record, or cleanup could not be verified safely. | Read **Technical details**, correct the reported condition, then **Retry** or **Check again**. |

The displayed address is authoritative only while the panel reports **Running**. A saved or copied address does not prove that the host is currently reachable.

## Restart, sleep, and network changes

- Closing BrainDrive stops its local Remote Access bridge. The private address will not load until BrainDrive Desktop is running again.
- The enabled preference and the BrainDrive-owned background Serve mapping remain in place when BrainDrive quits. Relaunching BrainDrive rereads live state and restores the localhost bridge only when ownership is still exact.
- Tailscale normally resumes a background Serve mapping after its daemon or the computer restarts. BrainDrive still must be running for the local target to answer.
- After sleep, a network change, or a Tailscale interruption, reopen the panel and select **Check again**. Remote Access never falls back to a public, LAN, or raw-IP route.

## Turn off safely

1. Open **Settings > Remote Access** in BrainDrive Desktop.
2. Select **Turn off**.
3. Wait for **Off**. BrainDrive rereads live Serve state before reporting success.

BrainDrive removes only the exact, unchanged mapping recorded as BrainDrive-owned. Unrelated Serve listeners, paths, Services, Funnel settings, tailnet policy, Browser Access settings, providers, credits, and memory are not changed.

If the panel reports **Conflict** or **Needs attention**, do not run `tailscale serve reset`. A global reset can remove unrelated configuration. Preserve the current state and use the troubleshooting steps below.

## Troubleshooting

| Technical detail or symptom | What to do |
| --- | --- |
| Remote Access is not shown | Use a local packaged BrainDrive Desktop app on Windows or macOS. Managed and ordinary browser sessions cannot manage host networking. |
| **Owner not initialized** | Create the BrainDrive owner account locally in the desktop app before enabling Remote Access. |
| **Not installed** | Install Tailscale from the official Windows or macOS guide, sign in, then select **Check again**. |
| **Permission denied** | Open Tailscale normally and confirm the current OS user can use it. Do not change permissions on Tailscale executables as a workaround. |
| **Unsupported version** | Update Tailscale to 1.98.8 or newer, reconnect it, then select **Check again**. |
| **Daemon unavailable** | Open or restart the Tailscale app, wait for it to connect, then select **Check again**. |
| **Not signed in** | Sign in through the Tailscale app using the owner-controlled tailnet, then select **Check again**. |
| **Offline** | Restore network access and reconnect Tailscale on the host. |
| **Missing DNS** | Wait for Tailscale to assign the host a private DNS name. Check Tailscale DNS settings if the condition persists. |
| **Consent required** | Use **Complete Tailscale setup**, approve HTTPS for the tailnet in Tailscale, return to BrainDrive, and select **Retry**. |
| **Conflict** or **stale ownership** | Do not reset or overwrite Serve configuration. If another listener uses HTTPS port 443 or the recorded mapping changed, restore the expected state or ask the person who manages that configuration for help. |
| **Bridge unavailable** | Keep BrainDrive running, select **Retry**, and check whether local security software is blocking BrainDrive child processes. |
| **Command timeout**, **command failed**, malformed output, or output too large | Update/restart Tailscale and select **Retry**. If it repeats, collect the safe support information below. |
| **Persistence** | BrainDrive could not save its local ownership record. Do not manually change the Serve mapping; check available disk space and local app-data permissions, then retry. |
| **Ambiguous outcome** or cleanup warning | Access might still be configured. Do not assume it is on or off, and do not reset Serve. Preserve the state and escalate with sanitized evidence. |
| **Internal** or the desktop runtime has not started | Keep the local app open, restart BrainDrive Desktop, and select **Check again**. If it repeats, collect the safe support information below. |
| The address works on the host but not the second device | Confirm the second device is online in the same tailnet and allowed by the tailnet access policy. A host-local **Open Remote Access** result is not remote proof. |
| The address stopped working | Wake the host, restore its network and Tailscale connection, start BrainDrive Desktop, then select **Check again**. |

## Logs and safe support information

Expand **Technical details** and record only:

- the owner-facing status;
- readiness, ownership, bridge, and error labels;
- the approximate time of the failed action;
- BrainDrive, operating system, and Tailscale versions; and
- whether the host and second device appeared online in Tailscale.

Remote Access lifecycle events are written to BrainDrive's `supervisor.log`. Child-process output uses `tailscale-access.stdout.log` and `tailscale-access.stderr.log`. On Windows these files are under `%LOCALAPPDATA%\BrainDrive\logs`; on macOS they are in BrainDrive's platform app-log directory.

Review and redact logs before sharing them. Never share raw Tailscale status or Serve dumps, private `.ts.net` addresses, device or tailnet names, Tailscale login names, IP addresses, consent URLs, cookies, passwords, API keys, auth keys, access or refresh tokens, desktop tokens, internal transport tokens, or provider credentials.

## Downgrade or remove BrainDrive

Turn off Remote Access and verify **Off** before downgrading or uninstalling BrainDrive. Older BrainDrive versions do not know how to remove this feature's persistent Serve mapping.

If BrainDrive cannot start, do not use `tailscale serve reset`. Ask for support and verify the exact live mapping before any listener-scoped removal. An old, missing, or malformed BrainDrive state file is intentionally not enough authority to delete Tailscale configuration.

## Security boundaries

- Remote Access is tailnet-only and HTTPS-only. BrainDrive does not configure Tailscale Funnel or a public internet endpoint.
- BrainDrive proxies only to a dedicated loopback bridge; it does not expose the gateway directly.
- Normal BrainDrive authentication, secure session cookies, logout, signup restrictions, and rate limiting remain in force.
- Tailscale user headers are used only to separate rate-limit buckets through a one-way identifier. Raw Tailscale identity is removed before gateway processing and is not saved as BrainDrive identity.
- Remote browsers cannot invoke Tauri desktop commands or manage host networking.
- Remote Access configuration is local desktop state outside Your Memory and is not included in memory backup/export.

For background on the network boundary, see Tailscale's official [Serve overview](https://tailscale.com/docs/features/tailscale-serve) and [Serve CLI reference](https://tailscale.com/docs/reference/tailscale-cli/serve).
