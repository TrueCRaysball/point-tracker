// Stamps a build number (local time as YYMMDDHHmm) into src-tauri/tauri.build.conf.json.
// Every build gets a new number; the version in tauri.conf.json only changes deliberately.
//   node scripts/stamp.mjs          → regular app
//   node scripts/stamp.mjs demo     → demo app (sample data, DEMO icon)
// Prints the build number. In GitHub Actions it is also exported as PT_BUILD_NUMBER.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

/** Local time as YYMMDDHHmm. */
export function buildNumberNow() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}`;
}

export function stamp(demo = false) {
  const buildNumber = buildNumberNow();
  const override = demo ? JSON.parse(readFileSync("src-tauri/tauri.demo.conf.json", "utf8")) : {};
  override.bundle = { ...(override.bundle ?? {}), macOS: { bundleVersion: buildNumber } };
  writeFileSync("src-tauri/tauri.build.conf.json", JSON.stringify(override, null, 2));
  return buildNumber;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("stamp.mjs")) {
  const buildNumber = stamp(process.argv[2] === "demo");
  console.log(buildNumber);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PT_BUILD_NUMBER=${buildNumber}\n`);
}
