// "What's New" splash: shown once, the first time a new version opens.
//
// Add an entry at the top for each release. Work that hasn't been released yet goes under
// version "next"; give it the real version number when the version is bumped.
//
// features: the headline changes, shown as cards ({ icon: lucide name, color, title, text }).
// also: smaller improvements and fixes, shown as a short list.

export const NOTES = [
  {
    version: "2.3.0",
    features: [
      {
        icon: "phone", color: "blue", title: "Call-ins and Reprimands Pages",
        text: "Both now have their own page in the sidebar. Call-ins shows the full list with this year's numbers (call-ins, occurrences, points, days since the last one) and each points window as a meter with its next drop-off. Reprimands shows your status, a plain summary of the rules, and every reprimand you've signed.",
      },
    ],
    also: [
      "Settings and About sit at the bottom of the sidebar, with the logo and version underneath.",
      "The reprimand countdown shows the percentage remaining again, and its icon changes with how many are in effect.",
    ],
  },
  {
    version: "2.2.0",
    features: [
      {
        icon: "layout-dashboard", color: "blue", title: "A New Home Layout",
        text: "On the computer, the pages move to a slim glass sidebar on the left (hover over an icon to see its name). Home now leads with one card for reprimands: a countdown to when they expire, how many are in effect and how close you are to termination, plus quick numbers for days completed, total points and days since your last call-in. Beside it, Work Points Progress shows each window with the date the next point drops off.",
      },
    ],
    also: [
      "The reprimand markers are now slanted glass bars that glow red as reprimands add up.",
      "The progress rings, leave timeline and page dots now use the same gradients as the rest of the app.",
    ],
  },
  {
    version: "2.1.0",
    features: [
      {
        icon: "user-x", color: "red", title: "Remove Synced Devices",
        text: "In Settings → Nearby Sync, each paired device now has a remove button. Use it for a phone you replaced or reset, or any device that shouldn't sync anymore. A removed device is told so and stops syncing; your records stay on both. Pair it again any time to bring it back.",
      },
    ],
    also: [
      "On the phone, the header waves fade into the page, and the leave banner is laid out as a tidy card.",
      "The What's New screen's header now fades its waves into the background, like the main header.",
    ],
  },
  {
    version: "2.0.0",
    features: [
      {
        icon: "palette", color: "purple", title: "A Fresh New Look",
        text: "A new logo and app icon, flowing waves across the top, glossy glass panels and pop-ups with gradient buttons, and progress cards that fill with a wave in their color, so you can see at a glance how close each window is to a reprimand.",
      },
    ],
    also: [
      "On smaller screens, Home and Calendar now scroll, so the call-in and reprimand tables are never cut off.",
      "The window can be made shorter, to fit laptop screens with a taskbar.",
      "Clicking a call-in that started a leave opens its details again, with a link to the leave.",
    ],
  },
  {
    version: "1.8.2",
    features: [
      {
        icon: "lock", color: "green", title: "Password-Protected Backups",
        text: "Backups can now be locked with a password. The whole file, including your leave details and documents, is encrypted before it's saved, and it can't be opened without the password. It's on by default when you export.",
      },
    ],
    also: [
      "Export explains what a backup holds, so it doesn't get shared by mistake.",
      "Tighter security inside the app: it only runs its own code and only connects where Nearby Sync needs to.",
      "Importing a backup from before Leaves existed no longer causes problems.",
    ],
  },
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
