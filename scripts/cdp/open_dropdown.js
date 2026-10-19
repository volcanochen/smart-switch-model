// Open the model-selector dropdown and dump the available options + their exact labels.
const { connect, evaluate, enableRuntime } = require('./cdp');
const PAGE_WS = 'ws://localhost:9222/devtools/page/3332565E9349B953653BFC00FEA1D180';

(async () => {
  const ws = await connect(PAGE_WS);
  await enableRuntime(ws);

  const expr = `(async () => {
    const trigger = document.querySelector('.cr-model-selector__trigger');
    if (!trigger) return JSON.stringify({error:'trigger .cr-model-selector__trigger not found'});
    const before = trigger.textContent.trim();
    trigger.click();
    await new Promise(r => setTimeout(r, 600));

    // dropdown may render in a portal at body level; search broadly
    const byRole = Array.from(document.querySelectorAll('[role=option],[role=menuitem],[role=listitem]'))
      .map(el => ({ role: el.getAttribute('role'), cls:(typeof el.className==='string')?el.className.slice(0,80):'', text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40) }));

    const byText = Array.from(document.querySelectorAll('*')).filter(el => {
      const t = (el.textContent||'').replace(/\\s+/g,' ').trim();
      return t && t.length <= 40 && /auto|hy3|step|preview|glm|qwen|deepseek|flash|reason|fast|模型|智能|推理|快速|高级/i.test(t);
    }).map(el => ({ tag: el.tagName, cls:(typeof el.className==='string')?el.className.slice(0,80):'', text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40) }));

    return JSON.stringify({ triggerBefore: before, byRole, byText: byText.slice(0,80) });
  })()`;

  const r = await evaluate(ws, expr);
  console.log(r && r.value ? r.value : JSON.stringify(r));
  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
