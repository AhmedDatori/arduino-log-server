'use strict';

const express = require('express');
const path    = require('path');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Database ──────────────────────────────────────────────────────
const pool = new Pool({
  host:                    'db.hzxsjjoyijoohtumxfuc.supabase.co',
  port:                    5432,
  database:                'postgres',
  user:                    'postgres',
  password:                'T^y7!NvX89Dn&tJCw&wm',
  ssl:                     { rejectUnauthorized: false },
  max:                     10,
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 5_000,
});

// ─── AI ────────────────────────────────────────────────────────────
const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ─── Middleware ────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'dist')));

// ─── DB Helpers ────────────────────────────────────────────────────
async function getActuatorState() {
  const { rows } = await pool.query(
    'SELECT light, pump, buzzer FROM actuator_state WHERE id = 1'
  );
  return rows[0] ?? { light: false, pump: false, buzzer: false };
}

function parseSensorMessage(msg) {
  const kv = {};
  (msg || '').split(',').forEach(pair => {
    const i = pair.indexOf(':');
    if (i > 0) kv[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  });
  const num = k => (kv[k] !== undefined && kv[k] !== 'N/A') ? parseFloat(kv[k]) : null;
  return { water: num('water'), soil: num('soil'), light: num('light'), temp: num('temp'), hum: num('hum') };
}

// ─── DB Init ───────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id      SERIAL      PRIMARY KEY,
      device  TEXT        NOT NULL DEFAULT 'ESP-01',
      ip      TEXT        NOT NULL DEFAULT '',
      water   INT,
      soil    INT,
      light   INT,
      temp    FLOAT,
      hum     FLOAT,
      time    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Migrate existing tables with old 'message TEXT' column
  const migrations = [
    ['water', 'INT'], ['soil', 'INT'], ['light', 'INT'],
    ['temp', 'FLOAT'], ['hum', 'FLOAT'],
  ];
  for (const [col, type] of migrations) {
    await pool.query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS ${col} ${type}`).catch(() => {});
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS actuator_state (
      id         INT         PRIMARY KEY DEFAULT 1,
      light      BOOLEAN     NOT NULL DEFAULT FALSE,
      pump       BOOLEAN     NOT NULL DEFAULT FALSE,
      buzzer     BOOLEAN     NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`INSERT INTO actuator_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id         SERIAL      PRIMARY KEY,
      role       TEXT        NOT NULL,
      content    TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id           SERIAL      PRIMARY KEY,
      type         TEXT        NOT NULL,
      message      TEXT        NOT NULL,
      severity     TEXT        NOT NULL DEFAULT 'info',
      acknowledged BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log('[DB] All tables ready');
}

// ─── Arduino POST /log ─────────────────────────────────────────────
app.post('/log', async (req, res) => {
  try {
    const msg    = String(req.body.message || '');
    const device = String(req.body.device  || 'ESP-01');
    const ip     = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const s      = parseSensorMessage(msg);

    const { rows } = await pool.query(
      `INSERT INTO logs (device, ip, water, soil, light, temp, hum)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [device, ip, s.water, s.soil, s.light, s.temp, s.hum]
    );

    const state = await getActuatorState();
    console.log(`[LOG] #${rows[0].id} | ${device} | water:${s.water} soil:${s.soil}% light:${s.light}% temp:${s.temp}C hum:${s.hum}%`);

    res.json({
      success: true,
      id:      rows[0].id,
      light:   state.light  ? 1 : 0,
      pump:    state.pump   ? 1 : 0,
      buzzer:  state.buzzer ? 1 : 0,
    });
  } catch (err) {
    console.error('[POST /log]', err.message);
    res.status(500).json({ success: false, light: 0, pump: 0, buzzer: 0 });
  }
});

// ─── Logs API ──────────────────────────────────────────────────────
app.get('/api/logs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, device, ip, water, soil, light, temp, hum, time FROM logs ORDER BY time DESC LIMIT 200'
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/logs]', err.message);
    res.status(500).json([]);
  }
});

app.delete('/api/logs', async (req, res) => {
  try {
    await pool.query('TRUNCATE logs RESTART IDENTITY');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ─── Actuator API ──────────────────────────────────────────────────
app.get('/api/state', async (req, res) => {
  try {
    res.json(await getActuatorState());
  } catch (err) {
    res.status(500).json({ light: false, pump: false, buzzer: false });
  }
});

app.post('/api/control', async (req, res) => {
  try {
    const { device, value } = req.body;
    if (!['light', 'pump', 'buzzer'].includes(device)) {
      return res.status(400).json({ error: 'Invalid device' });
    }
    const on = value === '1' || value === 1 || value === true || value === 'true';
    await pool.query(
      `UPDATE actuator_state SET ${device} = $1, updated_at = NOW() WHERE id = 1`,
      [on]
    );
    const state = await getActuatorState();
    console.log(`[CTRL] ${device.toUpperCase()} -> ${on ? 'ON' : 'OFF'}`);
    res.json({ success: true, state });
  } catch (err) {
    console.error('[POST /api/control]', err.message);
    res.status(500).json({ success: false });
  }
});

// ─── Chat API ──────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const message = String(req.body.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Empty message' });

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        error: 'AI not configured. Add GEMINI_API_KEY in Hostinger environment variables.',
      });
    }

    const [logsResult, state, historyResult] = await Promise.all([
      pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 5'),
      getActuatorState(),
      pool.query('SELECT role, content FROM conversations ORDER BY created_at DESC LIMIT 30'),
    ]);

    const latest       = logsResult.rows[0];
    const systemPrompt = buildSystemPrompt(latest, state);

    // Gemini expects strictly alternating user/model roles
    const history = [];
    let lastRole = null;
    for (const row of [...historyResult.rows].reverse()) {
      const role = row.role === 'assistant' ? 'model' : 'user';
      if (role !== lastRole) {
        history.push({ role, parts: [{ text: row.content }] });
        lastRole = role;
      }
    }

    await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', ['user', message]);

    const model  = genai.getGenerativeModel({ model: 'gemini-2.0-flash-lite', systemInstruction: systemPrompt });
    const chat   = model.startChat({ history, generationConfig: { maxOutputTokens: 512 } });
    const result = await chat.sendMessage(message);
    const reply  = result.response.text();

    await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', ['assistant', reply]);
    res.json({ response: reply });
  } catch (err) {
    console.error('[POST /api/chat]', err.message);
    res.status(500).json({ error: `AI error: ${err.message}` });
  }
});

