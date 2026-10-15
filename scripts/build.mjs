// Local build: picks the right bundle format for this OS and copies the result into the builds folder.
//   node scripts/build.mjs           → Point Tracker
//   node scripts/build.mjs demo      → Point Tracker Demo (sample data)
//   node scripts/build.mjs release   → clean release build (macOS: Apple Silicon .app + .dmg)
// Output goes to ./builds, or to "buildsDir" in an optional, untracked local.config.json.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stamp } from "./stamp.mjs";

const mode = process.argv[2] ?? "app";
const demo = mode === "demo";
const release = mode === "release";
const name = demo ? "Point Tracker Demo" : "Point Tracker";
const local = existsSync("local.config.json") ? JSON.parse(readFileSync("local.config.json", "utf8")) : {};
const buildsDir = join(local.buildsDir ?? "builds", release ? "Release" : "");

const platformBundles = { darwin: release ? "app,dmg" : "app", win32: "nsis", linux: "appimage,deb" }[process.platform];
if (!platformBundles) throw new Error(`Unsupported platform: ${process.platform}`);
const target = release && process.platform === "darwin" ? "aarch64-apple-darwin" : null;

const buildNumber = stamp(demo);
console.log(`Build number: ${buildNumber}`);
execSync(
  `npx tauri build --bundles ${platformBundles}${target ? ` --target ${target}` : ""} --config src-tauri/tauri.build.conf.json`,
  { stdio: "inherit", env: { ...process.env, PT_BUILD_NUMBER: buildNumber } },
);

const out = join("src-tauri", "target", ...(target ? [target] : []), "release", "bundle");
mkdirSync(buildsDir, { recursive: true });
const copy = (src, file) => {
  const dest = join(buildsDir, file);
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  console.log(`Copied to ${dest}`);
};

if (process.platform === "darwin") {
  copy(join(out, "macos", `${name}.app`), `${name}.app`);
  if (release) for (const f of readdirSync(join(out, "dmg"))) if (f.endsWith(".dmg")) copy(join(out, "dmg", f), f);
} else {
  for (const dir of ["nsis", "appimage", "deb"]) {
    const d = join(out, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.startsWith(name.replaceAll(" ", "")) || f.startsWith(name)) copy(join(d, f), f);
  }
}
