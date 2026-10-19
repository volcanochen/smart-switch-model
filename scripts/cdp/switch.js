// Switch the CURRENT WorkBuddy window's model via the real UI path (CDP DOM click).
// This drives the actual model-selector the user clicks, so it changes the in-memory
// + persisted selection — not the reverted db-mirror that the old switch_model.py wrote.
//
// Usage:
//   node switch.js step-5-preview   (or: step5, hy3, hy4, fast, balanced, ultra, <display name>)
//   node switch.js --list           (dump available options)

const { connect, evaluate, enableRuntime } = require('./cdp');
const PAGE_WS = 'ws://localhost:9222/devtools/page/3332565E9349B953653BFC00FEA1D180';

// friendly id / alias  ->  dropdown DISPLAY name (cr-model-selector__item-name text)
const NAME_MAP = {
  'step-5-preview': 'Step-5-Preview',
  'step5': 'Step-5-Preview',
  'step-5': 'Step-5-Preview',
  'hy3': 'Hy3',
  'hy4': 'Hy4 preview',
  'fast': '快速',
  'balanced': '均衡',
  'ultra': '极致',
};

const arg = process.argv[2] || 'step-5-preview';

(async () => {
  if (arg === '--list' || arg === '-l') {
    const ws = await connect(PAGE_WS);
    await enableRuntime(ws);
    const r = await evaluate(ws, `(async () => {
      const t = document.querySelector('.cr-model-selector__trigger');
      if (t && !t.classList.contains('cr-model-selector__trigger--open')) t.click();
      await new Promise(r => setTimeout(r, 500));
      const items = Array.from(document.querySelectorAll('.cr-model-selector__item'));
      const list = items.map(i => (i.querySelector('.cr-model-selector__item-name')||i).textContent.replace(/\\s+/g,' ').trim());
      if (t) t.click();
      return JSON.stringify(list);
    })()`);
    console.log('Available models:');
    console.log(JSON.parse(r.value).join('\n'));
    ws.close();
    return;
  }

  const target = NAME_MAP[arg.toLowerCase()] || arg; // allow passing display name directly
  const tJson = JSON.stringify(target);
  const tJsonLower = JSON.stringify(target.toLowerCase());

  const ws = await connect(PAGE_WS);
  await enableRuntime(ws);

  const expr = `(async () => {
    const trigger = document.querySelector('.cr-model-selector__trigger');
    if (!trigger) return JSON.stringify({error:'trigger .cr-model-selector__trigger not found'});
    const labelEl = () => document.querySelector('.cr-model-selector__trigger-label') || trigger;
    const before = (labelEl().textContent || '').trim();
    const isOpen = trigger.classList.contains('cr-model-selector__trigger--open');
    if (!isOpen) trigger.click();
    await new Promise(r => setTimeout(r, 500));

    const items = Array.from(document.querySelectorAll('.cr-model-selector__item'));
    let picked = null;
    for (const it of items) {
      const nameEl = it.querySelector('.cr-model-selector__item-name') || it;
      const name = (nameEl.textContent || '').replace(/\\s+/g,' ').trim();
      if (name.toLowerCase() === ${tJsonLower}) { picked = it; break; }
    }
    if (!picked) {
      trigger.click(); // close
      return JSON.stringify({error:'option not found', target: ${tJson}, available: items.map(i => (i.querySelector('.cr-model-selector__item-name')||i).textContent.trim())});
    }
    picked.click();
    await new Promise(r => setTimeout(r, 800));
    const after = (labelEl().textContent || '').trim();
    return JSON.stringify({before, target: ${tJson}, after, switched: after !== before});
  })()`;

  const r = await evaluate(ws, expr);
  const res = r && r.value ? JSON.parse(r.value) : r;
  if (res.error) {
    console.error('SWITCH ERROR:', res.error);
    if (res.available) console.error('Available:', res.available.join(' | '));
    process.exit(1);
  }
  console.log(JSON.stringify(res, null, 2));
  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
