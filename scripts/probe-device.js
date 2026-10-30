/*
 * Ask the running WebView what it actually thinks.
 *
 * Reads localStorage and probes candidate server URLs from *inside the app*, so
 * the answer reflects the phone's own network view rather than the PC's. Used to
 * diagnose "covers are placeholders on the device" without guessing.
 *
 * Usage: node scripts/probe-device.js <wsDebuggerUrl> [extraUrl ...]
 */
const wsDebuggerUrl = process.argv[2];
const extraUrls = process.argv.slice(3);
if (!wsDebuggerUrl) {
  console.error("usage: node scripts/probe-device.js <webSocketDebuggerUrl> [url ...]");
  process.exit(1);
}

const WebSocket = require("ws");

const expression = `(async () => {
  const out = { storage: {}, probe: {} };
  for (const key of ["serverUrl", "profileId", "bookle-theme"]) {
    out.storage[key] = localStorage.getItem(key);
  }
  out.storage.origin = location.origin;

  // A fetch to an unreachable address hangs for the WebView's whole connect
  // timeout, which stalls this probe. Bound every call.
  const tryUrl = async (url) => {
    const started = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const ct = res.headers.get("content-type") || "";
      let sample = null;
      if (res.ok && ct.includes("json")) sample = (await res.json()).status ?? null;
      return { status: res.status, contentType: ct.slice(0, 40), ms: Date.now() - started };
    } catch (error) {
      return { error: String(error).slice(0, 120), ms: Date.now() - started };
    }
  };

  const candidates = ${JSON.stringify(extraUrls)};
  for (const url of candidates) {
    out.probe[url] = {
      health: await tryUrl(url + "/api/health"),
      audiobooks: await tryUrl(url + "/api/audiobooks"),
    };
  }

  // And what the app is actually configured to call.
  const base = localStorage.getItem("serverUrl");
  if (base) out.probe.configuredBase = base;
  return JSON.stringify(out);
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
    const result = message.result?.result;
    if (result?.value) console.log(result.value);
    else console.error(JSON.stringify(message.result, null, 2));
    socket.close();
    process.exit(0);
  }
});
socket.on("error", (error) => {
  console.error("socket error:", error.message);
  process.exit(1);
});
setTimeout(() => {
  console.error("timed out waiting for the WebView to answer");
  process.exit(1);
}, 60000);