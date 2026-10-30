/*
 * Sign the installed app in, from inside its own WebView, so the session
 * cookie lands in the WebView's jar where the app expects it.
 *
 * Usage: node scripts/device-login.js <wsDebuggerUrl> <serverUrl> <password>
 */
const wsDebuggerUrl = process.argv[2];
const serverUrl = process.argv[3];
const password = process.argv[4];

if (!wsDebuggerUrl || !serverUrl || !password) {
  console.error("usage: node scripts/device-login.js <wsDebuggerUrl> <serverUrl> <password>");
  process.exit(1);
}

const WebSocket = require("ws");

const expression = `(async () => {
  const res = await fetch(${JSON.stringify(serverUrl)} + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ password: ${JSON.stringify(password)} }),
  });
  const body = await res.text();
  const probe = await fetch(${JSON.stringify(serverUrl)} + "/api/audiobooks", { credentials: "include" });
  const list = await probe.json().catch(() => null);
  location.reload();
  return JSON.stringify({
    loginStatus: res.status,
    audiobooksStatus: probe.status,
    bookCount: Array.isArray(list) ? list.length : null,
    firstCover: Array.isArray(list) && list[0] ? ${JSON.stringify(serverUrl)} + "/api/audiobooks/" + list[0].id + "/cover" : null,
    body: body.slice(0, 120),
  });
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
}, 45000);