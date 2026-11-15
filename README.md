<p align="center">
  <img src="assets/castle-app-icon.png" width="128" alt="Point Tracker icon">
</p>

<h1 align="center">Point Tracker</h1>

<p align="center">An app for keeping track of attendance points, reprimands and medical leaves, on your computer and your phone.</p>

<p align="center"><b>Beta:</b> Point Tracker is still being polished, so things may change.</p>

> **Disclaimer:** Point Tracker is an independent tool. It is **not affiliated with or endorsed by The Walt Disney Company (TWDC)**. It is for informational purposes only. CastLife has your official record.

## Features

- **Work Points Progress:** your points in the 30, 90, 180 and 365-day windows, color-coded by how close you are to a reprimand, with when each point drops off.
- **Call-ins:** Call In Sick, Call In Personal, Worked / Returned, ADO, Picked Up Shift, Dropped Shift, or Other (your own label). Each entry can hold the shift you called out of, when you submitted it to CastLife, a note and attachments. Points follow the rules, and you can override them.
- **Sick-call occurrences:** consecutive sick call-ins count as one point. The app tracks each occurrence and flags when one reaches the medical-leave limit.
- **Reprimands:** record reprimands when you sign them and choose which points each one uses (or let **Select points in window** pick them). A banner tells you when you've earned one, and the app tracks how many are in effect and when they expire together.
- **Leaves:** medical leaves and any other kind (personal leave of absence, parental, bereavement, military, jury duty). Each gets a page with its details (type, status, claim number, care provider for medical leaves, expected return), a timeline, notes, upcoming dates and reminders, and all its documents. Close it out with **Return to Work**, and search past leaves any time.
- **Reminders to double-check:**
  - a notice to confirm in CastLife when a point drops off
  - a notice to confirm with leadership when reprimands expire
