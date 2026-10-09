#!/usr/bin/env node
// Headless access to the running app's JS runtime through Metro's inspector (Chrome DevTools Protocol).
//
//   node scripts/js-eval.mjs <port> '<js expression>'      evaluate (promises awaited), print the JSON result
//   node scripts/js-eval.mjs <port> --console <seconds>    stream console.* output from the app
//
// The app must be running against Metro on <port>. Dev helpers live on globalThis.__FL (src/dev/devGlobals.ts).
// Opening this connection may disconnect an open React Native DevTools window (one debugger at a time).
// PRIVACY: never evaluate expressions whose result contains image data.
const [port = '8081', expr, secsArg] = process.argv.slice(2);
if (!expr) {
  console.error("usage: js-eval.mjs <port> '<expr>' | js-eval.mjs <port> --console <seconds>");
  process.exit(64);
}

let targets;
try {
  targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
} catch {
  console.error(`no Metro on port ${port}`);
  process.exit(2);
}
const target = targets.find((t) => t.webSocketDebuggerUrl);
if (!target) {
  console.error(`no debuggable app connected to Metro on port ${port} (is the app running?)`);
  process.exit(2);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.onmessage = (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled' && expr === '--console') {
    const args = msg.params.args.map((a) => (a.value !== undefined ? a.value : a.description ?? a.type));
    console.log(`[${msg.params.type}]`, ...args);
  }
};
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('inspector websocket failed'));
});

const done = (code) => {
  ws.close();
  process.exit(code);
};

if (expr === '--console') {
  await send('Runtime.enable');
  setTimeout(() => done(0), Number(secsArg || 10) * 1000);
} else {
  // Run the expression inside a promise chain, park the outcome on a global, then poll for it.
  // (Hermes' eval compiler rejects `async` functions, and awaitPromise support varies.)
  const key = `__FL_EVAL_${Date.now()}`;
  const wrapped =
    `Promise.resolve().then(function () { return (${expr}); }).then(` +
    `v => { globalThis.${key} = { ok: true, v: JSON.stringify(v === undefined ? null : v) }; },` +
    `e => { globalThis.${key} = { ok: false, v: String((e && e.stack) || e) }; }); 'started'`;
  const start = await send('Runtime.evaluate', { expression: wrapped, returnByValue: true });
  if (start.error || start.result?.exceptionDetails) {
    console.error('evaluate failed:', JSON.stringify(start.error || start.result.exceptionDetails));
    done(1);
  }
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { const o = globalThis.${key}; if (o) { delete globalThis.${key}; return JSON.stringify(o); } return null; })()`,
      returnByValue: true,
    });
    const val = r.result?.result?.value;
    if (val) {
      const o = JSON.parse(val);
      if (o.ok) {
        console.log(o.v);
        done(0);
      } else {
        console.error('rejected:', o.v);
        done(1);
      }
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  console.error('timed out after 60 s');
  done(3);
}
