# BrainDrive Bootstrap Installers

These scripts are intended for no-clone installation from GitHub-hosted raw URLs.

Developer orientation: use the [developer index](../../docs/developers/README.md), [repository map](../../docs/developers/repository-map.md), and [security/release routes](../../docs/developers/repository-map.md#security-and-release). This page remains the source-adjacent trust reference for pinned bootstrap behavior.

Files:
- `install.sh` (macOS/Linux/WSL)
- `install.ps1` (Windows PowerShell)
- `update.sh` (macOS/Linux/WSL)
- `update.ps1` (Windows PowerShell)

Default behavior:
1. Download the installer archive and `SHA256SUMS` from one pinned BrainDrive release tag.
2. Verify the archive SHA-256 before extracting or running it.
3. Carry the embedded BrainDrive release-key fingerprint into the installer.
4. Place installer files in `~/.braindrive/installer/docker`.
5. Run installer in `local` mode (image-based HTTP on `http://127.0.0.1:8080`).

Raw URL usage examples:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/install.ps1 | iex`

Update examples:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/update.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/<release-tag>/installer/bootstrap/update.ps1 | iex`

Trust behavior:
- Do not replace `<release-tag>` with `main`; use a published date tag such as `26.7.23`.
- Release metadata keys must match the fingerprint embedded in the pinned bootstrap and installer scripts.
- When signature verification is enabled, the installer can auto-install pinned cosign v3.0.6 after verifying its embedded platform checksum.

Mode overrides:
- Local (default): no argument.
- Quickstart (legacy alias): accepted and mapped to `local`.
- Production:
  - shell: `curl .../install.sh | bash -s -- prod`
  - PowerShell: `$env:BRAINDRIVE_BOOTSTRAP_MODE='prod'; irm .../install.ps1 | iex`
- Local mode:
  - shell: `curl .../install.sh | bash -s -- local`
  - PowerShell: `$env:BRAINDRIVE_BOOTSTRAP_MODE='local'; irm .../install.ps1 | iex`

Optional runtime overrides:
- `BRAINDRIVE_BOOTSTRAP_MODE` (default: `local`)
- `BRAINDRIVE_BOOTSTRAP_REPO` (default: `BrainDriveAI/BrainDrive`)
- `BRAINDRIVE_BOOTSTRAP_RELEASE_TAG` (default: release tag embedded in the script)
- `BRAINDRIVE_BOOTSTRAP_ARCHIVE_NAME` (default: `braindrive-installer-<release-tag>.tar.gz`)
- `BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL` (override full archive URL)
- `BRAINDRIVE_BOOTSTRAP_SHA256SUMS_URL` (override full `SHA256SUMS` URL)
- `BRAINDRIVE_INSTALL_ROOT` (default: `~/.braindrive`)
- `BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH=true` (force installer refresh)
