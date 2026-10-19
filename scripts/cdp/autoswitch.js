// Auto-switch model the instant a REAL rate-limit (6004) banner appears.
//
// Why not a WorkBuddy "定时任务/automation"?  Those run discrete scheduled agent turns;
// they can't react mid-conversation and can't pre-detect a rate limit.  The real-time
// reaction must live IN the page (a MutationObserver).  A scheduled task's only real job
// here is to KEEP this watcher process alive across reboots/logins.
//
// Modes:
//   node autoswitch.js arm     inject the reactor into the current page (idempotent)
//   node autoswitch.js watch   inject + keep it armed (self re-arm + reconnect every 5s); long-running
//   node autoswitch.js test    inject (dry-run) + fire a FAKE 6004 banner, report detection
//
// Config (env):
//   WB_FALLBACKS="Hy3,GLM-5.3-Flash,Step-5-Preview"   ordered fallback list (skips current)
//   WB_COOLDOWN_MS=15000                              min gap between auto-switches
//
// Prereq: WorkBuddy started with --remote-debugging-port=9222 (same as switch-model skill).
//
// ---------------------------------------------------------------------------
// DETECTOR v2 (2026-10-19) - incident post-mortem:
// v1 fired on ANY added node whose text contained "6004" + (频率|超出|重置|...).
// But this very conversation discusses the 6004 error constantly - replies, tables,
// deep-thinking code blocks, sidebar previews - so every re-render/stream false-fired
// and silently switched models 9 times in one day. v2 fires ONLY when ALL hold:
//   1. short one-liner (<300 chars) - banners are one line, essays are not
//   2. contains 6004 OR a strong app-i18n phrase (超出频率限制 / exceeded the rate limit /
//      重置可用 / can reset at / 切换其他模型 / switch models)
//   3. NOT inside chat/markdown/reasoning/artifact/sidebar subtrees (where our own
//      conversation text lives)
//   4. inside an error/notice/banner-ish widget (positive structural signal)
//   5. the model named in the banner is still the current model (idempotent - a banner
//      re-render after we already switched away must not re-fire)
// Trade-off: if the real banner's DOM ever lacks error/notice/banner-ish classes, v2
// stays silent (no auto-switch; user switches manually) instead of switching by mistake.

const { connect, send, evaluate } = require('./cdp');

const mode = process.argv[2] || 'arm';
const FALLBACKS = (process.env.WB_FALLBACKS || 'Hy3,GLM-5.3-Flash,Step-5-Preview')
  .split(',').map(s => s.trim()).filter(Boolean);
const COOLDOWN = parseInt(process.env.WB_COOLDOWN_MS || '15000', 10);

