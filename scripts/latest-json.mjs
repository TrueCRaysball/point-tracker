// Writes latest.json (what installed apps read to update themselves) from a release's signed update
// packages, and attaches it to that release. The release workflow runs this once, after every
// platform's build has uploaded its files, so no platform can be left out.
//   node scripts/latest-json.mjs v1.8.0            → write and upload (needs the gh CLI, signed in)
//   node scripts/latest-json.mjs v1.8.0 --dry-run  → just print it
//
// Platform keys are the Tauri updater's: "<os>-<arch>" plus "<os>-<arch>-<installer>". An app looks
// for its installer's key first, then the plain one.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const REPO = "TrueCRaysball/point-tracker";
const tag = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!/^v\d+(\.\d+)*$/.test(tag ?? "")) throw new Error("Usage: node scripts/latest-json.mjs v1.2.3 [--dry-run]");

const gh = (...args) => execFileSync("gh", [...args, "--repo", REPO], { encoding: "utf8" });
const release = JSON.parse(gh("release", "view", tag, "--json", "assets"));
const names = release.assets.map((a) => a.name);
const url = (name) => `https://github.com/${REPO}/releases/download/${tag}/${encodeURIComponent(name)}`;

/** Each platform key and the file ending of the package it installs. */
const wanted = [
  ["darwin-aarch64", ["darwin-aarch64-app"], "aarch64.app.tar.gz"],
  ["darwin-x86_64", ["darwin-x86_64-app"], "x64.app.tar.gz"],
  ["windows-x86_64", ["windows-x86_64-nsis"], "_x64-setup.exe"],
  [null, ["windows-x86_64-msi"], "_x64_en-US.msi"],
  ["windows-i686", ["windows-i686-nsis"], "_x86-setup.exe"],
  [null, ["windows-i686-msi"], "_x86_en-US.msi"],
  ["linux-x86_64", ["linux-x86_64-appimage"], "_amd64.AppImage"],
  [null, ["linux-x86_64-deb"], "_amd64.deb"],
  [null, ["linux-x86_64-rpm"], ".x86_64.rpm"],
  ["linux-aarch64", ["linux-aarch64-appimage"], "_aarch64.AppImage"],
  [null, ["linux-aarch64-deb"], "_arm64.deb"],
  [null, ["linux-aarch64-rpm"], ".aarch64.rpm"],
];

const tmp = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
const platforms = {};
for (const [plain, extra, ending] of wanted) {
  const file = names.find((n) => n.endsWith(ending));
  if (!file || !names.includes(`${file}.sig`)) continue;
  gh("release", "download", tag, "--pattern", `${file}.sig`, "--dir", tmp, "--clobber");
  const signature = execFileSync("cat", [`${tmp}/${file}.sig`], { encoding: "utf8" }).trim();
  for (const key of [plain, ...extra].filter(Boolean)) platforms[key] = { signature, url: url(file) };
}
const missing = ["darwin-aarch64", "windows-x86_64", "windows-i686", "linux-x86_64", "linux-aarch64"].filter((k) => !platforms[k]);
if (missing.length) {
  console.error(`No signed update package for: ${missing.join(", ")}. Not writing latest.json.`);
  if (!dryRun) process.exit(1);
}

const json = `${JSON.stringify({ version: tag.slice(1), notes: `https://github.com/${REPO}/releases/tag/${tag}`, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`;
console.log(json);
if (dryRun) process.exit(0);
writeFileSync(`${tmp}/latest.json`, json);
gh("release", "upload", tag, `${tmp}/latest.json`, "--clobber");
console.log(`Attached latest.json to ${tag}.`);
