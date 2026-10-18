/*
 * Count real covers versus placeholder fallbacks in the running app.
 *
 * The placeholder is `placeholder-cover.svg`, an 800x500 landscape SVG, so it
 * is identifiable both by URL and by its unnatural dimensions. Counting them
 * distinguishes "the covers are broken" from "this book genuinely has no
 * artwork" -- which look identical in a screenshot and were the entire cause of
 * a false alarm during device testing.
 *
 * Usage: node scripts/check-device-covers.js <wsDebuggerUrl>
 */
const wsDebuggerUrl = process.argv[2];
if (!wsDebuggerUrl) {
  console.error("usage: node scripts/check-device-covers.js <webSocketDebuggerUrl>");
  process.exit(1);
}

const WebSocket = require("ws");

const expression = `(() => {
  const imgs = Array.from(document.querySelectorAll("img"));
  const isPlaceholder = (i) => (i.currentSrc || i.src || "").includes("placeholder");
  const real = imgs.filter((i) => !isPlaceholder(i));
  const placeholders = imgs.filter(isPlaceholder);
  return JSON.stringify({
    total: imgs.length,
    realCovers: real.length,
    placeholders: placeholders.length,
    zeroSizedRealCovers: real.filter((i) => i.naturalWidth === 0).length,
    sizes: real.map((i) => i.naturalWidth + "x" + i.naturalHeight),
  });
})()`;

const socket = new WebSocket(wsDebuggerUrl);
socket.on("open", () => {
  socket.send(
    JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true } }),
  );
});
socket.on("message", (raw) => {
  const message = JSON.parse(raw.toString());
  if (message.id === 1) {
    console.log(message.result?.result?.value ?? JSON.stringify(message.result));
    socket.close();
    process.exit(0);
  }
});
socket.on("error", (error) => {
  console.error("socket error:", error.message);
  process.exit(1);
});
setTimeout(() => {
  console.error("timed out");
  process.exit(1);
}, 30000);