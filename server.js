'use strict';

const express = require('express');
const path    = require('path');
const { Pool } = require('pg');
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

// ─── Middleware ────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'dist')));

// ─── DB Helpers ────────────────────────────────────────────────────
async function getActuatorState() {
  const { rows } = await pool.query(
    'SELECT light, pump, buzzer, pump_off_at FROM actuator_state WHERE id = 1'
  );
  if (!rows.length) return { light: false, pump: false, buzzer: false };
  let s = rows[0];
  // Auto-expire pump timer (reliable even after server restart)
  if (s.pump && s.pump_off_at && new Date(s.pump_off_at) <= new Date()) {
    await pool.query('UPDATE actuator_state SET pump = FALSE, pump_off_at = NULL WHERE id = 1');
    s = { ...s, pump: false, pump_off_at: null };
    console.log('[PUMP] Timer expired — pump OFF');
  }
  return { light: s.light, pump: s.pump, buzzer: s.buzzer };
}

async function getActivePlant() {
  const { rows } = await pool.query(
    'SELECT * FROM plant_profiles WHERE is_active = TRUE LIMIT 1'
  );
  return rows[0] ?? null;
}

// ─── Mode helpers ─────────────────────────────────────────────────
async function getMode() {
  const { rows } = await pool.query('SELECT mode FROM settings WHERE id = 1');
  return rows[0]?.mode ?? 'manual';
}

// ─── Autopilot: pump timer ─────────────────────────────────────────
let pumpTimer = null;

async function schedulePumpOff(seconds) {
  const clampedSec = Math.min(Math.max(Number(seconds) || 5, 1), 30); // 1–30s
  const offAt = new Date(Date.now() + clampedSec * 1000);
  await pool.query('UPDATE actuator_state SET pump = TRUE, pump_off_at = $1, updated_at = NOW() WHERE id = 1', [offAt]);
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = setTimeout(async () => {
    await pool.query('UPDATE actuator_state SET pump = FALSE, pump_off_at = NULL, updated_at = NOW() WHERE id = 1');
    console.log(`[PUMP] Auto-off after ${clampedSec}s`);
    pumpTimer = null;
  }, clampedSec * 1000);
  return clampedSec;
}

async function applyAutopilotActions(actions) {
  const { pump, pump_duration_seconds, light, buzzer } = actions;
  if (light  !== null && light  !== undefined) await pool.query('UPDATE actuator_state SET light  = $1, updated_at = NOW() WHERE id = 1', [!!light]);
  if (buzzer !== null && buzzer !== undefined) await pool.query('UPDATE actuator_state SET buzzer = $1, updated_at = NOW() WHERE id = 1', [!!buzzer]);
  if (pump === true) {
    const sec = await schedulePumpOff(pump_duration_seconds ?? 8);
    console.log(`[AUTOPILOT] Pump ON for ${sec}s`);
  } else if (pump === false) {
    if (pumpTimer) { clearTimeout(pumpTimer); pumpTimer = null; }
    await pool.query('UPDATE actuator_state SET pump = FALSE, pump_off_at = NULL, updated_at = NOW() WHERE id = 1');
  }
}

