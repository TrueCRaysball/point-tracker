// Copies the icon library, fonts and sample data into src/ (the folder Tauri serves).
import { copyFileSync, cpSync, mkdirSync } from "node:fs";
mkdirSync("src/vendor/viewer", { recursive: true });
copyFileSync("node_modules/lucide/dist/umd/lucide.min.js", "src/vendor/lucide.min.js");
const fonts = { "plus-jakarta-sans": "jakarta", outfit: "outfit", cabin: "cabin" };
for (const [pkg, name] of Object.entries(fonts)) {
  copyFileSync(`node_modules/@fontsource-variable/${pkg}/files/${pkg}-latin-wght-normal.woff2`, `src/vendor/${name}.woff2`);
}
// File viewer: PDF.js (legacy build, for older WebKit), Mammoth (Word) and SheetJS (spreadsheets).
copyFileSync("node_modules/pdfjs-dist/legacy/build/pdf.min.mjs", "src/vendor/viewer/pdf.min.mjs");
copyFileSync("node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", "src/vendor/viewer/pdf.worker.min.mjs");
cpSync("node_modules/pdfjs-dist/standard_fonts", "src/vendor/viewer/standard_fonts", { recursive: true });
copyFileSync("node_modules/mammoth/mammoth.browser.min.js", "src/vendor/viewer/mammoth.browser.min.js");
copyFileSync("node_modules/xlsx/dist/xlsx.full.min.js", "src/vendor/viewer/xlsx.full.min.js");
// Image formats some systems can't draw: TIFF (UTIF + pako) and HEIC (heic2any).
copyFileSync("node_modules/utif/UTIF.js", "src/vendor/viewer/UTIF.js");
copyFileSync("node_modules/pako/dist/pako_inflate.min.js", "src/vendor/viewer/pako_inflate.min.js");
copyFileSync("node_modules/heic2any/dist/heic2any.min.js", "src/vendor/viewer/heic2any.min.js");
copyFileSync("sample/demo-data.json", "src/sample-data.json");
console.log("Vendored lucide, fonts, file viewer and sample data.");
