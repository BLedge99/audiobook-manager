/*
 * Set the value of a React-controlled input on the running WebView.
 *
 * Assigning `input.value` directly does not notify React: its synthetic event
 * system compares against its own last-known value and ignores the change, so
 * the component keeps the old state and submits an empty string. This uses
 * React's own value setter plus a real `input` event, which is what a person
 * typing produces.
 *
 * Usage: node scripts/set-device-input.js <wsDebuggerUrl> <selector> <value>
 */
const wsDebuggerUrl = process.argv[2];
const selector = process.argv[3];
const value = process.argv[4];

if (!wsDebuggerUrl || !selector || value === undefined) {
  console.error("usage: node scripts/set-device-input.js <wsDebuggerUrl> <selector> <value>");
  process.exit(1);
}

const WebSocket = require("ws");

const expression = `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return "no element for " + ${JSON.stringify(selector)};
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event("input", { bubbles: true }));
  return "now: " + el.value.length + " chars";
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