// ---- the reactor, injected into the page. Self-contained. ----
function reactorSource(cfg) {
  return `
  (function(){
    if (window.__wbAutoSwitch) { window.__wbAutoSwitch.cfg = ${JSON.stringify(cfg)}; return 'already-armed'; }
    var cfg = ${JSON.stringify(cfg)};
    var fires = [];
    function labelEl(){ return document.querySelector('.cr-model-selector__trigger-label') || document.querySelector('.cr-model-selector__trigger'); }
    function currentModel(){ var e = labelEl(); return e ? e.textContent.replace(/\\s+/g,' ').trim() : ''; }
    function triggerEl(){ return document.querySelector('.cr-model-selector__trigger'); }
    function openSelector(){ var t = triggerEl(); if(!t) return false; if(!t.classList.contains('cr-model-selector__trigger--open')) t.click(); return true; }
    function closeSelector(){ var t = triggerEl(); if(t && t.classList.contains('cr-model-selector__trigger--open')) t.click(); }
    function findTarget(){
      var cur = currentModel().toLowerCase();
      var items = Array.prototype.slice.call(document.querySelectorAll('.cr-model-selector__item'));
      for (var i=0;i<cfg.fallbacks.length;i++){
        var fb = cfg.fallbacks[i].toLowerCase();
        if (fb === cur) continue;
        for (var j=0;j<items.length;j++){
          var n = (items[j].querySelector('.cr-model-selector__item-name')||items[j]).textContent.replace(/\\s+/g,' ').trim();
          if (n.toLowerCase() === fb) return { el: items[j], name: n };
        }
      }
      return null;
    }
    // ---- v2 banner detector (see header comment) ----
    var EXCLUDE = '.cr-markdown, .cr-reasoning, .cr-collapse, .monaco-editor, [class*="artifact"], [class*="detail-panel"], [class*="sidebar"], .cr-session, .cr-code-block, .cr-table-block, textarea, [contenteditable="true"], .cr-composer, .cr-input';
    function isRateLimitBanner(n){
      if (!n || n.nodeType !== 1) return false;
      var t = (n.textContent||'').replace(/\\s+/g,' ').trim();
      if (!t || t.length > 300) return false;                                  // 1. one-liner
      var codeHit = /6004/.test(t);
      var phraseHit = /(超出频率限制|exceeded the rate limit|重置可用|can reset at|切换其他模型|switch models)/i.test(t);
      if (!codeHit && !phraseHit) return false;                                // 2. code or strong phrase
      if (codeHit && !/(频率|超出|重置|用量|额度|rate ?limit|quota|switch|reset)/i.test(t)) return false;
      try { if (n.closest && n.closest(EXCLUDE)) return false; } catch(e){}    // 3. not our own chat text
      try {
        if (!(n.closest && n.closest('[class*="error"],[class*="notice"],[class*="banner"],[class*="alert"],[class*="toast"],[class*="notification"],[class*="widget"]'))) return false; // 4. notice widget
      } catch(e){}
      var m = t.match(/当前您在\\s*([A-Za-z0-9._-]+)\\s*模型/) || t.match(/usage of\\s+([A-Za-z0-9._-]+)/i);
      if (m) {                                                                  // 5. still on the limited model?
        var cur = currentModel().toLowerCase();
        if (cur.indexOf(m[1].toLowerCase()) === -1) return false;
      }
      return true;
    }
    var lastFire = 0;
    function doSwitch(reason){
      var now = Date.now();
      if (now - lastFire < cfg.cooldownMs) return Promise.resolve('cooldown');
      lastFire = now;
      var before = currentModel();
      if (!openSelector()){ var e1={reason:reason,before:before,error:'no-trigger',at:new Date().toISOString()}; fires.push(e1); window.__wbAutoSwitch.lastEvent=e1; return Promise.resolve('no-trigger'); }
      return new Promise(function(res){
        setTimeout(function(){
          var t = findTarget();
          if (!t){ closeSelector(); var e2={reason:reason,before:before,error:'no-fallback',at:new Date().toISOString()}; fires.push(e2); window.__wbAutoSwitch.lastEvent=e2; res('no-fallback'); return; }
          if (cfg.dryRun){
            closeSelector();
            var ev = { reason:reason, dryRun:true, before:before, to:t.name, at:new Date().toISOString() };
            fires.push(ev); window.__wbAutoSwitch.lastEvent = ev; res('dryrun:'+t.name); return;
          }
          t.el.click();
          setTimeout(function(){
            var after = currentModel();
            var ev = { reason:reason, before:before, after:after, at:new Date().toISOString() };
            fires.push(ev); window.__wbAutoSwitch.lastEvent = ev;
            try { console.log('[wbAutoSwitch] ' + reason + ': ' + before + ' -> ' + after); } catch(e){}
            res(after);
          }, 700);
        }, 400);
      });
    }
    var obs = new MutationObserver(function(muts){
      for (var i=0;i<muts.length;i++){
        var added = muts[i].addedNodes || [];
        for (var k=0;k<added.length;k++){
          if (isRateLimitBanner(added[k])) { doSwitch('6004'); return; }
        }
      }
    });
    obs.observe(document.body, { childList:true, subtree:true });
    window.__wbAutoSwitch = {
      cfg: cfg, fires: fires, lastEvent: null, doSwitch: doSwitch, isRateLimitBanner: isRateLimitBanner,
      status: function(){ return { armed:true, detector:'v2', current:currentModel(), fallbacks:cfg.fallbacks, dryRun:cfg.dryRun, fires:fires.length, lastEvent:window.__wbAutoSwitch.lastEvent }; }
    };
    return 'armed';
  })()
  `;
}

async function pageWs() {
  const list = await (await fetch('http://localhost:9222/json')).json();
  const t = list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target (is the debug port up?)');
  return t.webSocketDebuggerUrl;
}

// watch mode: connect with retries so a reload/restart doesn't kill the watcher
async function connectPage(retries = 20) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const ws = await connect(await pageWs());
      await send(ws, 'Runtime.enable');
      return ws;
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 3000)); }
  }
  throw lastErr;
}