// ─── Autopilot: rules engine ───────────────────────────────────────
async function runRulesEngine(log, state, plant) {
  const soilMin  = plant?.soil_min  ?? 30;
  const lightMin = plant?.light_min ?? 30;
  const tempMax  = plant?.temp_max  ?? 35;
  const tempMin  = plant?.temp_min  ?? 10;
  const actions  = { pump: null, pump_duration_seconds: 0, light: null, buzzer: null };
  const reasons  = [];

  // Soil → pump (only if water not empty)
  const waterOk = log.water === null || log.water >= 200;
  if (log.soil !== null && waterOk) {
    if (log.soil < soilMin * 0.6 && !state.pump) {
      actions.pump = true; actions.pump_duration_seconds = 10;
      reasons.push(`Soil critically dry at ${log.soil}% (ideal ≥${soilMin}%) — running pump 10s`);
    } else if (log.soil < soilMin && !state.pump) {
      actions.pump = true; actions.pump_duration_seconds = 5;
      reasons.push(`Soil dry at ${log.soil}% (ideal ≥${soilMin}%) — running pump 5s`);
    }
  }
  if (log.water !== null && log.water < 200 && state.pump) {
    actions.pump = false;
    reasons.push(`Water tank empty (${log.water}) — pump forced OFF`);
  }

  // Light → grow light
  if (log.light !== null) {
    if (log.light < lightMin && !state.light) {
      actions.light = true;
      reasons.push(`Light low at ${log.light}% (ideal ≥${lightMin}%) — grow light ON`);
    } else if (log.light >= lightMin + 10 && state.light) {
      actions.light = false;
      reasons.push(`Natural light sufficient at ${log.light}% — grow light OFF`);
    }
  }

  // Temperature → buzzer alert
  if (log.temp !== null) {
    if (log.temp > tempMax && !state.buzzer) {
      actions.buzzer = true;
      reasons.push(`Temperature HIGH at ${log.temp}°C (max ${tempMax}°C) — alert`);
    } else if (log.temp < tempMin && !state.buzzer) {
      actions.buzzer = true;
      reasons.push(`Temperature LOW at ${log.temp}°C (min ${tempMin}°C) — alert`);
    } else if (log.temp >= tempMin && log.temp <= tempMax && state.buzzer) {
      actions.buzzer = false;
      reasons.push(`Temperature normal — buzzer OFF`);
    }
  }

  const analysis = reasons.length
    ? reasons.join('. ')
    : 'All conditions within acceptable range. No actions needed.';

  return {
    analysis,
    reasoning: `Rule-based checks against ${plant ? plant.name : 'default'} thresholds.`,
    risk_level: reasons.length > 1 ? 'high' : reasons.length === 1 ? 'medium' : 'low',
    actions,
  };
}

// ─── Autopilot: AI engine ──────────────────────────────────────────
async function runAIEngine(log, state, plant) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const plantCtx = plant
    ? `Plant: ${plant.emoji} ${plant.name}\nIdeal: Soil ${plant.soil_min}–${plant.soil_max}%, Temp ${plant.temp_min}–${plant.temp_max}°C, Humidity ${plant.hum_min}–${plant.hum_max}%, Light ${plant.light_min}–${plant.light_max}%`
    : 'No plant profile selected — use general plant care guidelines.';

  const prompt = `You are an AI greenhouse autopilot for an Arduino-based plant monitoring system.

${plantCtx}

Live sensor readings:
- Soil moisture: ${log.soil ?? 'N/A'}%
- Water level: ${log.water ?? 'N/A'} raw (0-1023; <200=EMPTY, <500=low, <800=medium, ≥800=full)
- Light: ${log.light ?? 'N/A'}%
- Temperature: ${log.temp ?? 'N/A'}°C
- Humidity: ${log.hum ?? 'N/A'}%

Current actuator state: Pump=${state.pump ? 'ON' : 'OFF'}, Grow light=${state.light ? 'ON' : 'OFF'}, Buzzer=${state.buzzer ? 'ON' : 'OFF'}

SAFETY RULES (strictly enforce):
1. NEVER run pump if water level < 200 (tank empty)
2. pump_duration_seconds must be between 1 and 30
3. Only activate buzzer for critical temperature emergencies
4. Use null for any actuator you do NOT want to change

Respond ONLY with valid JSON, no markdown:
{
  "analysis": "<2-3 sentences assessing current plant conditions>",
  "reasoning": "<brief explanation of your decisions>",
  "risk_level": "<'low'|'medium'|'high'|'critical'>",
  "actions": {
    "pump": <true|false|null>,
    "pump_duration_seconds": <integer 1-30, only required if pump is true>,
    "light": <true|false|null>,
    "buzzer": <true|false|null>
  }
}`;

  const res  = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.1 },
      }),
    }
  );
  const data  = await res.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON from Gemini autopilot');

  const decision = JSON.parse(match[0]);
  // Safety override: block pump if water empty
  if (log.water !== null && log.water < 200 && decision.actions?.pump === true) {
    decision.actions.pump = false;
    decision.analysis += ' (Pump blocked: water tank empty.)';
  }
  return decision;
}

// ─── Autopilot: main dispatcher with cooldown ──────────────────────
const lastRun = { rules: 0, ai: 0 };
const COOLDOWN = { rules: 2 * 60 * 1000, ai: 10 * 60 * 1000 }; // 2min / 10min

