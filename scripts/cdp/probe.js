// Probe the WorkBuddy renderer for: exposed window APIs and the model-selector DOM.
const { connect, evaluate, enableRuntime } = require('./cdp');

// Page target captured from /json (title "WorkBuddy")
const PAGE_WS = 'ws://localhost:9222/devtools/page/3332565E9349B953653BFC00FEA1D180';

(async () => {
  const ws = await connect(PAGE_WS);
  await enableRuntime(ws);

  const expr = `(function() {
    const out = {};
    // 1) window globals that look relevant
    const winKeys = Object.keys(window).filter(k =>
      /api|model|config|store|session|electron|workbuddy|tencent/i.test(k));
    out.winKeys = winKeys;

    // 2) drill a little: is window.api present? what shape?
    if (window.api) {
      try { out.apiKeys = Object.keys(window.api); } catch(e) { out.apiKeys = 'err:'+e.message; }
      try { out.apiConfigKeys = window.api.config ? Object.keys(window.api.config) : null; } catch(e) { out.apiConfigKeys = 'err'; }
    }

    // 3) DOM: any element whose (short) text mentions model names / 模型 / Auto
    const all = Array.from(document.querySelectorAll('*'));
    const hits = [];
    for (const el of all) {
      const t = (el.textContent || '').trim();
      if (t && t.length <= 24 && /step-5|hy3|auto|模型|model|glm|qwen|deepseek/i.test(t)) {
        hits.push({
          tag: el.tagName,
          id: el.id || '',
          cls: (typeof el.className === 'string') ? el.className.slice(0,60) : '',
          text: t.slice(0,24)
        });
      }
    }
    out.modelHits = hits.slice(0, 60);

    // 4) buttons/selects in the composer area (bottom of screen) - candidates
    const roles = Array.from(document.querySelectorAll('button, [role=button], select, [contenteditable]'));
    out.composerCandidates = roles.slice(0, 80).map(el => ({
      tag: el.tagName,
      role: el.getAttribute && el.getAttribute('role'),
      aria: el.getAttribute && el.getAttribute('aria-label'),
      text: (el.textContent||'').trim().slice(0,20)
    }));

    // 5) data-testid / data-* attributes that might identify model selector
    const testid = Array.from(document.querySelectorAll('[data-testid],[data-name],[data-id]'))
      .map(el => ({ testid: el.getAttribute('data-testid'), name: el.getAttribute('data-name'), id: el.getAttribute('data-id'), text:(el.textContent||'').trim().slice(0,16) }))
      .slice(0, 60);
    out.testidNodes = testid;

    return JSON.stringify(out);
  })()`;

  const r = await evaluate(ws, expr);
  console.log(r && r.value ? r.value : JSON.stringify(r));
  ws.close();
})().catch(e => { console.error('PROBE FAILED:', e.message); process.exit(1); });