(async () => {
  const ws = await connectPage();
  const cfg = { fallbacks: FALLBACKS, cooldownMs: COOLDOWN, dryRun: (mode === 'test') };

  if (mode === 'test') {
    await evaluate(ws, `delete window.__wbAutoSwitch`); // force a fresh inject so we exercise current code
    const arm = await evaluate(ws, reactorSource(cfg));
    console.log('arm:', arm.value);
    // 1) realistic fake banner (app i18n wording + error-widget class, body level) -> MUST be detected
    await evaluate(ws, `(function(){ var d=document.createElement('div'); d.className='cr-widget-error-message'; d.setAttribute('data-test','fake-6004'); d.innerHTML='<span class="cr-widget-error-icon">&#8635;</span> 当前免费使用量已超出频率限制，可在 2026-10-19 03:00:00 重置可用。您可切换其他模型或消耗积分继续使用 (6004)'; d.style.cssText='position:fixed;left:-99999px;top:0;'; document.body.appendChild(d); return 'injected'; })()`);
    await new Promise(r => setTimeout(r, 1200));
    const s1 = await evaluate(ws, `window.__wbAutoSwitch ? JSON.stringify(window.__wbAutoSwitch.status()) : 'NOT-ARMED'`);
    console.log('after-real-banner:', s1.value);
    // 2) chat-text false positives: same words but inside .cr-markdown -> MUST be ignored
    await evaluate(ws, `(function(){
      function mk(txt){ var d=document.createElement('div'); d.className='cr-markdown'; d.setAttribute('data-test','fake-6004-fp'); d.textContent=txt; d.style.cssText='position:fixed;left:-99999px;top:0;'; document.body.appendChild(d); }
      mk('您的使用量已超出频率限制，将在 2026-10-19 02:53:56 UTC+8 重置，您也可以切换其他模型继续使用。(6004)');
      mk('频率限制 6004/6005 请求太密；免费模型=“免费用量”上限，不能等重置 / 切模型 / 花积分');
      return 'injected-falsepositives';
    })()`);
    await new Promise(r => setTimeout(r, 1200));
    const s2 = await evaluate(ws, `window.__wbAutoSwitch ? JSON.stringify(window.__wbAutoSwitch.status()) : 'NOT-ARMED'`);
    console.log('after-chat-text:', s2.value);
    // verdict: exactly one fire (the realistic banner), none for chat text
    const v = await evaluate(ws, `(function(){
      var st = window.__wbAutoSwitch ? window.__wbAutoSwitch.status() : null;
      if (!st) return 'FAIL: not armed';
      var detectedReal = st.fires >= 1 && st.lastEvent && st.lastEvent.reason === '6004';
      var falsePos = st.fires - 1;
      return JSON.stringify({ detector: st.detector, detectedRealBanner: !!detectedReal, falsePositives: falsePos, verdict: (detectedReal && falsePos === 0) ? 'PASS' : 'CHECK' });
    })()`);
    console.log('VERDICT:', v.value);
    // cleanup fake nodes
    await evaluate(ws, `document.querySelectorAll('[data-test="fake-6004"],[data-test="fake-6004-fp"]').forEach(function(e){e.remove()})`);
    ws.close();
    return;
  }

  await evaluate(ws, `delete window.__wbAutoSwitch`); // fresh install of current code at startup
  const arm = await evaluate(ws, reactorSource(cfg));
  console.log(`[${new Date().toISOString()}] arm: ${arm.value}  fallbacks=${FALLBACKS.join(' > ')}`);

  if (mode === 'watch') {
    console.log('watching for 6004... (Ctrl+C to stop)');
    // self-heal: re-arm if the page reloaded and dropped the observer; reconnect if the WS died
    setInterval(async () => {
      try {
        const s = await evaluate(ws, `window.__wbAutoSwitch ? 'OK' : 'NOT-ARMED'`);
        if (s.value !== 'OK') {
          await evaluate(ws, reactorSource(cfg));
          console.log(`[${new Date().toISOString()}] re-armed`);
        }
      } catch (e) {
        try {
          const ws2 = await connectPage(3);
          const s2 = await evaluate(ws2, `window.__wbAutoSwitch ? 'OK' : 'NOT-ARMED'`);
          if (s2.value !== 'OK') {
            await evaluate(ws2, reactorSource(cfg));
            console.log(`[${new Date().toISOString()}] reconnected + re-armed`);
          } else {
            console.log(`[${new Date().toISOString()}] reconnected (still armed)`);
          }
        } catch (e2) { /* app not up yet */ }
      }
    }, 5000);
    setInterval(() => {}, 1000); // keep process alive
  } else {
    ws.close();
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
