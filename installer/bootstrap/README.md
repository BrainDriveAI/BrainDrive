# BrainDrive Bootstrap Installers

These scripts are intended for no-clone installation from GitHub-hosted raw URLs.

Files:
- `install.sh` (macOS/Linux/WSL)
- `install.ps1` (Windows PowerShell)
- `update.sh` (macOS/Linux/WSL)
- `update.ps1` (Windows PowerShell)

Default behavior:
1. Download installer files from the BrainDrive GitHub repository archive.
2. Place installer files in `~/.braindrive/installer/docker`.
3. Run installer in `quickstart` mode (image-based HTTP on `http://127.0.0.1:8080`).

Raw URL usage examples:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/install.ps1 | iex`

Update examples:
- macOS/Linux:
  - `curl -fsSL https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/update.sh | bash`
- Windows PowerShell:
  - `irm https://raw.githubusercontent.com/BrainDriveAI/BrainDrive/main/installer/bootstrap/update.ps1 | iex`

Mode overrides:
- Quickstart (default): no argument.
- Production:
  - shell: `curl .../install.sh | bash -s -- prod`
  - PowerShell: `$env:BRAINDRIVE_BOOTSTRAP_MODE='prod'; irm .../install.ps1 | iex`
- Local source-build mode:
  - shell: `curl .../install.sh | bash -s -- local`
  - PowerShell: `$env:BRAINDRIVE_BOOTSTRAP_MODE='local'; irm .../install.ps1 | iex`

Optional runtime overrides:
- `BRAINDRIVE_BOOTSTRAP_MODE` (default: `quickstart`)
- `BRAINDRIVE_BOOTSTRAP_REPO` (default: `BrainDriveAI/BrainDrive`)
- `BRAINDRIVE_BOOTSTRAP_REF` (default: `main`)
- `BRAINDRIVE_BOOTSTRAP_ARCHIVE_URL` (override full archive URL)
- `BRAINDRIVE_INSTALL_ROOT` (default: `~/.braindrive`)
- `BRAINDRIVE_BOOTSTRAP_FORCE_REFRESH=true` (force installer refresh)
