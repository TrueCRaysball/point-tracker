// "What's New" splash: shown once, the first time a new version opens.
//
// Add an entry at the top for each release. Work that hasn't been released yet goes under
// version "next"; give it the real version number when the version is bumped.
//
// features: the headline changes, shown as cards ({ icon: lucide name, color, title, text }).
// also: smaller improvements and fixes, shown as a short list.

export const NOTES = [
  {
    version: "1.8.1",
    features: [
      {
        icon: "pt-leave", color: "blue", title: "Leaves, Not Just Medical",
        text: "The Medical Leaves page is now Leaves. Track a personal leave of absence, parental leave, bereavement, military leave or jury duty the same way: details, a timeline, notes, reminders and documents. Medical leaves work just as before.",
      },
      {
        icon: "settings", color: "purple", title: "A Tidier Settings Page",
        text: "Settings is now in two columns: how the app looks, syncs and saves on one side, and your attendance rules on the other.",
      },
    ],
    also: [
      "The Overview tab is now called Home.",
      "What's New has a close button in the corner, so you don't have to scroll to the bottom.",
      "Restore Defaults now asks first, and keeps your auto-save setting.",
    ],
  },
  {
    version: "1.8.0",
    features: [
      {
        icon: "download", color: "blue", title: "Updates Install Themselves",
        text: "On Mac and Windows, Point Tracker now checks for new versions on its own. When one is out, click Install Update and it downloads, installs and restarts by itself, with no more dragging into Applications. Your records stay just as they are.",
      },
      {
        icon: "flask-conical", color: "purple", title: "Point Tracker Is in Beta",
        text: "It's still being polished, so things may change as it grows. Look for the BETA badge next to the name.",
      },
    ],
    also: [
      "Check for updates any time in Settings → Help or the About box.",
      "Linux: the AppImage updates itself too. Installs from a package manager (.deb, .rpm, AUR) get a notice instead.",
      "The Home Screen (phone) version keeps updating itself the way it always has.",
    ],
  },
  {
    version: "1.7.1",
    also: [
      "The What's New screen now waits until an update has finished installing, so you get to read it.",
      "Missed what was new in 1.7.0? It's in Settings → Help → What's New any time.",
    ],
  },
  {
    version: "1.7.0",
    features: [
      {
        icon: "refresh-cw", color: "blue", title: "Nearby Sync",
        text: "Pair your computer and phone once with a QR code, and they keep each other up to date: call-ins, reprimands, medical leaves, documents and settings. No account and no cloud storage; the devices talk to each other directly, encrypted.",
      },
      {
        icon: "git-merge", color: "teal", title: "Nothing gets overwritten",
        text: "Changes from both devices are merged. The newest version of each record wins, and deletions carry over too.",
      },
    ],
    also: [
      "Find it in Settings → Nearby Sync. Both devices need Point Tracker open to sync.",
      "Deleting a medical leave or document on the desktop now asks first.",
      "Renaming a document on the desktop opens a proper rename box.",
    ],
  },
  {
    version: "1.6.0",
    features: [
      {
        icon: "heart-pulse", color: "red", title: "Medical Leaves",
        text: "A full page for each leave: details, a timeline, notes, upcoming dates and all your documents in one place.",
      },
      {
        icon: "file-search", color: "purple", title: "Built-in File Viewer",
        text: "PDFs, Word documents, spreadsheets, photos (including HEIC and TIFF), text, audio and video open right inside the app.",
      },
      {
        icon: "monitor", color: "teal", title: "Made for Big Screens",
        text: "On ultrawide monitors the layout stays centered instead of stretching edge to edge.",
      },
    ],
    also: [
      "Styled scrollbars and sideways scrolling on the desktop.",
      "Card text adjusts to fit any window size.",
    ],
  },
];

// Release stage shown with every version number ("Beta 1.8.0"). The version itself stays a plain
// number, which the updater and GitHub's "latest release" need. Set STAGE to "" when the beta is over.
export const STAGE = "Beta";

/** How a version is shown to people: "Beta 1.8.0". */
export function versionName(v) {
  if (!v || !STAGE || !/^\d/.test(v)) return v;
  return `${STAGE} ${v}`;
}

/** -1, 0 or 1, comparing "1.6.0"-style versions. */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/**
 * The notes to show for the running version, given the last version whose notes were seen.
 * Never seen any: just the newest notes. Otherwise: every version since.
 */
export function notesSince(seen, current) {
  const forThis = (n) => n.version === "next" || compareVersions(n.version, current) <= 0;
  if (!seen) return NOTES.filter(forThis).slice(0, 1);
  return NOTES.filter((n) => forThis(n) && (n.version === "next" || compareVersions(n.version, seen) > 0));
}

/** The newest few versions' notes (up to the running one), for opening What's New by hand. */
export function recentNotes(current, count = 3) {
  return NOTES.filter((n) => n.version === "next" || compareVersions(n.version, current) <= 0).slice(0, count);
}
