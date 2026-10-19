// Extract the live model list (name / rate / badge / selected) from the real selector.
const { connect, evaluate, enableRuntime } = require('./cdp');

// Dynamically discover the WorkBuddy page target (page ids are per-session, never hardcode).
async function pageWs() {
  let list;
  try {
    list = await (await fetch('http://localhost:9222/json')).json();
  } catch (e) {
    throw new Error('debug port 9222 unreachable - restart WorkBuddy with --remote-debugging-port=9222');
  }
  const t = list.find(x => x.type === 'page' && /workbuddy/i.test((x.url || '') + ' ' + (x.title || '')))
         || list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target (is the debug port up?)');
  return t.webSocketDebuggerUrl;
}

(async () => {
  const ws = await connect(await pageWs());
  await enableRuntime(ws);

  const expr = `(async () => {
    const trigger = document.querySelector('.cr-model-selector__trigger');
    if (trigger && !trigger.classList.contains('cr-model-selector__trigger--open')) trigger.click();
    await new Promise(r => setTimeout(r, 600));
    const items = Array.from(document.querySelectorAll('.cr-model-selector__item'));
    const models = items.map(it => {
      const nameEl = it.querySelector('.cr-model-selector__item-name');
      const name = nameEl ? nameEl.textContent.replace(/\\s+/g,' ').trim() : (it.textContent||'').trim();
      const full = (it.textContent||'').replace(/\\s+/g,' ').trim();
      const selected = it.classList.contains('cr-model-selector__item--selected');
      // rate/badge come from text AFTER the clean model name (name may end in a
      // version digit that would otherwise merge with the rate, e.g. GLM-5.3 + 0.79x)
      const rest = full.startsWith(name) ? full.slice(name.length) : '';
      const m = rest.match(/(\\d+\\.\\d+)x/);
      const rate = m ? m[1]+'x' : null;
      const badge = (m ? rest.slice(0, m.index) : rest).trim();
      return { name, rate, badge, selected };
    });
    if (trigger) trigger.click(); // close
    return JSON.stringify(models);
  })()`;

  const r = await evaluate(ws, expr);
  const models = JSON.parse(r.value);
  console.log(JSON.stringify(models, null, 0));
  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