- **Calendar:** a month view of every day you called out.
- **View as of another date:** see your points as they were, or will be, on any day.
- **Built-in file viewer:** attachments open right in the app, with no other program needed. It handles PDFs, Word documents (.docx), spreadsheets (Excel, CSV, OpenDocument), images (JPG, PNG, GIF, WebP, HEIC, SVG, TIFF and more), text and RTF files, and audio or video. Anything else can still be opened with another app.
- **Nearby Sync:** pair your computer and phone once with a QR code, and they keep each other up to date (call-ins, reprimands, medical leaves, documents and settings) with no account and no cloud storage. Both need Point Tracker open at the same time. Changes are merged, so nothing gets overwritten. Not available on Linux builds whose web view lacks WebRTC.
- **Updates install themselves (desktop, from 1.8.0):** the app checks for a new version when it opens and every 15 minutes. Click **Install Update** and it downloads, installs and restarts, on Mac, Windows and the Linux AppImage. Linux `.deb` and `.rpm` installs get a notice instead, since the package manager handles those. The phone version updates itself.
- **Phone version:** a Home Screen web app with a phone-friendly layout that works offline (see [On your phone](#on-your-phone)).
- **Getting started:** a welcome screen, a guided tour you can take again any time, and a What's New screen after each update.
- **Your data stays on your device.** It saves automatically, and you can export and import backups.
- **Make it yours:** light, dark or system theme; call-ins and reprimands as tabs or side by side; and every rule (thresholds, windows, points per call type, occurrence limits, reprimand length) can be changed in Settings.

## Download

Get the latest version from the [**Releases**](../../releases) page.

| Your computer | Download |
|---|---|
| Mac with Apple Silicon (M1 or newer) | `Point.Tracker_x.y.z_aarch64.dmg` |
| Windows 64-bit | `Point.Tracker_x.y.z_x64-setup.exe` |
| Windows 32-bit | `Point.Tracker_x.y.z_x86-setup.exe` |
| Linux 64-bit (Intel/AMD) | `.AppImage`, `.deb` (Ubuntu/Debian) or `.rpm` (Fedora) marked `amd64` / `x86_64` |
| Linux 64-bit (ARM) | `.AppImage`, `.deb` or `.rpm` marked `aarch64` / `arm64` |
| iPhone or Android | The Home Screen version (see [On your phone](#on-your-phone)) |

Intel Macs are not supported. An Arch Linux (AUR) package is coming; until then, Arch users can use the AppImage.

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

## On your phone

Open **https://truecraysball.github.io/point-tracker/** on your phone and add it to your Home Screen:
- **iPhone:** in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** in Chrome, tap the **⋮** menu, then **Add to Home screen** (or **Install app**).

It works offline, updates itself (tap **Update Now** when the notice shows), and keeps your data on your phone only; the website just serves the app's files. Use [Nearby Sync](#how-nearby-sync-works) to keep it matched with your computer.

## Where your data lives

Your data saves automatically to a single `data.json` file:

| OS | Location |
|---|---|
| macOS | `~/Library/Application Support/com.craysball.pointtracker/` |
| Windows | `%APPDATA%\com.craysball.pointtracker\` |
| Linux | `~/.local/share/com.craysball.pointtracker/` |

On the phone version, data is kept in the browser's storage for the Home Screen app. Removing the app from your Home Screen (or clearing Safari's website data) deletes it, so export a backup first.

To keep a backup or move your data to another device, use **Settings → Data → Export Backup / Import Backup**.

### How Nearby Sync works

- **Pairing** shows a QR code (and a typed code) holding a secret key. The key stays on your paired devices.
- **Finding each other:** devices use PeerJS's free public server only to find each other, then connect directly (WebRTC). When a direct connection isn't possible, PeerJS's relay server forwards the data.
- **Encryption:** everything sent is encrypted with the pairing key (AES-GCM), so neither server can read or change your data, and nothing is stored on them.
- **Merging:** each record carries the time it last changed, and deletions are remembered, so the newest change wins and nothing is wiped.

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
npm run web            # Prepares src/ as the phone (Home Screen) version
```

**Releases:** pushing a tag such as `v1.2.0` runs the [release workflow](.github/workflows/release.yml):
1. It creates one draft release.
2. It builds every supported platform, signs each update package and uploads the files.
3. It writes `latest.json` (see [Updates](#updates)) from all the signed packages.

Check the draft, then publish it; installed apps see the update once it's published. To redo an existing tag's release, run the workflow from the Actions tab and enter the tag.

**Phone version:** every push to `main` that changes the app redeploys it to GitHub Pages ([pages workflow](.github/workflows/pages.yml)).

**Version and build numbers:**
- The **version** is set in `src-tauri/tauri.conf.json`.
- Every build stamps a **build number** from the build time (`YYMMDDHHmm`), shown in **About Point Tracker**.
- The **stage label** ("Beta") is `STAGE` in `src/whatsnew.js`. It's shown with every version number ("Beta 1.8.0"), while the version itself stays a plain number. Set it to `""` when the beta is over.
- **What's New** notes go in `src/whatsnew.js`, one entry per version.

**Optional settings:** create a `local.config.json` (it's ignored by git) to change where local builds go, for example:

```json
{ "buildsDir": "../Builds" }
```

## Updates

Installed apps (1.8.0 and newer) read `latest.json` from the newest **published** GitHub release, at `releases/latest/download/latest.json`. That's a download from GitHub's file servers, not its rate-limited API, so it holds up with any number of users. Drafts and pre-releases are skipped, so don't mark a release as a pre-release.

The release workflow signs every update package, and the app installs only packages signed with the matching key. The public half is `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. The private half and its password are repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/point-tracker-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the contents of `~/.tauri/point-tracker-updater.password`

**Back up both files somewhere safe (a password manager).** If they're lost, installed apps can't accept any future update, and everyone has to download a new version by hand once.

## Arch Linux package (AUR)

Not published yet. When it is, Arch users will get Point Tracker from the AUR as `point-tracker-bin` (`yay -S point-tracker-bin`), which installs the `.deb` from each GitHub release. After a release is published:

1. Run `node scripts/aur.mjs`. It downloads that release's `.deb` files and writes `packaging/aur/PKGBUILD` and `.SRCINFO` with the new version and checksums.
2. Copy both files into the AUR repository (`ssh://aur@aur.archlinux.org/point-tracker-bin.git`), then commit and push.

## Credits

- Built with [Tauri](https://tauri.app).
- Icons by [Lucide](https://lucide.dev) (ISC license).
- File viewer:
  - [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0)
  - [Mammoth](https://github.com/mwilliamson/mammoth.js) (BSD 2-Clause)
  - [SheetJS Community Edition](https://sheetjs.com) (Apache 2.0)
  - [UTIF.js](https://github.com/photopea/UTIF.js) (MIT) and [pako](https://github.com/nodeca/pako) (MIT)
  - [heic2any](https://github.com/alexcorvi/heic2any) (MIT)
- Nearby Sync:
  - [PeerJS](https://peerjs.com) (MIT)
  - [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT)
  - [jsQR](https://github.com/cozmo/jsQR) (Apache 2.0)
- Fonts are [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans), [Outfit](https://fonts.google.com/specimen/Outfit) and [Cabin](https://fonts.google.com/specimen/Cabin) (SIL Open Font License).

---

Copyright © 2026 CRaysball Softworks. All rights reserved.
