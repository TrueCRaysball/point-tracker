// Copies the icon library, fonts and sample data into src/ (the folder Tauri serves).
import { copyFileSync, mkdirSync } from "node:fs";
mkdirSync("src/vendor", { recursive: true });
copyFileSync("node_modules/lucide/dist/umd/lucide.min.js", "src/vendor/lucide.min.js");
const fonts = { "plus-jakarta-sans": "jakarta", outfit: "outfit", cabin: "cabin" };
for (const [pkg, name] of Object.entries(fonts)) {
  copyFileSync(`node_modules/@fontsource-variable/${pkg}/files/${pkg}-latin-wght-normal.woff2`, `src/vendor/${name}.woff2`);
}
copyFileSync("sample/demo-data.json", "src/sample-data.json");
console.log("Vendored lucide, fonts and sample data.");