async function runAutopilot(log) {
  try {
    const mode = await getMode();
    if (mode === 'manual') return;

    const now = Date.now();
    if (now - lastRun[mode] < COOLDOWN[mode]) return;
    lastRun[mode] = now;

    const [state, plant] = await Promise.all([getActuatorState(), getActivePlant()]);
    let decision;

    if (mode === 'rules') decision = await runRulesEngine(log, state, plant);
    else                  decision = await runAIEngine(log, state, plant);

    // Apply only non-null actions
    const hasAction = Object.values(decision.actions).some(v => v !== null);
    if (hasAction) await applyAutopilotActions(decision.actions);

    await pool.query(
      'INSERT INTO autopilot_log (mode, analysis, reasoning, risk_level, actions) VALUES ($1,$2,$3,$4,$5)',
      [mode, decision.analysis, decision.reasoning, decision.risk_level, JSON.stringify(decision.actions)]
    );
    console.log(`[AUTOPILOT:${mode.toUpperCase()}] ${decision.risk_level} — ${decision.analysis.slice(0, 80)}`);
  } catch (err) {
    console.error('[AUTOPILOT error]', err.message);
  }
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id           SERIAL      PRIMARY KEY,
      title        TEXT        NOT NULL,
      status       TEXT        NOT NULL DEFAULT 'fair',
      summary      TEXT,
      soil         TEXT,
      water        TEXT,
      light        TEXT,
      temp         TEXT,
      hum          TEXT,
      main_problem TEXT,
      action       TEXT,
      period_start TIMESTAMPTZ,
      period_end   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS health_scores (
      id         SERIAL      PRIMARY KEY,
      score      INT         NOT NULL,
      status     TEXT        NOT NULL,
      advice     TEXT,
      breakdown  JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS plant_profiles (
      id         SERIAL      PRIMARY KEY,
      name       TEXT        NOT NULL,
      emoji      TEXT        NOT NULL DEFAULT '🌱',
      soil_min   INT         NOT NULL DEFAULT 30,
      soil_max   INT         NOT NULL DEFAULT 70,
      temp_min   FLOAT       NOT NULL DEFAULT 15,
      temp_max   FLOAT       NOT NULL DEFAULT 30,
      hum_min    INT         NOT NULL DEFAULT 40,
      hum_max    INT         NOT NULL DEFAULT 70,
      light_min  INT         NOT NULL DEFAULT 30,
      light_max  INT         NOT NULL DEFAULT 80,
      notes      TEXT,
      is_preset  BOOLEAN     NOT NULL DEFAULT FALSE,
      is_active  BOOLEAN     NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Pump timer column (migration for existing installs)
  await pool.query('ALTER TABLE actuator_state ADD COLUMN IF NOT EXISTS pump_off_at TIMESTAMPTZ').catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id         INT         PRIMARY KEY DEFAULT 1,
      mode       TEXT        NOT NULL DEFAULT 'manual',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS autopilot_log (
      id          SERIAL      PRIMARY KEY,
      mode        TEXT        NOT NULL,
      analysis    TEXT,
      reasoning   TEXT,
      risk_level  TEXT        NOT NULL DEFAULT 'low',
      actions     JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Seed preset plants only if none exist yet
  const { rows: presetCheck } = await pool.query(
    'SELECT COUNT(*) FROM plant_profiles WHERE is_preset = TRUE'
  );
  if (Number(presetCheck[0].count) === 0) {
    await pool.query(`
      INSERT INTO plant_profiles (name, emoji, soil_min, soil_max, temp_min, temp_max, hum_min, hum_max, light_min, light_max, notes, is_preset, is_active) VALUES
        ('Tomato',    '🍅', 50, 70, 20, 28, 50, 70, 60, 90,  'Needs consistent moisture and warmth.',        TRUE, TRUE),
        ('Mint',      '🌿', 60, 80, 15, 25, 50, 70, 30, 60,  'Prefers shade and moist soil.',                TRUE, FALSE),
        ('Basil',     '🌱', 40, 60, 18, 27, 40, 60, 50, 80,  'Sensitive to cold and overwatering.',          TRUE, FALSE),
        ('Lettuce',   '🥬', 60, 80, 15, 22, 50, 70, 30, 60,  'Cool weather crop, needs consistent moisture.',TRUE, FALSE),
        ('Cactus',    '🌵', 10, 30, 20, 35, 10, 30, 70, 100, 'Minimal water, loves heat and bright light.',  TRUE, FALSE),
        ('Rose',      '🌹', 40, 65, 15, 27, 40, 60, 60, 90,  'Well-drained soil, regular watering.',         TRUE, FALSE),
        ('Sunflower', '🌻', 40, 65, 20, 30, 40, 65, 70, 100, 'Full sun, moderate water.',                    TRUE, FALSE)
    `);
    console.log('[DB] Preset plants seeded');
  }

  console.log('[DB] All tables ready');
}

// ─── AI Health Score ───────────────────────────────────────────────
async function computeHealthScore() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const [logsResult, state, plant] = await Promise.all([
    pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 1'),
    getActuatorState(),
    getActivePlant(),
  ]);

  const latest = logsResult.rows[0];
  if (!latest) return null;

  const plantCtx = plant
    ? `\nPlant type: ${plant.emoji} ${plant.name}\nIdeal ranges — Soil: ${plant.soil_min}–${plant.soil_max}%, Temp: ${plant.temp_min}–${plant.temp_max}°C, Humidity: ${plant.hum_min}–${plant.hum_max}%, Light: ${plant.light_min}–${plant.light_max}%\n`
    : '';

  const prompt = `You are evaluating the health of a potted plant using IoT sensor data.
${plantCtx}
Current readings:
- Soil moisture: ${latest.soil ?? 'N/A'}%
- Water level: ${latest.water ?? 'N/A'} raw (0-1023; <200=empty, <500=low, <800=medium, ≥800=full)
- Light: ${latest.light ?? 'N/A'}%
- Temperature: ${latest.temp ?? 'N/A'}°C
- Humidity: ${latest.hum ?? 'N/A'}%
- Grow light: ${state.light ? 'ON' : 'OFF'}, Pump: ${state.pump ? 'ON' : 'OFF'}

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "score": <integer 0-100>,
  "status": "<max 5 words, e.g. 'Healthy', 'Critical: needs water'>",
  "advice": "<one practical sentence>",
  "breakdown": {
    "soil":  { "score": <0-20>, "note": "<short>" },
    "water": { "score": <0-20>, "note": "<short>" },
    "light": { "score": <0-20>, "note": "<short>" },
    "temp":  { "score": <0-20>, "note": "<short>" },
    "hum":   { "score": <0-20>, "note": "<short>" }
  }
}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
      }),
    }
  );

  const data = await geminiRes.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in Gemini response');

  const result = JSON.parse(match[0]);
  await pool.query(
    'INSERT INTO health_scores (score, status, advice, breakdown) VALUES ($1, $2, $3, $4)',
    [result.score, result.status, result.advice, JSON.stringify(result.breakdown)]
  );
  console.log(`[HEALTH] Score: ${result.score}/100 — ${result.status}`);
  return result;
}

app.get('/api/health', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM health_scores ORDER BY created_at DESC LIMIT 1'
    );
    res.json(rows[0] ?? null);
  } catch (err) {
    console.error('[GET /api/health]', err.message);
    res.status(500).json(null);
  }
});

app.post('/api/health/refresh', async (req, res) => {
  try {
    const result = await computeHealthScore();
    if (!result) return res.status(503).json({ error: 'No data or API key missing' });
    res.json(result);
  } catch (err) {
    console.error('[POST /api/health/refresh]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Daily Report ─────────────────────────────────────────────────
async function generateDailyReport() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const now   = new Date();
  const start = new Date(now - 24 * 60 * 60 * 1000);

  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                          AS readings,
      ROUND(AVG(soil)::numeric,1)       AS avg_soil,
      MIN(soil)                         AS min_soil,
      MAX(soil)                         AS max_soil,
      ROUND(AVG(water)::numeric,0)      AS avg_water,
      MIN(water)                        AS min_water,
      MAX(water)                        AS max_water,
      ROUND(AVG(light)::numeric,1)      AS avg_light,
      MIN(light)                        AS min_light,
      MAX(light)                        AS max_light,
      ROUND(AVG(temp)::numeric,1)       AS avg_temp,
      MIN(temp)                         AS min_temp,
      MAX(temp)                         AS max_temp,
      ROUND(AVG(hum)::numeric,1)        AS avg_hum,
      MIN(hum)                          AS min_hum,
      MAX(hum)                          AS max_hum
    FROM logs WHERE time >= $1
  `, [start]);

  const d = rows[0];
  if (!d || Number(d.readings) === 0) return null;

  const plant   = await getActivePlant();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const plantCtx = plant
    ? `Plant type: ${plant.emoji} ${plant.name}\nIdeal ranges — Soil: ${plant.soil_min}–${plant.soil_max}%, Temp: ${plant.temp_min}–${plant.temp_max}°C, Humidity: ${plant.hum_min}–${plant.hum_max}%, Light: ${plant.light_min}–${plant.light_max}%\n\n`
    : '';

  const prompt = `You are writing a daily greenhouse report for a plant owner.

${plantCtx}Data from the last 24 hours (${d.readings} readings):
- Soil moisture:  avg ${d.avg_soil}%,  min ${d.min_soil}%,  max ${d.max_soil}%
- Water level:    avg ${d.avg_water} raw (0-1023; <200=empty,<500=low,<800=medium,≥800=full), min ${d.min_water}, max ${d.max_water}
- Light:          avg ${d.avg_light}%, min ${d.min_light}%, max ${d.max_light}%
- Temperature:    avg ${d.avg_temp}°C, min ${d.min_temp}°C, max ${d.max_temp}°C
- Humidity:       avg ${d.avg_hum}%,  min ${d.min_hum}%,  max ${d.max_hum}%

Write in a clear, friendly tone for a non-technical plant owner. Compare readings against the ideal ranges${plant ? ` for ${plant.name}` : ''} and mention when conditions are outside the ideal range.
Respond ONLY with valid JSON, no markdown:
{
  "title": "Daily Report — ${dateStr}",
  "status": "<'good'|'fair'|'poor'>",
  "summary": "<2-3 sentences overview of today>",
  "soil":  "<one clear sentence about soil moisture>",
  "water": "<one clear sentence about water level>",
  "light": "<one clear sentence about light>",
  "temp":  "<one clear sentence about temperature>",
  "hum":   "<one clear sentence about humidity>",
  "main_problem": "<the biggest issue today, or 'No major issues — plant is in good condition.'>",
  "action": "<specific, practical recommended action for the owner>"
}`;

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 700, temperature: 0.4 },
      }),
    }
  );

  const data  = await geminiRes.json();
  const text  = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in Gemini response');

  const r = JSON.parse(match[0]);
  await pool.query(
    `INSERT INTO reports (title, status, summary, soil, water, light, temp, hum, main_problem, action, period_start, period_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [r.title, r.status, r.summary, r.soil, r.water, r.light, r.temp, r.hum, r.main_problem, r.action, start, now]
  );
  console.log(`[REPORT] Generated: ${r.title} — ${r.status}`);
  return r;
}

app.get('/api/reports', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM reports ORDER BY created_at DESC LIMIT 30'
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/reports]', err.message);
    res.status(500).json([]);
  }
});

app.post('/api/reports/generate', async (req, res) => {
  try {
    const result = await generateDailyReport();
    if (!result) return res.status(503).json({ error: 'No data or API key missing' });
    res.json(result);
  } catch (err) {
    console.error('[POST /api/reports/generate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

    // Fire autopilot without blocking the response
    runAutopilot(s).catch(e => console.error('[AUTOPILOT]', e.message));

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

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        error: 'AI not configured — add GEMINI_API_KEY in Hostinger → Node.js → Environment Variables.',
      });
    }

    const [logsResult, state, historyResult, plant] = await Promise.all([
      pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 5'),
      getActuatorState(),
      pool.query('SELECT role, content FROM conversations ORDER BY created_at DESC LIMIT 30'),
      getActivePlant(),
    ]);

    const latest       = logsResult.rows[0];
    const systemPrompt = buildSystemPrompt(latest, state, plant);

    // Build strictly alternating user/model history for Gemini
    const history = [];
    let lastRole = null;
    for (const row of [...historyResult.rows].reverse()) {
      const role = row.role === 'assistant' ? 'model' : 'user';
      if (role !== lastRole) {
        history.push({ role, parts: [{ text: row.content }] });
        lastRole = role;
      }
    }

    // Save user message before calling Gemini
    await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', ['user', message]);

    // Call Gemini REST API directly — no SDK dependency
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [
            ...history,
            { role: 'user', parts: [{ text: message }] },
          ],
          generationConfig: { maxOutputTokens: 512 },
        }),
      }
    );

    const data  = await geminiRes.json();
    if (!geminiRes.ok) {
      const errMsg = data?.error?.message || geminiRes.statusText;
      console.error('[Gemini API error]', geminiRes.status, errMsg);
      return res.status(502).json({ error: `Gemini error: ${errMsg}` });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from AI.';

    await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', ['assistant', reply]);
    res.json({ response: reply });
  } catch (err) {
    console.error('[POST /api/chat]', err.message);
    res.status(500).json({ error: `Chat error: ${err.message}` });
  }
});

function buildSystemPrompt(latest, state, plant) {
  let p = 'You are a concise AI assistant for an Arduino IoT plant monitoring system.\n\n';

  if (plant) {
    p += `Currently monitoring: ${plant.emoji} ${plant.name}\n`;
    p += `Ideal conditions for ${plant.name}:\n`;
    p += `  Soil moisture: ${plant.soil_min}–${plant.soil_max}%\n`;
    p += `  Temperature:   ${plant.temp_min}–${plant.temp_max}°C\n`;
    p += `  Humidity:      ${plant.hum_min}–${plant.hum_max}%\n`;
    p += `  Light:         ${plant.light_min}–${plant.light_max}%\n`;
    if (plant.notes) p += `  Notes: ${plant.notes}\n`;
    p += '\n';
  }

  if (latest) {
    p += 'Current sensor readings:\n';
    p += `  Water level:   ${latest.water ?? 'N/A'} (raw 0-1023, <200=empty)\n`;
    p += `  Soil moisture: ${latest.soil  ?? 'N/A'}%\n`;
    p += `  Light:         ${latest.light ?? 'N/A'}%\n`;
    p += `  Temperature:   ${latest.temp  ?? 'N/A'}°C\n`;
    p += `  Humidity:      ${latest.hum   ?? 'N/A'}%\n`;
    p += `  Recorded at:   ${latest.time}\n\n`;
  }

  p += `Actuators: Light=${state.light?'ON':'OFF'}, Pump=${state.pump?'ON':'OFF'}, Buzzer=${state.buzzer?'ON':'OFF'}\n\n`;
  p += 'Be brief and practical.';
  if (plant) p += ` Always compare readings against the ideal ranges for ${plant.name} and give plant-specific advice.`;
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

// ─── Plant Profiles API ────────────────────────────────────────────
app.get('/api/plants', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM plant_profiles ORDER BY is_preset DESC, id ASC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json([]);
  }
});

app.post('/api/plants/:id/select', async (req, res) => {
  try {
    await pool.query('UPDATE plant_profiles SET is_active = FALSE');
    await pool.query('UPDATE plant_profiles SET is_active = TRUE WHERE id = $1', [req.params.id]);
    const { rows } = await pool.query('SELECT * FROM plant_profiles WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    console.log(`[PLANT] Active plant: ${rows[0].emoji} ${rows[0].name}`);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plants', async (req, res) => {
  try {
    const { name, emoji, soil_min, soil_max, temp_min, temp_max, hum_min, hum_max, light_min, light_max, notes } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const { rows } = await pool.query(
      `INSERT INTO plant_profiles (name, emoji, soil_min, soil_max, temp_min, temp_max, hum_min, hum_max, light_min, light_max, notes, is_preset)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE) RETURNING *`,
      [name.trim(), emoji || '🌱',
       Number(soil_min)||30, Number(soil_max)||70,
       Number(temp_min)||15, Number(temp_max)||30,
       Number(hum_min)||40,  Number(hum_max)||70,
       Number(light_min)||30, Number(light_max)||80,
       notes?.trim() || null]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/plants/:id', async (req, res) => {
  try {
    const { rows: check } = await pool.query('SELECT is_preset FROM plant_profiles WHERE id = $1', [req.params.id]);
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    if (check[0].is_preset) return res.status(403).json({ error: 'Preset plants cannot be edited' });
    const { name, emoji, soil_min, soil_max, temp_min, temp_max, hum_min, hum_max, light_min, light_max, notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE plant_profiles SET name=$1, emoji=$2, soil_min=$3, soil_max=$4, temp_min=$5, temp_max=$6,
       hum_min=$7, hum_max=$8, light_min=$9, light_max=$10, notes=$11 WHERE id=$12 RETURNING *`,
      [name.trim(), emoji || '🌱',
       Number(soil_min), Number(soil_max),
       Number(temp_min), Number(temp_max),
       Number(hum_min),  Number(hum_max),
       Number(light_min), Number(light_max),
       notes?.trim() || null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/plants/:id', async (req, res) => {
  try {
    const { rows: check } = await pool.query('SELECT is_preset FROM plant_profiles WHERE id = $1', [req.params.id]);
    if (!check.length) return res.status(404).json({ error: 'Not found' });
    if (check[0].is_preset) return res.status(403).json({ error: 'Preset plants cannot be deleted' });
    await pool.query('DELETE FROM plant_profiles WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Mode API ──────────────────────────────────────────────────────
app.get('/api/mode', async (req, res) => {
  try {
    const mode = await getMode();
    res.json({ mode });
  } catch (err) {
    console.error('[GET /api/mode]', err.message);
    res.status(500).json({ mode: 'manual' });
  }
});

app.post('/api/mode', async (req, res) => {
  try {
    const { mode } = req.body;
    if (!['manual', 'rules', 'ai'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Use manual, rules, or ai.' });
    }
    await pool.query('UPDATE settings SET mode = $1, updated_at = NOW() WHERE id = 1', [mode]);
    console.log(`[MODE] Switched to: ${mode}`);
    res.json({ mode });
  } catch (err) {
    console.error('[POST /api/mode]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Autopilot Log API ─────────────────────────────────────────────
app.get('/api/autopilot/log', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM autopilot_log ORDER BY created_at DESC LIMIT 10'
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/autopilot/log]', err.message);
    res.status(500).json([]);
  }
});

app.post('/api/autopilot/run', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 1');
    if (!rows.length) return res.status(404).json({ error: 'No sensor data yet' });

    const mode = await getMode();
    if (mode === 'manual') return res.status(400).json({ error: 'Switch to Rules or AI mode first' });

    const log = rows[0];
    const s   = { water: log.water, soil: log.soil, light: log.light, temp: log.temp, hum: log.hum };
    const [state, plant] = await Promise.all([getActuatorState(), getActivePlant()]);

    let decision;
    if (mode === 'rules') decision = await runRulesEngine(s, state, plant);
    else                  decision = await runAIEngine(s, state, plant);

    const hasAction = Object.values(decision.actions).some(v => v !== null);
    if (hasAction) await applyAutopilotActions(decision.actions);

    await pool.query(
      'INSERT INTO autopilot_log (mode, analysis, reasoning, risk_level, actions) VALUES ($1,$2,$3,$4,$5)',
      [mode, decision.analysis, decision.reasoning, decision.risk_level, JSON.stringify(decision.actions)]
    );
    console.log(`[AUTOPILOT:MANUAL-RUN] ${decision.risk_level} — ${decision.analysis.slice(0, 80)}`);
    res.json(decision);
  } catch (err) {
    console.error('[POST /api/autopilot/run]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Serve React app (catch-all) ───────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ─── Start ─────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Plant Monitor running on port ${PORT}`);

      // Notifications every 5 minutes
      setInterval(checkNotifications, COOLDOWN_MS);
      checkNotifications();

      // Health score auto-refresh every 1 hour
      const HEALTH_INTERVAL_MS = 60 * 60 * 1000;
      setInterval(() => computeHealthScore().catch(e => console.error('[HEALTH auto]', e.message)), HEALTH_INTERVAL_MS);
      setTimeout(() => computeHealthScore().catch(e => console.error('[HEALTH init]', e.message)), 10_000);

      // Daily report auto-generate every 24 hours
      const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000;
      setInterval(() => generateDailyReport().catch(e => console.error('[REPORT auto]', e.message)), REPORT_INTERVAL_MS);
    });
  })
  .catch(err => {
    console.error('[FATAL] DB init failed:', err.message);
    process.exit(1);
  });
