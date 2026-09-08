// Run against an isolated, disconnected pnpm dev instance with --remote-debugging-port=9234.
// Regression check: fast toggles must not queue obsolete native resize animations.
import assert from "node:assert/strict";
const targets = await (await fetch("http://127.0.0.1:9234/json")).json();
const target = targets.find(
  (t) => t.type === "page" && t.url === "http://127.0.0.1:5178/",
);
assert(
  target,
  "Start the isolated Notched dev app with --remote-debugging-port=9234",
);
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) =>
  socket.addEventListener("open", resolve, { once: true }),
);
let id = 0;
const pending = new Map();
socket.addEventListener("message", (e) => {
  const reply = JSON.parse(e.data);
  const handlers = pending.get(reply.id);
  if (handlers) {
    pending.delete(reply.id);
    reply.error ? handlers.reject(reply.error) : handlers.resolve(reply.result);
  }
});
function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const seq = ++id;
    pending.set(seq, { resolve, reject });
    socket.send(JSON.stringify({ id: seq, method, params }));
  });
}

try {
  const state = await cdp("Runtime.evaluate", {
    expression: "window.notched.getState().then(s => s.phase)",
    awaitPromise: true,
    returnByValue: true,
  });
  assert.equal(
    state.result.value,
    "disconnected",
    "Use an isolated, disconnected dev instance.",
  );
  await cdp("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  });
  const result = await cdp("Runtime.evaluate", {
    expression: `(async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));const results=[];for(const edge of ['top','right','bottom','left']){await window.notched.movePanel(edge,false);await wait(450);for(let i=0;i<10;i++){document.querySelector('header button').click();await wait(55);}if(document.querySelector('.panel').classList.contains('compact'))document.querySelector('header button').click();await wait(550);results.push({edge,width:innerWidth,height:innerHeight,x:screenX,y:screenY,screenWidth:screen.width,screenHeight:screen.height,expanded:document.querySelector('.panel').classList.contains('expanded')});}return results;})()`,
    awaitPromise: true,
    returnByValue: true,
  });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));

  for (const r of result.result.value) {
    assert(r.expanded);
    assert.equal(r.width, 420);
    assert.equal(r.height, 300);
    assert(
      r.x >= 0 &&
        r.y >= 0 &&
        r.x + r.width <= r.screenWidth &&
        r.y + r.height <= r.screenHeight,
    );
  }
  console.log("Fast toggles passed at all four edges.");
} finally {
  socket.close();
}
