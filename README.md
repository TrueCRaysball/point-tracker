<p align="center">
  <img src="assets/castle-app-icon.png" width="128" alt="Point Tracker icon">
</p>

<h1 align="center">Point Tracker</h1>

<p align="center">A desktop app for keeping track of attendance points and reprimands.</p>

> **Disclaimer:** Point Tracker is an independent tool. It is **not affiliated with or endorsed by The Walt Disney Company (TWDC)**. It is for informational purposes only. CastLife has your official record.

## Features

- **Work Points Progress:** your points in the 30, 90, 180 and 365-day windows, color-coded by how close you are to a reprimand, with when each point drops off.
- **Sick-call occurrences:** consecutive sick call-ins count as one point. The app tracks each occurrence and flags when one reaches the medical-leave limit.
- **Reprimands:** record reprimands when you sign them and choose which points each one uses. The app tracks how many are in effect and when they expire together.
- **Reminders to double-check:**
  - a notice to confirm in CastLife when a point drops off
  - a notice to confirm with leadership when reprimands expire
- **Calendar:** a month view of every day you called out.
- **Your data stays on your computer.** It saves automatically, and you can export and import backups.
- **Light and dark mode.** Every rule (thresholds, windows, occurrence limits) can be changed in Settings.

## Download

Get the latest version from the [**Releases**](../../releases) page.

| Your computer | Download |
|---|---|
| Mac with Apple Silicon (M1 or newer) | `Point.Tracker_x.y.z_aarch64.dmg` |
| Windows 64-bit | `Point.Tracker_x.y.z_x64-setup.exe` |
| Windows 32-bit | `Point.Tracker_x.y.z_x86-setup.exe` |
| Linux 64-bit (Intel/AMD) | `.AppImage`, `.deb` (Ubuntu/Debian) or `.rpm` (Fedora) marked `amd64` / `x86_64` |
| Linux 64-bit (ARM) | `.AppImage`, `.deb` or `.rpm` marked `aarch64` / `arm64` |

Intel Macs are not supported.

### First launch (the builds are not code-signed yet)

**Mac:** open the `.dmg` and drag **Point Tracker** into **Applications**. macOS will block the first launch.
- **macOS 15 or newer:** try to open the app once. Then go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway** next to Point Tracker.
- **Earlier macOS:** right-click (or Control-click) the app, choose **Open**, then click **Open** again.
- **If macOS says the app "is damaged":** run this once in Terminal, then open the app normally:
  ```bash
  xattr -dr com.apple.quarantine "/Applications/Point Tracker.app"
  ```

**Windows:** if SmartScreen shows "Windows protected your PC", click **More info**, then **Run anyway**.

**Linux:**
- **AppImage:** make it executable with `chmod +x Point*.AppImage`, then run it.
- **.deb:** install with `sudo apt install ./Point*.deb`.
- **.rpm:** install with `sudo dnf install ./Point*.rpm`.

## Where your data lives

Your data saves automatically to a single `data.json` file:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/com.craysball.pointtracker/` |
| Windows | `%APPDATA%\com.craysball.pointtracker\` |
| Linux | `~/.local/share/com.craysball.pointtracker/` |

To keep a backup or move your data to another computer, use **Settings → Data → Export Backup / Import Backup**.

## Building from source

Requirements:
- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs)
- On Linux, the [Tauri system packages](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run build          # Point Tracker for this computer → ./builds
npm run build:demo     # Demo version with sample data
npm run build:release  # macOS: Apple Silicon .app + .dmg → ./builds/Release
```

Pushing a tag such as `v1.2.0` runs the [release workflow](.github/workflows/release.yml). It builds every supported platform and attaches the files to a draft release.

**Version and build numbers:**
- The **version** is set in `src-tauri/tauri.conf.json`.
- Every build stamps a **build number** from the build time (`YYMMDDHHmm`), shown in **About Point Tracker**.

**Optional settings:** create a `local.config.json` (it's ignored by git) to change where local builds go, for example:

```json
{ "buildsDir": "../Builds" }
```

## Credits

- Built with [Tauri](https://tauri.app).
- Icons by [Lucide](https://lucide.dev) (ISC license).
- Fonts are [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans), [Outfit](https://fonts.google.com/specimen/Outfit) and [Cabin](https://fonts.google.com/specimen/Cabin) (SIL Open Font License).

---

Copyright © 2026 CRaysball Softworks. All rights reserved.
