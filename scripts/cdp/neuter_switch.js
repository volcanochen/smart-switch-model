// TEMPORARY: block programmatic .click() on the model selector so a buggy/zombie
// reactor can't switch models. Real mouse clicks are NOT affected - a native click
// dispatches an event directly and never calls the JS click() method, so only
// script-driven clicks (what the reactor does) are blocked.
// Sweeps on every mutation so re-created DOM nodes get neutered too.
// Fully cleared by a page reload (see reload_page.js).
const { connect, send, evaluate } = require('./cdp');

(async () => {
  const list = await (await fetch('http://localhost:9222/json')).json();
  const t = list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target (is the debug port up?)');
  const ws = await connect(t.webSocketDebuggerUrl);
  await send(ws, 'Runtime.enable');

  const r = await evaluate(ws, `(function(){
    if (window.__wbSwitchNeuter) return 'already-neutered';
    function neuter(el){ if (el && !el.__wbNeutered){ el.__wbNeutered = true; try { el.click = function(){}; } catch(e){} } }
    function sweep(){
      neuter(document.querySelector('.cr-model-selector__trigger'));
      var items = document.querySelectorAll('.cr-model-selector__item');
      for (var i=0;i<items.length;i++) neuter(items[i]);
    }
    sweep();
    var mo = new MutationObserver(sweep);
    mo.observe(document.body, { childList:true, subtree:true });
    window.__wbSwitchNeuter = { sweep: sweep };
    return 'neuter-armed';
  })()`);
  console.log('neuter:', r.value);

  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
