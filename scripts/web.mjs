// Prepares src/ as the Home Screen (web) app: vendors assets, stamps the version and build number,
// and generates the offline service worker. GitHub Pages publishes the src/ folder afterwards.
//   node scripts/web.mjs
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { buildNumberNow } from "./stamp.mjs";

execSync("node scripts/vendor.mjs", { stdio: "inherit" });

const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const build = buildNumberNow();
writeFileSync("src/version.json", JSON.stringify({ version, build }, null, 2));
// The same, as a module the app imports: the version of the code that's actually running
// (version.json is fetched fresh from the network, so it can be newer while an update downloads).
writeFileSync("src/app-version.js", `export default ${JSON.stringify({ version, build })};\n`);

const files = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (!f.startsWith(".") && f !== "sw.js") files.push(relative("src", p).split("\\").join("/"));
  }
};
walk("src");
const assets = ["./", ...files.sort()];
writeFileSync("src/sw.js", readFileSync("tools/web/sw.template.js", "utf8")
  .replace("__BUILD__", build)
  .replace("__ASSETS__", JSON.stringify(assets, null, 2)));
console.log(`Web app ready: v${version} (build ${build}), ${assets.length} files cached for offline use.`);
