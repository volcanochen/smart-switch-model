// Reload the WorkBuddy renderer to clear zombie page state (e.g. an old MutationObserver
// that can't be reached from outside its closure - delete window.__wbAutoSwitch does NOT
// stop an already-armed observer).
// Idle-aware: if a turn is processing it retries every 15s, so it never kills an active
// conversation turn. Also repairs any DOM damage (removed nodes re-render from state).
const { connect, send, evaluate } = require('./cdp');

const DELAY_MS = parseInt(process.env.WB_RELOAD_DELAY_MS || '90000', 10);

(async () => {
  const list = await (await fetch('http://localhost:9222/json')).json();
  const t = list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target (is the debug port up?)');
  const ws = await connect(t.webSocketDebuggerUrl);
  await send(ws, 'Runtime.enable');

  const r = await evaluate(ws, `(function(){
    if (window.__wbSafeReload) return 'already-scheduled';
    function busy(){
      return !!document.querySelector('.cr-agent--processing')
          || !!document.querySelector('button[class*="stop"], .cr-composer__stop');
    }
    var idleStreak = 0;
    function go(){
      if (busy()) { idleStreak = 0; setTimeout(go, 15000); return; }
      idleStreak++;
      if (idleStreak < 2) { setTimeout(go, 15000); return; } // require 2 consecutive idle checks
      location.reload();
    }
    window.__wbSafeReload = true;
    setTimeout(go, ${DELAY_MS});
    return 'scheduled in ${DELAY_MS}ms (idle-aware, 2 consecutive idle checks)';
  })()`);
  console.log('reload:', r.value);

  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