function buildSystemPrompt(latest, state) {
  let p = 'You are a concise AI assistant for an Arduino IoT plant monitoring system.\n\n';
  if (latest) {
    p += 'Latest sensor reading:\n';
    p += `  Water level : ${latest.water ?? 'N/A'} (raw 0-1023, <200=empty)\n`;
    p += `  Soil moisture: ${latest.soil  ?? 'N/A'}%\n`;
    p += `  Light        : ${latest.light ?? 'N/A'}%\n`;
    p += `  Temperature  : ${latest.temp  ?? 'N/A'}C\n`;
    p += `  Humidity     : ${latest.hum   ?? 'N/A'}%\n`;
    p += `  Recorded at  : ${latest.time}\n\n`;
  }
  p += `Actuators: Light=${state.light?'ON':'OFF'}, Pump=${state.pump?'ON':'OFF'}, Buzzer=${state.buzzer?'ON':'OFF'}\n\n`;
  p += 'Be brief and practical. Focus on plant health.';
  return p;
}

// ─── Conversations API ─────────────────────────────────────────────
app.get('/api/conversations', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM conversations ORDER BY created_at ASC LIMIT 100');
    res.json(rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

app.delete('/api/conversations', async (req, res) => {
  try {
    await pool.query('TRUNCATE conversations RESTART IDENTITY');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ─── Notifications API ─────────────────────────────────────────────
app.get('/api/notifications', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50');
    res.json(rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

app.post('/api/notifications/:id/ack', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET acknowledged = TRUE WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/notifications', async (req, res) => {
  try {
    await pool.query('TRUNCATE notifications RESTART IDENTITY');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ─── Notification Checker (every 5 minutes) ────────────────────────
const lastNotified = new Map();
const COOLDOWN_MS  = 5 * 60 * 1000;

async function checkNotifications() {
  try {
    const { rows } = await pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 1');
    if (!rows.length) return;

    const log    = rows[0];
    const now    = Date.now();
    const ageMs  = now - new Date(log.time).getTime();
    const state  = await getActuatorState();

    const notify = async (type, message, severity) => {
      if ((now - (lastNotified.get(type) ?? 0)) >= COOLDOWN_MS) {
        await pool.query(
          'INSERT INTO notifications (type, message, severity) VALUES ($1, $2, $3)',
          [type, message, severity]
        );
        lastNotified.set(type, now);
        console.log(`[ALERT] ${severity.toUpperCase()}: ${message}`);
      }
    };

    if (ageMs > 15 * 60 * 1000) await notify('offline', 'Arduino offline — no data in 15+ min', 'danger');

    if (log.water !== null) {
      if (log.water < 200)      await notify('water_empty', `Water EMPTY (${log.water})`, 'danger');
      else if (log.water < 500) await notify('water_low',   `Water LOW (${log.water})`,   'warning');
    }
    if (log.soil  !== null && log.soil  < 30 && !state.pump)
      await notify('soil_dry',   `Soil DRY (${log.soil}%) — pump is OFF`,        'warning');
    if (log.light !== null && log.light < 20 && !state.light)
      await notify('light_dark', `Light DARK (${log.light}%) — grow light OFF`,  'warning');
    if (log.temp  !== null) {
      if (log.temp > 35) await notify('temp_high', `Temperature HIGH: ${log.temp}C`, 'danger');
      if (log.temp < 10) await notify('temp_cold', `Temperature LOW: ${log.temp}C`,  'warning');
    }
    if (log.hum !== null && log.hum > 80)
      await notify('hum_high', `Humidity HIGH: ${log.hum}%`, 'warning');

  } catch (err) {
    console.error('[checkNotifications]', err.message);
  }
}

// ─── Serve React app (catch-all) ───────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─── Start ─────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Plant Monitor running on port ${PORT}`);
      setInterval(checkNotifications, COOLDOWN_MS);
      checkNotifications();
    });
  })
  .catch(err => {
    console.error('[FATAL] DB init failed:', err.message);
    process.exit(1);
  });
