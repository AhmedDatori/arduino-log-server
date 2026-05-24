const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
const DB_FILE  = path.join(__dirname, 'logs.json');
const MAX_LOGS = 500;

// ── Simple JSON "database" (no native modules needed) ─────────────
function readLogs() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
}

function saveLogs(logs) {
  fs.writeFileSync(DB_FILE, JSON.stringify(logs));
}

function addLog(message, device, ip) {
  const logs  = readLogs();
  const entry = {
    id:         Date.now(),
    message:    message  || '(no message)',
    device:     device   || 'ESP-01',
    ip_address: ip       || 'unknown',
    created_at: new Date().toISOString()
  };
  logs.unshift(entry);                    // newest first
  if (logs.length > MAX_LOGS) logs.length = MAX_LOGS;
  saveLogs(logs);
  return entry;
}

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── POST /log  — Arduino sends data here ─────────────────────────
app.post('/log', (req, res) => {
  const message = req.body.message;
  const device  = req.body.device;
  const ip      = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const entry = addLog(message, device, ip);
  console.log(`[LOG #${entry.id}] ${entry.device} → ${entry.message}`);
  res.json({ success: true, id: entry.id });
});

// ── GET /api/logs  — JSON feed for the UI ────────────────────────
app.get('/api/logs', (req, res) => {
  res.json(readLogs().slice(0, 100));
});

// ── DELETE /api/logs  — clear all logs ───────────────────────────
app.delete('/api/logs', (req, res) => {
  saveLogs([]);
  res.json({ success: true });
});

// ── GET /  — Dashboard UI ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arduino Log Viewer</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0a0f1e;
      color: #cbd5e1;
      min-height: 100vh;
      padding: 2rem 1rem;
    }

    .container { max-width: 860px; margin: 0 auto; }

    header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 2rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    h1 { font-size: 1.6rem; color: #38bdf8; letter-spacing: -0.3px; }
    h1 span { opacity: 0.6; font-weight: 400; }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      color: #94a3b8;
      margin-top: 4px;
    }

    .dot {
      width: 7px; height: 7px;
      background: #4ade80;
      border-radius: 50%;
      animation: blink 2s ease-in-out infinite;
    }

    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }

    .actions { display: flex; gap: 0.5rem; }

    button {
      padding: 0.45rem 1rem;
      border-radius: 6px;
      border: none;
      font-size: 0.82rem;
      cursor: pointer;
      transition: opacity .15s;
    }
    button:hover { opacity: .8; }

    .btn-refresh { background: #1d4ed8; color: #fff; }
    .btn-clear   { background: #7f1d1d; color: #fca5a5; }

    #log-list { display: flex; flex-direction: column; gap: 0.6rem; }

    .entry {
      background: #111827;
      border: 1px solid #1e293b;
      border-left: 3px solid #38bdf8;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      display: grid;
      grid-template-columns: 40px 1fr;
      gap: 0 0.8rem;
      animation: fadeIn .25s ease;
    }

    @keyframes fadeIn { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }

    .entry-id   { color: #475569; font-size: 0.72rem; padding-top: 2px; text-align: right; }
    .entry-msg  { color: #f1f5f9; font-size: 0.9rem; word-break: break-all; margin-bottom: 5px; }

    .entry-meta {
      display: flex; flex-wrap: wrap;
      gap: 0.8rem; font-size: 0.72rem; color: #475569;
    }

    .entry-meta .device { color: #7dd3fc; }
    .entry-meta .ip     { color: #86efac; }

    .empty {
      text-align: center; color: #334155;
      padding: 4rem 0; font-size: 0.95rem;
    }

    #count-badge { font-size: 0.8rem; color: #64748b; margin-bottom: 1rem; }
  </style>
</head>
<body>
<div class="container">
  <header>
    <div>
      <h1>📡 Arduino <span>Log Viewer</span></h1>
      <div class="badge">
        <div class="dot"></div>
        <span id="status">connecting…</span>
      </div>
    </div>
    <div class="actions">
      <button class="btn-refresh" onclick="load()">↻ Refresh</button>
      <button class="btn-clear"   onclick="clearLogs()">🗑 Clear</button>
    </div>
  </header>

  <div id="count-badge"></div>
  <div id="log-list"></div>
</div>

<script>
  const esc = t => String(t ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmt = iso => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

  let lastCount = -1;

  async function load() {
    try {
      const logs = await fetch('/api/logs').then(r => r.json());

      document.getElementById('status').textContent =
        logs.length + ' log' + (logs.length !== 1 ? 's' : '') + ' · refreshes every 5 s';

      if (logs.length === lastCount) return;   // nothing changed
      lastCount = logs.length;

      document.getElementById('count-badge').textContent =
        logs.length ? 'Showing latest ' + logs.length + ' entries' : '';

      const list = document.getElementById('log-list');

      if (!logs.length) {
        list.innerHTML = '<div class="empty">No logs yet — waiting for the Arduino to send data…</div>';
        return;
      }

      list.innerHTML = logs.map((l, i) => \`
        <div class="entry">
          <div class="entry-id">\${i + 1}</div>
          <div>
            <div class="entry-msg">\${esc(l.message)}</div>
            <div class="entry-meta">
              <span class="device">📟 \${esc(l.device)}</span>
              <span class="ip">🌐 \${esc(l.ip_address)}</span>
              <span>🕐 \${fmt(l.created_at)}</span>
            </div>
          </div>
        </div>
      \`).join('');

    } catch {
      document.getElementById('status').textContent = '⚠ connection error';
    }
  }

  async function clearLogs() {
    if (!confirm('Delete all logs?')) return;
    await fetch('/api/logs', { method: 'DELETE' });
    lastCount = -1;
    load();
  }

  load();
  setInterval(load, 5000);
</script>
</body>
</html>`);
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  📡  Arduino Log Server');
  console.log('  ─────────────────────────────────');
  console.log(\`  Local:   http://localhost:\${PORT}\`);
  console.log('');
  console.log('  POST /log        ← Arduino sends here');
  console.log('  GET  /api/logs   ← JSON feed');
  console.log('  GET  /           ← Dashboard UI');
  console.log('');
});
