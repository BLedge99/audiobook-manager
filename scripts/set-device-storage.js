/*
 * Write a value into the running WebView's localStorage and reload.
 *
 * Used to point the installed app at a different server without reinstalling,
 * which is how the device's server URL gets corrected during a test session.
 *
 * Usage: node scripts/set-device-storage.js <wsDebuggerUrl> <key> <value> [reload]
 */
const wsDebuggerUrl = process.argv[2];
const key = process.argv[3];
const value = process.argv[4];
const reload = process.argv[5] !== "n";

if (!wsDebuggerUrl || !key) {
  console.error("usage: node scripts/set-device-storage.js <wsDebuggerUrl> <key> <value> [n]");
  process.exit(1);
}

const WebSocket = require("ws");

const expression = `(async () => {
  localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});
  ${reload ? "location.reload();" : ""}
  return "set " + ${JSON.stringify(key)} + " = " + ${JSON.stringify(value)};
})()`;

const socket = new WebSocket(wsDebuggerUrl);
socket.on("open", () => {
  socket.send(
    JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }),
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