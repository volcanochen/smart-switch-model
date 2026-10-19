// Minimal CDP (Chrome DevTools Protocol) client over the global WebSocket (Node 22+).
// Usage: const { connect, evaluate } = require('./cdp');

const WS = globalThis.WebSocket;

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WS(wsUrl);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('WS error: ' + (e.message || e.type)));
  });
}

let nextId = 0;
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMsg);
      reject(new Error(`CDP timeout for ${method} (id=${id})`));
    }, 15000);
    function onMsg(ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id === id) {
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        if (msg.error) reject(new Error(`${method} error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    }
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// Evaluate JS in the page's main execution context.
// opts: { returnByValue=true, awaitPromise=true }
async function evaluate(ws, expression, opts = {}) {
  const result = await send(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: opts.returnByValue !== false,
    awaitPromise: opts.awaitPromise !== false,
    ...opts.cdpParams,
  });
  if (result && result.exceptionDetails) {
    const ex = result.exceptionDetails;
    throw new Error('Page exception: ' + (ex.text || '') + ' ' + JSON.stringify(ex.exception && ex.exception.description || ex.exception));
  }
  return result && result.result;
}

// Enable Runtime domain + return the current execution context id (for clarity).
async function enableRuntime(ws) {
  await send(ws, 'Runtime.enable');
}

module.exports = { connect, send, evaluate, enableRuntime };
