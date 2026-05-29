# Desktop Installer Release Links

BrainDrive desktop releases should publish both versioned installer artifacts and stable "latest" aliases.

Versioned artifacts are useful for audit history, for example:

- `BrainDrive_26.5.25_x64-setup.exe`
- `BrainDrive_26.5.25_x64.dmg` or the DMG produced by the macOS build host

Stable aliases are useful for website download links:

- `BrainDrive-latest-windows-x64-setup.exe`
- `BrainDrive-latest-macos.dmg`

GitHub redirects these URLs to the newest non-prerelease release that has a matching asset name:

- `https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/BrainDrive-latest-windows-x64-setup.exe`
- `https://github.com/BrainDriveAI/BrainDrive/releases/latest/download/BrainDrive-latest-macos.dmg`

After building desktop installers, run:

```sh
npm run desktop:release-aliases
```

The helper copies the newest Windows NSIS installer and/or macOS DMG into:

```text
builds/typescript/src-tauri/target/release/bundle/latest/
```

Upload the files in that `latest` directory, plus the versioned artifacts, to the GitHub Release. The website can use the stable alias URLs and does not need to change for each weekly version.
