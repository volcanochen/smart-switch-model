// Probe the composer + send button DOM so autoswitch can auto-send "继续".
// Read-only: dumps structure, sends nothing.
const { connect, send, evaluate } = require('./cdp');

(async () => {
  const list = await (await fetch('http://localhost:9222/json')).json();
  const t = list.find(x => x.type === 'page');
  if (!t) throw new Error('no page target (is the debug port up?)');
  const ws = await connect(t.webSocketDebuggerUrl);
  await send(ws, 'Runtime.enable');

  const r = await evaluate(ws, `(function(){
    var out = { armed: !!window.__wbAutoSwitch, textareas: [], composers: [], sendButtons: [], processing: !!document.querySelector('.cr-agent--processing') };
    // 1) text inputs / contenteditables
    var tas = document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]');
    for (var i=0;i<tas.length;i++){
      var el = tas[i];
      var rect = el.getBoundingClientRect();
      out.textareas.push({
        tag: el.tagName,
        cls: String(el.className||'').slice(0,80),
        placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '',
        contenteditable: el.getAttribute('contenteditable') || '',
        value: (el.value || el.textContent || '').slice(0,40),
        visible: rect.width > 0 && rect.height > 0
      });
    }
    // 2) composer containers
    var comps = document.querySelectorAll('[class*="composer"], [class*="editor"], [class*="input-area"], [class*="chat-input"]');
    for (var j=0;j<comps.length;j++){
      var c = comps[j];
      var cr = c.getBoundingClientRect();
      out.composers.push({ tag: c.tagName, cls: String(c.className||'').slice(0,90), visible: cr.width > 0 && cr.height > 0 });
    }
    // 3) buttons that look like send
    var btns = document.querySelectorAll('button');
    for (var k=0;k<btns.length;k++){
      var b = btns[k];
      var label = (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').replace(/\\s+/g,' ').trim();
      var cls = String(b.className||'');
      var br = b.getBoundingClientRect();
      if (/send|发送|提交|continue|继续/i.test(label + ' ' + cls) || /send|submit/i.test(cls)){
        out.sendButtons.push({
          cls: cls.slice(0,90),
          label: label.slice(0,40),
          disabled: b.disabled || b.getAttribute('aria-disabled') === 'true',
          visible: br.width > 0 && br.height > 0,
          rect: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) }
        });
      }
    }
    return JSON.stringify(out, null, 1);
  })()`);
  console.log(r.value);
  ws.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
