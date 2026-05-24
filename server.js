'use strict';

const express   = require('express');
const { Pool }  = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Supabase PostgreSQL ───────────────────────────────────────────
const pool = new Pool({
  host:     'db.hzxsjjoyijoohtumxfuc.supabase.co',
  port:     5432,
  database: 'postgres',
  user:     'postgres',
  password: 'T^y7!NvX89Dn&tJCw&wm',
  ssl:      { rejectUnauthorized: false },
  max:      10,
  idleTimeoutMillis:       30000,
  connectionTimeoutMillis: 5000
});

// ── Google Gemini ─────────────────────────────────────────────────
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── DB init ───────────────────────────────────────────────────────
async function initDB() {
  // Logs table with individual sensor columns
  await pool.query(`CREATE TABLE IF NOT EXISTS logs (
    id      SERIAL      PRIMARY KEY,
    device  TEXT        NOT NULL DEFAULT 'ESP-01',
    ip      TEXT        NOT NULL DEFAULT '',
    water   INT,
    soil    INT,
    light   INT,
    temp    FLOAT,
    hum     FLOAT,
    time    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  // Migration: add sensor columns if table was created with old schema (message TEXT)
  const migrations = [
    ['water', 'INT'], ['soil', 'INT'], ['light', 'INT'],
    ['temp', 'FLOAT'], ['hum', 'FLOAT']
  ];
  for (const [col, type] of migrations) {
    await pool.query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => {});
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS actuator_state (
    id         INT         PRIMARY KEY DEFAULT 1,
    light      BOOLEAN     NOT NULL DEFAULT FALSE,
    pump       BOOLEAN     NOT NULL DEFAULT FALSE,
    buzzer     BOOLEAN     NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO actuator_state(id) VALUES(1) ON CONFLICT(id) DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS conversations (
    id         SERIAL      PRIMARY KEY,
    role       TEXT        NOT NULL,
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
    id           SERIAL      PRIMARY KEY,
    type         TEXT        NOT NULL,
    message      TEXT        NOT NULL,
    severity     TEXT        NOT NULL DEFAULT 'info',
    acknowledged BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  console.log('[DB] Tables ready');
}

// ── Helpers ───────────────────────────────────────────────────────
async function getState() {
  const r = await pool.query('SELECT light,pump,buzzer FROM actuator_state WHERE id=1');
  return r.rows[0] || { light: false, pump: false, buzzer: false };
}

// Parse Arduino message string → sensor numbers
function parseSensor(msg) {
  const kv = {};
  (msg || '').split(',').forEach(p => {
    const i = p.indexOf(':');
    if (i > 0) kv[p.slice(0,i).trim()] = p.slice(i+1).trim();
  });
  const n = k => (kv[k] !== undefined && kv[k] !== 'N/A') ? parseFloat(kv[k]) : null;
  return { water: n('water'), soil: n('soil'), light: n('light'), temp: n('temp'), hum: n('hum') };
}

// ── Arduino POST /log ─────────────────────────────────────────────
app.post('/log', async (req, res) => {
  try {
    const msg    = String(req.body.message || '');
    const device = String(req.body.device  || 'ESP-01');
    const ip     = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
    const s      = parseSensor(msg);
    const r = await pool.query(
      'INSERT INTO logs(device,ip,water,soil,light,temp,hum) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [device, ip, s.water, s.soil, s.light, s.temp, s.hum]
    );
    const st = await getState();
    console.log('[LOG]', device, '-> water:', s.water, 'soil:', s.soil, 'light:', s.light, 'temp:', s.temp, 'hum:', s.hum);
    res.json({ success:true, id:r.rows[0].id,
      light:st.light?1:0, pump:st.pump?1:0, buzzer:st.buzzer?1:0 });
  } catch(e) {
    console.error('[/log]', e.message);
    res.status(500).json({ success:false, light:0, pump:0, buzzer:0 });
  }
});

app.get('/api/logs', async (req, res) => {
  try {
    const r = await pool.query('SELECT id,device,ip,water,soil,light,temp,hum,time FROM logs ORDER BY time DESC LIMIT 200');
    res.json(r.rows);
  } catch(e) { res.status(500).json([]); }
});
app.delete('/api/logs', async (req, res) => {
  try { await pool.query('TRUNCATE logs RESTART IDENTITY'); res.json({ success:true }); }
  catch(e) { res.status(500).json({ success:false }); }
});

app.post('/api/control', async (req, res) => {
  try {
    const { device, value } = req.body;
    const on = value==='1'||value===1||value===true||value==='true';
    if (!['light','pump','buzzer'].includes(device)) return res.status(400).json({ error:'bad device' });
    await pool.query(`UPDATE actuator_state SET ${device}=$1,updated_at=NOW() WHERE id=1`, [on]);
    const st = await getState();
    console.log('[CTRL]', device.toUpperCase(), on?'ON':'OFF');
    res.json({ success:true, state:st });
  } catch(e) { res.status(500).json({ success:false }); }
});
app.get('/api/state', async (req, res) => {
  try { res.json(await getState()); }
  catch(e) { res.status(500).json({ light:false, pump:false, buzzer:false }); }
});

// ── AI Chat ───────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error:'Empty message' });
    if (!process.env.GEMINI_API_KEY)
      return res.status(503).json({ error:'AI not configured — set GEMINI_API_KEY on Hostinger.' });

    const [logsR, st, histR] = await Promise.all([
      pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 5'),
      getState(),
      pool.query('SELECT role,content FROM conversations ORDER BY created_at DESC LIMIT 30')
    ]);

    const latest = logsR.rows[0];
    let sys = 'You are a concise AI assistant for an Arduino IoT plant monitoring system.\n';
    if (latest) {
      sys += 'Latest sensor reading:\n';
      sys += '  Water level: ' + (latest.water !== null ? latest.water + ' (0=empty,1023=full)' : 'N/A') + '\n';
      sys += '  Soil moisture: ' + (latest.soil !== null ? latest.soil + '%' : 'N/A') + '\n';
      sys += '  Light: ' + (latest.light !== null ? latest.light + '%' : 'N/A') + '\n';
      sys += '  Temperature: ' + (latest.temp !== null ? latest.temp + 'C' : 'N/A') + '\n';
      sys += '  Humidity: ' + (latest.hum !== null ? latest.hum + '%' : 'N/A') + '\n';
      sys += 'Actuators: Light=' + (st.light?'ON':'OFF') + ', Pump=' + (st.pump?'ON':'OFF') + ', Buzzer=' + (st.buzzer?'ON':'OFF') + '\n';
      sys += 'Reading time: ' + latest.time + '\n';
    }
    sys += 'Be brief and helpful. Focus on plant health.';

    const raw = histR.rows.reverse();
    const history = [];
    let lastRole = null;
    for (const m of raw) {
      if (m.role !== lastRole) {
        history.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
        lastRole = m.role;
      }
    }

    await pool.query('INSERT INTO conversations(role,content) VALUES($1,$2)', ['user', message]);

    const model  = genai.getGenerativeModel({ model: 'gemini-2.0-flash-lite', systemInstruction: sys });
    const chat   = model.startChat({ history, generationConfig: { maxOutputTokens: 512 } });
    const result = await chat.sendMessage(message);
    const text   = result.response.text();
    await pool.query('INSERT INTO conversations(role,content) VALUES($1,$2)', ['assistant', text]);

    res.json({ response: text });
  } catch(e) {
    console.error('[/api/chat]', e.message);
    res.status(500).json({ error: 'AI error: ' + e.message });
  }
});

app.get('/api/conversations', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM conversations ORDER BY created_at ASC LIMIT 100'); res.json(r.rows); }
  catch(e) { res.status(500).json([]); }
});
app.delete('/api/conversations', async (req, res) => {
  try { await pool.query('TRUNCATE conversations RESTART IDENTITY'); res.json({ success:true }); }
  catch(e) { res.status(500).json({ success:false }); }
});

app.get('/api/notifications', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50'); res.json(r.rows); }
  catch(e) { res.status(500).json([]); }
});
app.post('/api/notifications/:id/ack', async (req, res) => {
  try { await pool.query('UPDATE notifications SET acknowledged=TRUE WHERE id=$1', [req.params.id]); res.json({ success:true }); }
  catch(e) { res.status(500).json({ success:false }); }
});
app.delete('/api/notifications', async (req, res) => {
  try { await pool.query('TRUNCATE notifications RESTART IDENTITY'); res.json({ success:true }); }
  catch(e) { res.status(500).json({ success:false }); }
});

// ── Notification Checker (every 5 min) ────────────────────────────
const lastNotified = {};
const COOLDOWN     = 5 * 60 * 1000;

async function checkNotifications() {
  try {
    const logsR = await pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 1');
    if (!logsR.rows.length) return;
    const log = logsR.rows[0];
    const now = Date.now();
    const age = now - new Date(log.time).getTime();
    const st  = await getState();
    // Use direct DB columns (new schema)
    const s = { water: log.water, soil: log.soil, light: log.light, temp: log.temp, hum: log.hum };

    const alert = async (type, msg, sev) => {
      if (!lastNotified[type] || (now - lastNotified[type]) >= COOLDOWN) {
        await pool.query('INSERT INTO notifications(type,message,severity) VALUES($1,$2,$3)', [type, msg, sev]);
        lastNotified[type] = now;
        console.log('[ALERT]', sev.toUpperCase(), msg);
      }
    };

    if (age > 15 * 60 * 1000)
      await alert('offline', 'Arduino offline — no data in 15+ minutes', 'danger');
    if (s.water !== null) {
      if (s.water < 200)      await alert('water_empty', 'Water reservoir EMPTY (' + s.water + ')', 'danger');
      else if (s.water < 500) await alert('water_low',   'Water level LOW ('   + s.water + ')', 'warning');
    }
    if (s.soil !== null && s.soil < 30 && !st.pump)
      await alert('soil_dry', 'Soil DRY (' + s.soil + '%) — pump is OFF', 'warning');
    if (s.light !== null && s.light < 20 && !st.light)
      await alert('light_dark', 'Light DARK (' + s.light + '%) — grow light OFF', 'warning');
    if (s.temp !== null) {
      if (s.temp > 35) await alert('temp_high', 'Temperature HIGH: ' + s.temp + 'C', 'danger');
      if (s.temp < 10) await alert('temp_cold', 'Temperature LOW: '  + s.temp + 'C', 'warning');
    }
    if (s.hum !== null && s.hum > 80)
      await alert('hum_high', 'Humidity very HIGH: ' + s.hum + '%', 'warning');
  } catch(e) { console.error('[checkNotifications]', e.message); }
}

// ── Dashboard HTML ────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Plant Monitor</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@500;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow-x:hidden}
body{background:#060b11;color:#cdd9e8;font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.5}
body::before{content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(ellipse 55% 45% at 10% 10%,rgba(61,255,160,.05) 0%,transparent 65%),
             radial-gradient(ellipse 45% 40% at 90% 90%,rgba(56,178,248,.04) 0%,transparent 65%)}
header{position:sticky;top:0;z-index:100;height:62px;background:rgba(6,11,17,.9);backdrop-filter:blur(14px);border-bottom:1px solid #1a2d42}
.hinner{max-width:1180px;margin:0 auto;height:100%;padding:0 1.5rem;display:flex;align-items:center;gap:1.25rem}
.logo{font-family:'Syne',sans-serif;font-weight:800;font-size:1.05rem;color:#cdd9e8;letter-spacing:-.02em;white-space:nowrap;display:flex;align-items:center;gap:9px}
.logo-icon{width:26px;height:26px;flex-shrink:0}
.logo em{color:#3dffa0;font-style:normal}
.tabs{display:flex;position:relative;gap:0}
.tab{background:none;border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:#4a6080;padding:8px 18px;transition:color .2s}
.tab.active{color:#3dffa0}
.tab-bar{position:absolute;bottom:-1px;height:2px;left:0;width:0;background:#3dffa0;border-radius:2px 2px 0 0;box-shadow:0 0 10px rgba(61,255,160,.7);transition:transform .32s cubic-bezier(.4,0,.2,1),width .32s cubic-bezier(.4,0,.2,1)}
.h-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.live{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.1em;color:#3dffa0;padding:4px 11px;border-radius:20px;border:1px solid rgba(61,255,160,.28);background:rgba(61,255,160,.07)}
.pulse{width:6px;height:6px;border-radius:50%;background:#3dffa0;box-shadow:0 0 6px #3dffa0;animation:blink 1.8s ease-in-out infinite}
@keyframes blink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.7)}}
.icon-btn{background:none;border:1px solid #1a2d42;border-radius:8px;color:#7a94b0;padding:6px 11px;cursor:pointer;font-size:15px;transition:all .2s}
.icon-btn:hover{border-color:#3dffa0;color:#3dffa0}
.bell-btn{position:relative;background:none;border:1px solid #1a2d42;border-radius:8px;color:#7a94b0;padding:6px 11px;cursor:pointer;font-size:15px;transition:all .2s}
.bell-btn:hover{border-color:#f5a524;color:#f5a524}
.notif-badge{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;background:#ff4d6d;color:#fff;font-size:9px;font-weight:700;display:none;align-items:center;justify-content:center;padding:0 3px}
.notif-badge.show{display:flex}
.view{display:none;min-height:calc(100vh - 62px)}
.view.active{display:block}
.wrap{max-width:1180px;margin:0 auto;padding:2rem 1.5rem}

/* ── Device status bar ────────────────────────── */
.device-bar{display:flex;align-items:center;gap:1.5rem;padding:.75rem 1.5rem;background:rgba(255,255,255,.025);border-bottom:1px solid #0f1e2e;font-size:12px;color:#4a6080}
.device-bar-inner{max-width:1180px;margin:0 auto;width:100%;display:flex;align-items:center;gap:2rem}
.db-item{display:flex;align-items:center;gap:6px}
.db-label{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#2a3f58}
.db-val{color:#7a94b0;font-family:'JetBrains Mono',monospace;font-size:12px}
.db-val.green{color:#3dffa0}
.db-dot{width:6px;height:6px;border-radius:50%;background:#3dffa0;animation:blink 1.8s ease-in-out infinite;flex-shrink:0}
.db-dot.offline{background:#ff4d6d;animation:none}

/* ── Sensor grid ────────────────────────────────── */
.sensor-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1.25rem;margin-bottom:2rem}
.scard{background:rgba(10,20,35,.6);border:1px solid #0f1e2e;border-radius:16px;padding:1.5rem 1.25rem 1.25rem;display:flex;flex-direction:column;align-items:center;gap:.6rem;position:relative;overflow:hidden;transition:border-color .3s}
.scard::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(var(--cr),var(--cg),var(--cb),.07) 0%,transparent 60%);pointer-events:none;border-radius:16px}
.scard-icon{font-size:1.6rem;line-height:1}
.scard-label{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#4a6080}
.gauge-wrap{position:relative;width:100px;height:100px;display:flex;align-items:center;justify-content:center}
.gauge-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column}
.gauge-val{font-family:'JetBrains Mono',monospace;font-size:1.1rem;font-weight:700;color:#cdd9e8}
.gauge-arc{transition:stroke-dasharray .6s ease}
.bignum-wrap{display:flex;align-items:baseline;gap:4px;margin:.25rem 0}
.num-val{font-family:'JetBrains Mono',monospace;font-size:2rem;font-weight:700;color:#cdd9e8;line-height:1}
.num-unit{font-size:.85rem;color:#4a6080}
.num-na{font-family:'JetBrains Mono',monospace;font-size:1.6rem;color:#2a3f58}
.status-badge{font-size:10px;font-weight:700;letter-spacing:.08em;padding:3px 10px;border-radius:20px;border:1px solid currentColor}

/* ── Section header ─────────────────────────────── */
.section-hdr{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#2a3f58;padding-bottom:.6rem;border-bottom:1px solid #0f1e2e;margin-bottom:1.25rem}

/* ── Controls ───────────────────────────────────── */
.ctrl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1.25rem;margin-bottom:2rem}
.ctrl-card{background:rgba(10,20,35,.6);border:1px solid #0f1e2e;border-radius:16px;padding:1.5rem 1.25rem 1.25rem;display:flex;flex-direction:column;align-items:center;gap:.5rem;transition:border-color .3s;border-color:var(--c)}
.ctrl-icon{font-size:1.8rem}
.ctrl-name{font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#4a6080}
.ctrl-state-val{font-family:'JetBrains Mono',monospace;font-size:.8rem;color:var(--c);min-height:1em}
.ctrl-btns{display:flex;gap:.5rem;margin-top:.25rem}
.cbon,.cboff{border:1px solid;border-radius:8px;padding:5px 14px;cursor:pointer;font-size:12px;font-weight:600;transition:all .2s;font-family:'DM Sans',sans-serif}
.cbon{border-color:rgba(61,255,160,.3);color:#3dffa0;background:rgba(61,255,160,.07)}
.cboff{border-color:rgba(255,77,109,.3);color:#ff4d6d;background:rgba(255,77,109,.07)}
.ctrl-hint{font-size:10px;color:#2a3f58}

/* ── History ────────────────────────────────────── */
.hist-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}
.hist-title{font-family:'Syne',sans-serif;font-weight:700;font-size:1rem}
.btn-clear{background:none;border:1px solid #1a2d42;border-radius:8px;color:#4a6080;padding:5px 14px;cursor:pointer;font-size:12px;transition:all .2s}
.btn-clear:hover{border-color:#ff4d6d;color:#ff4d6d}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#2a3f58;padding:.6rem .8rem;border-bottom:1px solid #0f1e2e;text-align:left}
td{padding:.55rem .8rem;border-bottom:1px solid rgba(15,30,46,.6);font-size:12px;vertical-align:middle}
tr:hover td{background:rgba(255,255,255,.02)}
.td-num{color:#2a3f58;font-family:'JetBrains Mono',monospace;font-size:11px}
.td-time{font-family:'JetBrains Mono',monospace;font-size:11px;white-space:nowrap}
.td-ago{display:block;font-size:10px;color:#2a3f58}
.td-dev{color:#7a94b0;font-size:11px}
.td-na{color:#2a3f58}
.cv-g{color:#3dffa0} .cv-a{color:#f5a524} .cv-r{color:#ff4d6d} .cv-b{color:#38b2f8} .cv-m{color:#4a6080}
.empty-row td{text-align:center;color:#2a3f58;padding:2.5rem}

/* ── Chat ───────────────────────────────────────── */
.chat-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}
.chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 220px);min-height:400px}
.chat-msgs{flex:1;overflow-y:auto;border:1px solid #0f1e2e;border-radius:12px;padding:1rem;display:flex;flex-direction:column;gap:.75rem;background:rgba(6,11,17,.5)}
.msg{display:flex;flex-direction:column;gap:2px;max-width:80%}
.msg.user{align-self:flex-end;align-items:flex-end}
.msg.ai{align-self:flex-start}
.msg-role{font-size:10px;font-weight:600;letter-spacing:.06em;color:#2a3f58;text-transform:uppercase}
.msg-bubble{background:rgba(255,255,255,.05);border:1px solid #0f1e2e;border-radius:10px;padding:.5rem .75rem;font-size:13px;line-height:1.55}
.msg.user .msg-bubble{background:rgba(61,255,160,.08);border-color:rgba(61,255,160,.2)}
.msg-time{font-size:10px;color:#2a3f58;font-family:'JetBrains Mono',monospace}
.chat-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:1rem;color:#2a3f58}
.chat-empty-icon{font-size:3rem}
.chat-hints{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;margin-top:.5rem}
.chat-hint-chip{background:rgba(61,255,160,.06);border:1px solid rgba(61,255,160,.2);border-radius:20px;padding:4px 12px;font-size:12px;color:#3dffa0;cursor:pointer;transition:background .2s}
.chat-hint-chip:hover{background:rgba(61,255,160,.14)}
.typing{display:flex;gap:5px;align-items:center;padding:.25rem 0}
.typing-dot{width:6px;height:6px;border-radius:50%;background:#3dffa0;animation:tdot 1.2s ease-in-out infinite}
.typing-dot:nth-child(2){animation-delay:.2s}
.typing-dot:nth-child(3){animation-delay:.4s}
@keyframes tdot{0%,80%,100%{transform:scale(.6);opacity:.4}40%{transform:scale(1);opacity:1}}
.chat-form{display:flex;gap:.75rem;margin-top:.75rem}
.chat-inp{flex:1;background:rgba(10,20,35,.8);border:1px solid #1a2d42;border-radius:10px;padding:.6rem 1rem;color:#cdd9e8;font-family:'DM Sans',sans-serif;font-size:13px;outline:none;transition:border-color .2s}
.chat-inp:focus{border-color:#3dffa0}
.chat-send{background:#3dffa0;border:none;border-radius:10px;padding:.6rem 1.25rem;color:#060b11;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .2s}
.chat-send:hover{opacity:.85}
.chat-send:disabled{opacity:.4;cursor:default}

/* ── Alerts ─────────────────────────────────────── */
.alerts-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}
.alerts-empty{display:flex;flex-direction:column;align-items:center;gap:.75rem;padding:3rem;color:#2a3f58}
.alerts-empty-icon{font-size:2.5rem}
.alert-item{display:flex;align-items:flex-start;gap:1rem;padding:1rem;border:1px solid #0f1e2e;border-radius:12px;margin-bottom:.75rem;background:rgba(10,20,35,.5)}
.alert-item.danger{border-color:rgba(255,77,109,.25);background:rgba(255,77,109,.05)}
.alert-item.warning{border-color:rgba(245,165,36,.25);background:rgba(245,165,36,.05)}
.alert-item.acked{opacity:.45}
.alert-icon{font-size:1.2rem;flex-shrink:0;margin-top:2px}
.alert-body{flex:1}
.alert-msg{font-size:13px;color:#cdd9e8;margin-bottom:3px}
.alert-meta{font-size:11px;color:#2a3f58}
.btn-ack{background:none;border:1px solid #1a2d42;border-radius:6px;color:#4a6080;padding:3px 10px;cursor:pointer;font-size:11px;flex-shrink:0;align-self:center;transition:all .2s;white-space:nowrap}
.btn-ack:hover{border-color:#3dffa0;color:#3dffa0}
</style>
</head>
<body>

<header>
  <div class="hinner">
    <div class="logo">
      <svg class="logo-icon" viewBox="0 0 24 24" fill="none">
        <path d="M12 22C12 22 4 16 4 9a7 7 0 0 1 10.9-5.8" stroke="#3dffa0" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M12 22C12 22 20 16 20 9a7 7 0 0 0-3-5.8" stroke="#3dffa0" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M12 22V11" stroke="#3dffa0" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>PLANT<em>.</em>MONITOR</span>
    </div>
    <nav class="tabs">
      <button class="tab active" data-tab="status"  onclick="switchTab('status')">Status</button>
      <button class="tab"        data-tab="history" onclick="switchTab('history')">History</button>
      <button class="tab"        data-tab="chat"    onclick="switchTab('chat')">AI Chat</button>
      <button class="tab"        data-tab="alerts"  onclick="switchTab('alerts')">Alerts</button>
      <div class="tab-bar" id="tab-bar"></div>
    </nav>
    <div class="h-right">
      <div class="live"><span class="pulse"></span>LIVE</div>
      <button class="bell-btn" onclick="switchTab('alerts')" title="Alerts">
        &#128276;<span class="notif-badge" id="notif-badge"></span>
      </button>
      <button class="icon-btn" onclick="forceRefresh()" title="Refresh">&#8635;</button>
    </div>
  </div>
</header>

<!-- thin device status bar -->
<div class="device-bar">
  <div class="device-bar-inner">
    <div class="db-item"><span class="db-dot" id="db-dot"></span><span class="db-label">Status</span><span class="db-val green" id="db-status">Waiting...</span></div>
    <div class="db-item"><span class="db-label">Device</span><span class="db-val" id="s-device">&#8212;</span></div>
    <div class="db-item"><span class="db-label">Last&nbsp;Seen</span><span class="db-val" id="s-last">&#8212;</span></div>
    <div class="db-item"><span class="db-label">Logs</span><span class="db-val" id="s-total">0</span></div>
  </div>
</div>

<!-- STATUS VIEW -->
<div class="view active" id="view-status">
  <div class="wrap">
    <div class="section-hdr">Sensors</div>
    <div class="sensor-grid" id="sensor-grid">
      <!-- always rendered by JS, shows N/A until data arrives -->
    </div>
    <div class="section-hdr">Controls</div>
    <div class="ctrl-grid">
      <div class="ctrl-card" id="ctrl-light" style="--c:#4a6080">
        <div class="ctrl-icon">&#128161;</div>
        <div class="ctrl-name">Grow Light</div>
        <div class="ctrl-state-val" id="cst-light">&#8212;</div>
        <div class="ctrl-btns">
          <button class="cbon"  onclick="control('light',1)">&#9679; ON</button>
          <button class="cboff" onclick="control('light',0)">&#9675; OFF</button>
        </div>
        <div class="ctrl-hint">Pin D9 &mdash; next POST cycle</div>
      </div>
      <div class="ctrl-card" id="ctrl-pump" style="--c:#4a6080">
        <div class="ctrl-icon">&#128167;</div>
        <div class="ctrl-name">Water Pump</div>
        <div class="ctrl-state-val" id="cst-pump">&#8212;</div>
        <div class="ctrl-btns">
          <button class="cbon"  onclick="control('pump',1)">&#9679; ON</button>
          <button class="cboff" onclick="control('pump',0)">&#9675; OFF</button>
        </div>
        <div class="ctrl-hint">Pin D10 &mdash; next POST cycle</div>
      </div>
      <div class="ctrl-card" id="ctrl-buzzer" style="--c:#4a6080">
        <div class="ctrl-icon">&#128276;</div>
        <div class="ctrl-name">Buzzer</div>
        <div class="ctrl-state-val" id="cst-buzzer">&#8212;</div>
        <div class="ctrl-btns">
          <button class="cbon"  onclick="control('buzzer',1)">&#9679; ON</button>
          <button class="cboff" onclick="control('buzzer',0)">&#9675; OFF</button>
        </div>
        <div class="ctrl-hint">Pin D6 &mdash; next POST cycle</div>
      </div>
    </div>
  </div>
</div>

<!-- HISTORY VIEW -->
<div class="view" id="view-history">
  <div class="wrap">
    <div class="hist-header">
      <div class="hist-title">&#128200; Log History</div>
      <button class="btn-clear" onclick="clearLogs()">&#128465; Clear All</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>#</th><th>Time</th><th>Device</th>
          <th>Water</th><th>Soil %</th><th>Light %</th>
          <th>Temp &#176;C</th><th>Hum %</th>
        </tr></thead>
        <tbody id="hist-body"><tr class="empty-row"><td colspan="8">Loading...</td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<!-- CHAT VIEW -->
<div class="view" id="view-chat">
  <div class="wrap">
    <div class="chat-header">
      <div class="hist-title">&#127807; AI Plant Assistant</div>
      <button class="btn-clear" onclick="clearChat()">&#128465; Clear Chat</button>
    </div>
    <div class="chat-wrap">
      <div class="chat-msgs" id="chat-msgs">
        <div class="chat-empty" id="chat-empty">
          <div class="chat-empty-icon">&#129302;</div>
          <div>Ask me anything about your plant</div>
          <div class="chat-hints">
            <span class="chat-hint-chip" onclick="fillHint('How is my plant doing?')">How is my plant?</span>
            <span class="chat-hint-chip" onclick="fillHint('Is the soil too dry?')">Soil status?</span>
            <span class="chat-hint-chip" onclick="fillHint('Should I turn on the pump?')">Turn on pump?</span>
            <span class="chat-hint-chip" onclick="fillHint('What is the temperature trend?')">Temp trend?</span>
          </div>
        </div>
      </div>
      <form class="chat-form" onsubmit="sendChatForm(event)">
        <input type="text" id="chat-input" class="chat-inp" placeholder="Ask about your plant..." autocomplete="off"/>
        <button type="submit" id="chat-send-btn" class="chat-send">Send &#10148;</button>
      </form>
    </div>
  </div>
</div>

<!-- ALERTS VIEW -->
<div class="view" id="view-alerts">
  <div class="wrap">
    <div class="alerts-header">
      <div class="hist-title">&#128276; Alerts</div>
      <button class="btn-clear" onclick="clearAlerts()">&#128465; Clear All</button>
    </div>
    <div id="alerts-list"></div>
  </div>
</div>

<script>
// ── Tabs ──────────────────────────────────────────────────────────
var currentTab = 'status';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelector('.tab[data-tab="' + tab + '"]').classList.add('active');
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('view-' + tab).classList.add('active');
  positionBar();
  if (tab === 'chat')   { loadConversations(); }
  if (tab === 'alerts') { loadAlerts(); }
}
function positionBar() {
  var active = document.querySelector('.tab.active');
  var bar    = document.getElementById('tab-bar');
  var nav    = document.querySelector('.tabs');
  if (!active || !bar || !nav) return;
  var nr = nav.getBoundingClientRect(), ar = active.getBoundingClientRect();
  bar.style.width     = ar.width + 'px';
  bar.style.transform = 'translateX(' + (ar.left - nr.left) + 'px)';
}

// ── Helpers ───────────────────────────────────────────────────────
function ago(iso) {
  var s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  return Math.floor(s/3600) + 'h ago';
}
function escHtml(str) {
  return String(str).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('\n').join('<br>');
}
// Extract sensor numbers from a log row (new schema: direct columns)
function rowToSensor(l) {
  if (!l) return { water:null, soil:null, light:null, temp:null, hum:null };
  return {
    water: l.water  !== null && l.water  !== undefined ? Number(l.water)  : null,
    soil:  l.soil   !== null && l.soil   !== undefined ? Number(l.soil)   : null,
    light: l.light  !== null && l.light  !== undefined ? Number(l.light)  : null,
    temp:  l.temp   !== null && l.temp   !== undefined ? Number(l.temp)   : null,
    hum:   l.hum    !== null && l.hum    !== undefined ? Number(l.hum)    : null
  };
}

// ── Colors & info ─────────────────────────────────────────────────
var G='#3dffa0', A='#f5a524', R='#ff4d6d', B='#38b2f8', M='#4a6080';
var GB='rgba(61,255,160,.12)',AB='rgba(245,165,36,.12)',RB='rgba(255,77,109,.12)',BB='rgba(56,178,248,.12)',MB='rgba(74,96,128,.12)';

function waterInfo(v) {
  if (v===null) return {label:'N/A',color:M,bg:MB,pct:0};
  var p=Math.round(v/1023*100);
  if (v<200)  return {label:'EMPTY', color:R,bg:RB,pct:p};
  if (v<500)  return {label:'LOW',   color:A,bg:AB,pct:p};
  if (v<800)  return {label:'MED',   color:A,bg:AB,pct:p};
  return             {label:'FULL',  color:G,bg:GB,pct:p};
}
function soilInfo(v)  {
  if (v===null) return {label:'N/A',color:M,bg:MB};
  if (v<30) return {label:'DRY',color:R,bg:RB};
  if (v<60) return {label:'OK', color:A,bg:AB};
  return           {label:'WET',color:G,bg:GB};
}
function lightInfo(v) {
  if (v===null) return {label:'N/A',color:M,bg:MB};
  if (v<20) return {label:'DARK',  color:M,bg:MB};
  if (v<60) return {label:'DIM',   color:A,bg:AB};
  return           {label:'BRIGHT',color:G,bg:GB};
}
function tempInfo(v)  {
  if (v===null) return {label:'N/A',color:M,bg:MB};
  if (v<10) return {label:'COLD',  color:B,bg:BB};
  if (v>35) return {label:'HOT',   color:R,bg:RB};
  return           {label:'NORMAL',color:G,bg:GB};
}
function humInfo(v) {
  if (v===null) return {label:'N/A',color:M,bg:MB};
  if (v<30) return {label:'DRY',  color:R,bg:RB};
  if (v>70) return {label:'HUMID',color:B,bg:BB};
  return           {label:'GOOD', color:G,bg:GB};
}
function colorCls(c) { return c===G?'cv-g':c===A?'cv-a':c===R?'cv-r':c===B?'cv-b':'cv-m'; }
function hexToRgb(h) {
  var r=parseInt(h.slice(1,3),16),g=parseInt(h.slice(3,5),16),b=parseInt(h.slice(5,7),16);
  return r+','+g+','+b;
}

// ── Gauge SVG ─────────────────────────────────────────────────────
var CIRC=263.9, MAXARC=197.9;
function gauge(pct, color) {
  var p = Math.min(100, Math.max(0, isNaN(pct) ? 0 : pct));
  var arc = (MAXARC*p/100).toFixed(1);
  var gap = (CIRC - parseFloat(arc)).toFixed(1);
  return '<svg viewBox="0 0 120 120" width="100" height="100">'
    + '<circle r="42" cx="60" cy="60" fill="none" stroke="#0f1e2e" stroke-width="9"'
    + ' stroke-dasharray="197.9 66.0" transform="rotate(135 60 60)" stroke-linecap="round"/>'
    + '<circle r="42" cx="60" cy="60" fill="none" stroke="' + color + '" stroke-width="9"'
    + ' stroke-dasharray="' + arc + ' ' + gap + '" transform="rotate(135 60 60)"'
    + ' stroke-linecap="round" class="gauge-arc"/>'
    + '</svg>';
}
function badge(info) {
  return '<div class="status-badge" style="color:' + info.color + ';background:' + info.bg + ';border-color:' + info.color + '">' + info.label + '</div>';
}
function gaugeCard(icon, label, valStr, pct, info) {
  var rgb = hexToRgb(info.color);
  return '<div class="scard" style="--cr:' + rgb.split(',')[0] + ';--cg:' + rgb.split(',')[1] + ';--cb:' + rgb.split(',')[2] + '">'
    + '<div class="scard-icon">' + icon + '</div>'
    + '<div class="scard-label">' + label + '</div>'
    + '<div class="gauge-wrap">' + gauge(pct, info.color)
    + '<div class="gauge-center"><div class="gauge-val">' + valStr + '</div></div></div>'
    + badge(info) + '</div>';
}
function bigCard(icon, label, val, unit, info) {
  var rgb = hexToRgb(info.color);
  var inner = val === null
    ? '<span class="num-na">N/A</span>'
    : '<span class="num-val">' + val.toFixed(1) + '</span><span class="num-unit">' + unit + '</span>';
  return '<div class="scard" style="--cr:' + rgb.split(',')[0] + ';--cg:' + rgb.split(',')[1] + ';--cb:' + rgb.split(',')[2] + '">'
    + '<div class="scard-icon">' + icon + '</div>'
    + '<div class="scard-label">' + label + '</div>'
    + '<div class="bignum-wrap">' + inner + '</div>'
    + badge(info) + '</div>';
}

function renderCards(s) {
  var wi = waterInfo(s.water), si = soilInfo(s.soil), li = lightInfo(s.light);
  var ti = tempInfo(s.temp),   hi = humInfo(s.hum);
  var waterVal = s.water !== null ? String(s.water) : '&#8212;';
  var soilVal  = s.soil  !== null ? s.soil + '%'    : '&#8212;';
  var lightVal = s.light !== null ? s.light + '%'   : '&#8212;';
  return gaugeCard('&#128167;', 'Water Level',   waterVal, wi.pct, wi)
       + gaugeCard('&#127807;', 'Soil Moisture', soilVal,  s.soil, si)
       + gaugeCard('&#9728;',   'Light',         lightVal, s.light, li)
       + bigCard('&#127777;',   'Temperature', s.temp, '&#176;C', ti)
       + bigCard('&#128166;',   'Humidity',    s.hum,  '%',       hi);
}

// ── History table ─────────────────────────────────────────────────
function wLabel(v) {
  if (v===null) return '<span class="td-na">&#8212;</span>';
  if (v<200) return '<span class="cv-r">EMPTY</span>';
  if (v<500) return '<span class="cv-a">LOW</span>';
  if (v<800) return '<span class="cv-a">MED</span>';
  return '<span class="cv-g">FULL</span>';
}
function numCell(v, infoFn, suffix) {
  if (v===null) return '<span class="td-na">&#8212;</span>';
  var i = infoFn(v);
  return '<span class="' + colorCls(i.color) + '">' + (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(1) : v) + (suffix||'') + '</span>';
}
function renderHistory(data) {
  if (!data.length) return '<tr class="empty-row"><td colspan="8">No logs yet</td></tr>';
  return data.map(function(l, i) {
    var s = rowToSensor(l);
    var t = new Date(l.time);
    var ts = t.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    var ds = t.toLocaleDateString([], {month:'short',day:'numeric'});
    return '<tr>'
      + '<td class="td-num">' + (i+1) + '</td>'
      + '<td class="td-time">' + ts + '<span class="td-ago">' + ds + ' &middot; ' + ago(l.time) + '</span></td>'
      + '<td class="td-dev">' + (l.device||'?') + '</td>'
      + '<td>' + wLabel(s.water) + '</td>'
      + '<td>' + numCell(s.soil,  soilInfo,  '%') + '</td>'
      + '<td>' + numCell(s.light, lightInfo, '%') + '</td>'
      + '<td>' + numCell(s.temp,  tempInfo,  '') + '</td>'
      + '<td>' + numCell(s.hum,   humInfo,   '%') + '</td>'
      + '</tr>';
  }).join('');
}

// ── Controls ──────────────────────────────────────────────────────
function setCtrlState(device, on) {
  var card  = document.getElementById('ctrl-' + device);
  var stEl  = document.getElementById('cst-' + device);
  if (!card || !stEl) return;
  card.style.setProperty('--c', on ? G : M);
  stEl.textContent = on ? 'ON' : 'OFF';
  var onBtn  = card.querySelector('.cbon');
  var offBtn = card.querySelector('.cboff');
  if (onBtn)  { onBtn.style.background  = on  ? G : 'rgba(61,255,160,.07)';  onBtn.style.color  = on  ? '#060b11' : G; onBtn.style.borderColor  = on  ? G : 'rgba(61,255,160,.3)'; }
  if (offBtn) { offBtn.style.background = !on ? R : 'rgba(255,77,109,.07)'; offBtn.style.color = !on ? '#fff'    : R; offBtn.style.borderColor = !on ? R : 'rgba(255,77,109,.3)'; }
}
async function control(device, val) {
  var on = val === 1; setCtrlState(device, on);
  try {
    var f = new URLSearchParams(); f.append('device', device); f.append('value', String(val));
    var resp = await fetch('/api/control', {method:'POST', body:f}).then(function(r){ return r.json(); });
    if (resp && resp.state) {
      setCtrlState('light',  resp.state.light);
      setCtrlState('pump',   resp.state.pump);
      setCtrlState('buzzer', resp.state.buzzer);
    }
  } catch(e) {}
}

// ── Chat ──────────────────────────────────────────────────────────
var chatBusy = false;
function scrollChat() { var c = document.getElementById('chat-msgs'); if(c) c.scrollTop = c.scrollHeight; }
function fillHint(text) { var inp = document.getElementById('chat-input'); if(inp){ inp.value = text; inp.focus(); } }

async function loadConversations() {
  try {
    var msgs = await fetch('/api/conversations').then(function(r){ return r.json(); });
    var c = document.getElementById('chat-msgs');
    if (!msgs.length) {
      c.innerHTML = '<div class="chat-empty" id="chat-empty"><div class="chat-empty-icon">&#129302;</div><div>Ask me anything about your plant</div>'
        + '<div class="chat-hints">'
        + '<span class="chat-hint-chip" onclick="fillHint(\'How is my plant doing?\')">How is my plant?</span>'
        + '<span class="chat-hint-chip" onclick="fillHint(\'Is the soil too dry?\')">Soil status?</span>'
        + '<span class="chat-hint-chip" onclick="fillHint(\'Should I turn on the pump?\')">Turn on pump?</span>'
        + '</div></div>';
      return;
    }
    c.innerHTML = msgs.map(function(m) {
      var cls    = m.role === 'user' ? 'user' : 'ai';
      var roleLbl = m.role === 'user' ? 'You' : '&#127807; AI';
      var t = new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      return '<div class="msg ' + cls + '">'
        + '<div class="msg-role">' + roleLbl + '</div>'
        + '<div class="msg-bubble">' + escHtml(m.content) + '</div>'
        + '<div class="msg-time">' + t + '</div>'
        + '</div>';
    }).join('');
    scrollChat();
  } catch(e) {}
}

function showTyping() {
  var c = document.getElementById('chat-msgs');
  if (!document.getElementById('typing-wrap') && c) {
    var d = document.createElement('div'); d.id = 'typing-wrap'; d.className = 'msg ai';
    d.innerHTML = '<div class="msg-role">&#127807; AI</div><div class="typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
    c.appendChild(d); scrollChat();
  }
}
function hideTyping() { var t = document.getElementById('typing-wrap'); if(t) t.remove(); }

async function sendChatForm(e) { e.preventDefault(); await doSendChat(); }
async function doSendChat() {
  var inp = document.getElementById('chat-input');
  var btn = document.getElementById('chat-send-btn');
  var msg = (inp.value || '').trim();
  if (!msg || chatBusy) return;
  inp.value = ''; chatBusy = true; btn.disabled = true;

  var c = document.getElementById('chat-msgs');
  var empty = document.getElementById('chat-empty');
  if (empty) empty.remove();

  var ud = document.createElement('div'); ud.className = 'msg user';
  ud.innerHTML = '<div class="msg-role">You</div><div class="msg-bubble">' + escHtml(msg) + '</div>';
  c.appendChild(ud); scrollChat(); showTyping();

  try {
    var f = new URLSearchParams(); f.append('message', msg);
    var r = await fetch('/api/chat', {method:'POST', body:f}).then(function(x){ return x.json(); });
    hideTyping();
    var ad = document.createElement('div'); ad.className = 'msg ai';
    if (r.error) {
      ad.innerHTML = '<div class="msg-role">&#127807; AI</div><div class="msg-bubble" style="color:#ff4d6d">' + escHtml(r.error) + '</div>';
    } else {
      ad.innerHTML = '<div class="msg-role">&#127807; AI</div><div class="msg-bubble">' + escHtml(r.response) + '</div>';
    }
    c.appendChild(ad); scrollChat();
  } catch(err) { hideTyping(); }
  chatBusy = false; btn.disabled = false; inp.focus();
}
async function clearChat() {
  if (!confirm('Clear all conversations?')) return;
  await fetch('/api/conversations', {method:'DELETE'});
  loadConversations();
}

// ── Alerts ────────────────────────────────────────────────────────
async function loadAlerts() {
  try {
    var alerts = await fetch('/api/notifications').then(function(r){ return r.json(); });
    renderAlerts(alerts);
    var unread = alerts.filter(function(a){ return !a.acknowledged; }).length;
    var badge  = document.getElementById('notif-badge');
    if (badge) { badge.textContent = unread > 9 ? '9+' : String(unread); badge.className = unread > 0 ? 'notif-badge show' : 'notif-badge'; }
  } catch(e) {}
}
function renderAlerts(alerts) {
  var c = document.getElementById('alerts-list'); if (!c) return;
  if (!alerts.length) { c.innerHTML = '<div class="alerts-empty"><div class="alerts-empty-icon">&#9989;</div><div>All clear! No alerts.</div></div>'; return; }
  var icons = {danger:'&#128308;', warning:'&#128993;', info:'&#128309;'};
  c.innerHTML = alerts.map(function(a) {
    var icon  = icons[a.severity] || icons.warning;
    var t     = new Date(a.created_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    var acked = a.acknowledged ? ' acked' : '';
    return '<div class="alert-item ' + a.severity + acked + '">'
      + '<div class="alert-icon">' + icon + '</div>'
      + '<div class="alert-body"><div class="alert-msg">' + escHtml(a.message) + '</div>'
      + '<div class="alert-meta">' + t + (a.acknowledged ? ' &middot; Dismissed' : '') + '</div></div>'
      + (a.acknowledged ? '' : '<button class="btn-ack" onclick="ackAlert(' + a.id + ')">Dismiss</button>')
      + '</div>';
  }).join('');
}
async function ackAlert(id) {
  await fetch('/api/notifications/' + id + '/ack', {method:'POST'});
  loadAlerts();
}
async function clearAlerts() {
  if (!confirm('Clear all alerts?')) return;
  await fetch('/api/notifications', {method:'DELETE'});
  loadAlerts();
}

// ── Main refresh loop ─────────────────────────────────────────────
var lastTime = '';
async function load() {
  try {
    var logs    = await fetch('/api/logs').then(function(r){ return r.json(); });
    var stResp  = await fetch('/api/state').then(function(r){ return r.json(); });
    var latest  = logs.length ? logs[0] : null;
    var s       = rowToSensor(latest);

    // Always render sensor cards (N/A when no data yet)
    var timeKey = latest ? String(latest.time) : '';
    if (timeKey !== lastTime) {
      document.getElementById('sensor-grid').innerHTML = renderCards(s);
      lastTime = timeKey;
    }

    // Device status bar
    var dot    = document.getElementById('db-dot');
    var dbStat = document.getElementById('db-status');
    if (latest) {
      var age = (Date.now() - new Date(latest.time).getTime()) / 1000;
      var online = age < 60;
      dot.className    = online ? 'db-dot' : 'db-dot offline';
      dbStat.textContent = online ? 'Online' : 'Last seen ' + ago(latest.time);
      dbStat.style.color = online ? '#3dffa0' : '#f5a524';
    } else {
      dot.className = 'db-dot offline';
      dbStat.textContent = 'Waiting for Arduino...';
      dbStat.style.color = '#4a6080';
    }
    document.getElementById('s-device').textContent = latest ? latest.device : '&#8212;';
    document.getElementById('s-last').textContent   = latest ? ago(latest.time) : '&#8212;';
    document.getElementById('s-total').textContent  = String(logs.length);

    // History & controls
    document.getElementById('hist-body').innerHTML = renderHistory(logs);
    setCtrlState('light',  stResp.light);
    setCtrlState('pump',   stResp.pump);
    setCtrlState('buzzer', stResp.buzzer);

    loadAlerts();
  } catch(e) { console.error('load error:', e); }
}
async function clearLogs() {
  if (!confirm('Delete all logs?')) return;
  await fetch('/api/logs', {method:'DELETE'});
  lastTime = ''; load();
}
function forceRefresh() { lastTime = ''; load(); }

window.addEventListener('load', function() { positionBar(); renderCards(rowToSensor(null)); load(); setInterval(load, 5000); });
window.addEventListener('resize', positionBar);
</script>
</body>
</html>`;

app.get('/', (req, res) => { res.setHeader('Content-Type','text/html'); res.end(HTML); });

// ── Start ─────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Server on port', PORT);
    setInterval(checkNotifications, 5 * 60 * 1000);
    checkNotifications();
  });
}).catch(e => { console.error('[DB INIT FAILED]', e.message); process.exit(1); });
