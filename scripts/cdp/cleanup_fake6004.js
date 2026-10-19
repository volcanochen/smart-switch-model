// Remove the FAKE 6004 banner left behind by `autoswitch.js test`.
// MARKED-ONLY: removes elements carrying [data-test="fake-6004"] and nothing else.
//
// Lesson (2026-10-19): v1 of this script also removed any "hidden/off-screen node whose
// text contains 6004 + rate-limit words". That heuristic matched 19 nodes of our OWN
// conversation (collapsed deep-thinking section, code blocks) - because this conversation
// discusses the 6004 error itself. Never heuristic-scan chat text; only trust the marker.

const { connect, send, evaluate } = require('./cdp');

(async () => {
  const list = await (await fetch('http://localhost:9222/json')).json();
  const t = list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target (is the debug port up?)');
  const ws = await connect(t.webSocketDebuggerUrl);
  await send(ws, 'Runtime.enable');

  const r = await evaluate(ws, `(function(){
    var out = { found: 0, removed: 0, reactor: null, deepThinking: null };
    var marked = document.querySelectorAll('[data-test="fake-6004"]');
    out.found = marked.length;
    for (var i=0;i<marked.length;i++){
      out.removed++;
      marked[i].remove();
    }
    out.reactor = window.__wbAutoSwitch ? window.__wbAutoSwitch.status() : null;
    var rt = document.querySelector('.cr-reasoning');
    out.deepThinking = rt ? { present: true, textLen: (rt.textContent||'').length } : { present: false };
    return JSON.stringify(out);
  })()`);
  console.log('CLEANUP:', r.value);

  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
