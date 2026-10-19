// Query live quota by fetching the app's own endpoints from its same-origin (iframe) context.
const { connect, send, evaluate } = require('./cdp');

(async () => {
  const list = await (await fetch('http://localhost:9222/json')).json();
  const tgt = list.find(t => t.type === 'iframe') || list.find(t => /workbuddy\.(cn|ai|cc)/.test(t.url));
  if (!tgt) {
    console.error('no iframe/space target. targets:', list.map(t => ({ type: t.type, url: t.url.slice(0, 70) })));
    process.exit(1);
  }
  console.log('target:', tgt.type, tgt.url.slice(0, 90));
  const ws = await connect(tgt.webSocketDebuggerUrl);
  await send(ws, 'Runtime.enable');

  const origin = await evaluate(ws, 'location.origin');
  console.log('origin:', origin.value);
  const ls = await evaluate(ws, "Object.keys(localStorage).slice(0,40).join(', ')");
  console.log('localStorage keys:', ls.value);
  const ss = await evaluate(ws, "Object.keys(sessionStorage).slice(0,40).join(', ')");
  console.log('sessionStorage keys:', ss.value);

  async function call(method, path, body) {
    const init = { method, credentials: 'include', headers: { 'Accept-Language': 'zh-CN' } };
    if (method !== 'GET' && method !== 'HEAD') { init.headers['Content-Type'] = 'application/json'; init.body = body || '{}'; }
    const expr = `(async () => {
      try {
        const r = await fetch(${JSON.stringify(path)}, ${JSON.stringify(init)});
        const t = await r.text();
        return JSON.stringify({ status: r.status, ok: r.ok, body: t.slice(0, 2000) });
      } catch(e) { return JSON.stringify({ error: String(e) }); }
    })()`;
    const res = await evaluate(ws, expr);
    console.log(`\n=== ${method} ${path} ===`);
    let v = res.value; try { v = JSON.stringify(JSON.parse(res.value), null, 2); } catch {}
    console.log(v);
  }

  await call('GET', '/v2/user/cloudagent/quota');
  await call('POST', '/billing/meter/get-user-resource-summary', '{}');
  await call('POST', '/billing/meter/get-user-resource-free-packages',
    JSON.stringify({ PackageCodes: ['TCACA_code_007_nzdH5h4Nl0', 'TCACA_code_008_cfWoLwvjU4', 'TCACA_code_030_BjSt89qTvr'], pageNumber: 1, pageSize: 20 }));
  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
