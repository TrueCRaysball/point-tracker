// Inlined into vendor/viewer/heic-frame.html by scripts/vendor.mjs. Runs sandboxed, with no same-origin access. Message in: { id, blob }.
// Message out: { id, blob } with a JPEG, or { id, error }.
addEventListener("message", async (e) => {
  if (e.source !== parent) return;
  const { id, blob } = e.data ?? {};
  if (!(blob instanceof Blob)) return;
  try {
    const out = await heic2any({ blob, toType: "image/jpeg", quality: 0.92 });
    parent.postMessage({ id, blob: Array.isArray(out) ? out[0] : out }, "*");
  } catch (err) {
    parent.postMessage({ id, error: String(err?.message ?? err) }, "*");
  }
});
parent.postMessage({ ready: true }, "*");
