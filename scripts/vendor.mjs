// Copies the icon library, fonts and sample data into src/ (the folder Tauri serves).
import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("src/vendor/viewer", { recursive: true });
mkdirSync("src/vendor/sync", { recursive: true });
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
// HEIC runs in a sandboxed frame with everything inline (see tools/viewer/heic-frame.template.html).
const inline = (js) => js.replaceAll("</script", "<\\/script");
writeFileSync("src/vendor/viewer/heic-frame.html", readFileSync("tools/viewer/heic-frame.template.html", "utf8")
  .replace("/*HEIC2ANY*/", () => inline(readFileSync("node_modules/heic2any/dist/heic2any.min.js", "utf8")))
  .replace("/*FRAME*/", () => inline(readFileSync("tools/viewer/heic-frame.js", "utf8"))));
// Nearby Sync: PeerJS (direct device-to-device connection), QR code maker and QR code reader.
copyFileSync("node_modules/peerjs/dist/peerjs.min.js", "src/vendor/sync/peerjs.min.js");
copyFileSync("node_modules/qrcode-generator/dist/qrcode.js", "src/vendor/sync/qrcode.js");
copyFileSync("node_modules/jsqr/dist/jsQR.js", "src/vendor/sync/jsQR.js");
copyFileSync("sample/demo-data.json", "src/sample-data.json");
console.log("Vendored lucide, fonts, file viewer, sync and sample data.");
