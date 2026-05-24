'use strict';

const express = require('express');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── In-memory log store (no file I/O — avoids permission issues) ──
const logs = [];
let   nextId = 1;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── POST /log  ← Arduino sends here ───────────────────────────────
app.post('/log', (req, res) => {
  const entry = {
    id:      nextId++,
    message: String(req.body.message || '(no message)'),
    device:  String(req.body.device  || 'ESP-01'),
    ip:      String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
    time:    new Date().toISOString()
  };
  logs.unshift(entry);
  if (logs.length > 200) logs.pop();
  console.log('[LOG]', entry.device, '→', entry.message);
  res.json({ success: true, id: entry.id });
});

// ── GET /api/logs  ← dashboard polls this ─────────────────────────
app.get('/api/logs', (req, res) => {
  res.json(logs.slice(0, 100));
});

// ── DELETE /api/logs  ← clear button ──────────────────────────────
app.delete('/api/logs', (req, res) => {
  logs.length = 0;
  nextId = 1;
  res.json({ success: true });
});

// ── GET /  ← dashboard UI ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Arduino Logs</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0b0f1a;--surface:#111827;--border:#1f2d45;
  --accent:#3b82f6;--cyan:#06b6d4;--green:#22c55e;
  --text:#e2e8f0;--muted:#64748b;--dim:#334155;
}
body{background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,sans-serif;font-size:14px}
.topbar{
  background:var(--surface);border-bottom:1px solid var(--border);
  height:52px;padding:0 1.25rem;display:flex;align-items:center;
  justify-content:space-between;position:sticky;top:0;z-index:10;
}
.logo{font-size:1rem;font-weight:700}
.logo span{color:var(--cyan)}
.pill{
  display:inline-flex;align-items:center;gap:5px;
  padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;
  background:rgba(34,197,94,.1);color:var(--green);border:1px solid rgba(34,197,94,.25);
}
.dot{width:6px;height:6px;background:var(--green);border-radius:50%;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.actions{display:flex;gap:.4rem}
.btn{
  display:inline-flex;align-items:center;gap:5px;
  padding:5px 12px;border-radius:6px;border:1px solid transparent;
  font-size:12px;font-weight:500;cursor:pointer;transition:opacity .15s;
}
.btn:hover{opacity:.8}
.btn-primary{background:var(--accent);color:#fff}
.btn-danger{background:transparent;color:#f87171;border-color:rgba(239,68,68,.3)}
.main{max-width:900px;margin:0 auto;padding:1.25rem}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:.6rem;margin-bottom:1.25rem}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:9px;padding:.9rem 1rem}
.stat-label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:3px}
.stat-value{font-size:1.5rem;font-weight:700;color:var(--cyan)}
.stat-value.sm{font-size:.9rem;padding-top:3px;color:var(--text)}
.section-title{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin-bottom:.75rem}
#list{display:flex;flex-direction:column;gap:6px}
.entry{
  background:var(--surface);border:1px solid var(--border);
  border-left:3px solid var(--accent);border-radius:8px;
  padding:10px 14px;display:grid;grid-template-columns:32px 1fr;gap:0 10px;
  animation:fadeIn .2s ease;
}
@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.entry-num{color:var(--dim);font-size:11px;padding-top:2px;text-align:right}
.entry-msg{color:var(--text);font-size:13px;font-weight:500;margin-bottom:4px;word-break:break-all}
.entry-meta{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--muted)}
.tag-device{color:#7dd3fc}
.tag-ip{color:#86efac}
.empty{text-align:center;padding:4rem 0;color:var(--dim)}
.empty-icon{font-size:2.5rem;margin-bottom:.75rem;opacity:.4}
#status{font-size:12px;color:var(--muted)}
.toast{
  position:fixed;bottom:1.25rem;right:1.25rem;
  background:var(--surface);border:1px solid var(--border);
  border-radius:8px;padding:9px 14px;font-size:12px;
  opacity:0;transform:translateY(6px);transition:all .25s;pointer-events:none;
}
.toast.show{opacity:1;transform:none}
</style>
</head>
<body>
<div class="topbar">
  <div style="display:flex;align-items:center;gap:.6rem">
    <span class="logo">📡 Arduino <span>Logs</span></span>
    <span class="pill"><span class="dot"></span>LIVE</span>
  </div>
  <div class="actions">
    <span id="status">Loading…</span>
    <button class="btn btn-primary" onclick="load()">↻ Refresh</button>
    <button class="btn btn-danger"  onclick="clearLogs()">🗑 Clear</button>
  </div>
</div>

<div class="main">
  <div class="stats">
    <div class="stat">
      <div class="stat-label">Total Logs</div>
      <div class="stat-value" id="s-total">—</div>
    </div>
    <div class="stat">
      <div class="stat-label">Last Seen</div>
      <div class="stat-value sm" id="s-last">—</div>
    </div>
    <div class="stat">
      <div class="stat-label">Device</div>
      <div class="stat-value sm" id="s-device">—</div>
    </div>
  </div>
  <div class="section-title">Recent entries</div>
  <div id="list"></div>
</div>

<div class="toast" id="toast"></div>

<script>
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const ago = iso => {
  const s = Math.floor((Date.now()-new Date(iso))/1000);
  if(s<60) return s+'s ago';
  if(s<3600) return Math.floor(s/60)+'m ago';
  return Math.floor(s/3600)+'h ago';
};

let last = -1;

async function load(){
  try{
    const data = await fetch('/api/logs').then(r=>r.json());
    document.getElementById('status').textContent = data.length+' logs · '+new Date().toLocaleTimeString();
    document.getElementById('s-total').textContent  = data.length||'0';
    document.getElementById('s-last').textContent   = data[0] ? ago(data[0].time) : '—';
    document.getElementById('s-device').textContent = data[0]?.device ?? '—';
    if(data.length===last) return;
    last = data.length;
    const el = document.getElementById('list');
    if(!data.length){
      el.innerHTML='<div class="empty"><div class="empty-icon">📭</div>No logs yet — waiting for Arduino…</div>';
      return;
    }
    el.innerHTML = data.map((l,i)=>\`
      <div class="entry">
        <div class="entry-num">\${i+1}</div>
        <div>
          <div class="entry-msg">\${esc(l.message)}</div>
          <div class="entry-meta">
            <span class="tag-device">📟 \${esc(l.device)}</span>
            <span class="tag-ip">🌐 \${esc(l.ip)}</span>
            <span title="\${esc(l.time)}">🕐 \${ago(l.time)}</span>
          </div>
        </div>
      </div>
    \`).join('');
  }catch{
    document.getElementById('status').textContent='⚠ connection error';
  }
}

async function clearLogs(){
  if(!confirm('Delete all logs?')) return;
  await fetch('/api/logs',{method:'DELETE'});
  last=-1;
  toast('All logs cleared');
  load();
}

function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

load();
setInterval(load,5000);
</script>
</body>
</html>`);
});

// ── Start ──────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server started on port', PORT);
  console.log('POST /log      <- Arduino');
  console.log('GET  /api/logs <- JSON');
  console.log('GET  /         <- Dashboard');
});
