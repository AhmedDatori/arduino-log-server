const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app      = express();
const PORT     = process.env.PORT || 3000;
// Use /tmp if available (writable on most hosts), otherwise fall back to __dirname
const DB_FILE  = path.join(process.env.LOGS_PATH || __dirname, 'logs.json');
const MAX_LOGS = 500;

// ── Simple JSON "database" (no native modules needed) ─────────────
function readLogs() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return []; }
}

function saveLogs(logs) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(logs));
  } catch (e) {
    console.error('⚠ Could not write logs file:', e.message);
    // Don't crash — logs are lost but server keeps running
  }
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

// ── Serve static files from /public (index.html lives here) ──────
app.use(express.static(path.join(__dirname, 'public')));

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


// ── Global crash guards — keep the process alive ──────────────────
process.on('uncaughtException',  e => console.error('uncaughtException:',  e.message));
process.on('unhandledRejection', e => console.error('unhandledRejection:', e));

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  📡  Arduino Log Server');
  console.log('  ─────────────────────────────────');
  console.log(\`  Listening on 0.0.0.0:\${PORT}\`);
  console.log(\`  Logs file: \${DB_FILE}\`);
  console.log('');
  console.log('  POST /log        ← Arduino sends here');
  console.log('  GET  /api/logs   ← JSON feed');
  console.log('  GET  /           ← Dashboard UI');
  console.log('');
});
