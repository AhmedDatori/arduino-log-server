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
    'SELECT light, pump, buzzer, fan, led_r, led_g, led_b, pump_off_at FROM actuator_state WHERE id = 1'
  );
  if (!rows.length) return { light: false, pump: false, buzzer: false, fan: false, led_r: 255, led_g: 255, led_b: 0 };
  let s = rows[0];
  if (s.pump && s.pump_off_at && new Date(s.pump_off_at) <= new Date()) {
    await pool.query('UPDATE actuator_state SET pump = FALSE, pump_off_at = NULL WHERE id = 1');
    s = { ...s, pump: false, pump_off_at: null };
    console.log('[PUMP] Timer expired — pump OFF');
  }
  return {
    light: s.light, pump: s.pump, buzzer: s.buzzer, fan: s.fan ?? false,
    led_r: s.led_r ?? 255, led_g: s.led_g ?? 255, led_b: s.led_b ?? 0,
  };
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

// ─── Gemini API helpers ────────────────────────────────────────────
/**
 * Low-level Gemini call. Supports system instructions and multi-turn history.
 * On API error, throws with { geminiError: true } for targeted handling.
 */
async function callGemini(userText, {
  maxOutputTokens = 512,
  temperature     = 0.2,
  systemPrompt    = null,
  history         = [],
  endpoint        = 'unknown',   // label for token usage tracking
} = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const body = {
    contents:         [...history, { role: 'user', parts: [{ text: userText }] }],
    generationConfig: { maxOutputTokens, temperature },
  };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  const res  = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(`Gemini: ${msg}`), { geminiError: true, httpStatus: res.status });
  }

  // ── Log token usage (fire-and-forget, never blocks the response) ──
  const u = data?.usageMetadata;
  if (u) {
    pool.query(
      'INSERT INTO token_usage (endpoint, prompt_tokens, output_tokens, total_tokens) VALUES ($1,$2,$3,$4)',
      [endpoint, u.promptTokenCount ?? 0, u.candidatesTokenCount ?? 0, u.totalTokenCount ?? 0]
    ).catch(e => console.error('[TOKEN_LOG]', e.message));
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Same as callGemini but parses and returns the first JSON object in the response.
 * Use for all AI endpoints that expect structured JSON output.
 */
async function callGeminiJSON(userText, options = {}) {
  const text  = await callGemini(userText, options);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Gemini returned no JSON. Got: ${text.slice(0, 120)}`);
  return JSON.parse(match[0]);
}

// ─── Trend helper (linear regression slope) ───────────────────────
// Returns change-per-reading (negative = falling, positive = rising)
function computeTrend(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  values.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  return den === 0 ? 0 : num / den;
}

// ─── AI feature caches ────────────────────────────────────────────
const predCache     = { data: null, at: 0 };
const rcCache       = { data: null, at: 0 };
const modelCache    = { data: null, at: 0 };
const hwCache       = { data: null, at: 0 };
const fusionCache   = { data: null, at: 0 };
const expSugCache   = { data: null, at: 0 };
const PRED_TTL      = 10 * 60 * 1000;  // 10 min
const RC_TTL        = 15 * 60 * 1000;  // 15 min
const MODEL_TTL     = 60 * 60 * 1000;  // 1 hour
const HW_TTL        = 20 * 60 * 1000;  // 20 min
const FUSION_TTL    =  5 * 60 * 1000;  //  5 min
const EXP_SUG_TTL  =  4 * 60 * 60 * 1000; // 4 hours
let   lastAIExpMs   = 0;

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
  const { pump, pump_duration_seconds, light, buzzer, fan } = actions;
  if (light  !== null && light  !== undefined) await pool.query('UPDATE actuator_state SET light  = $1, updated_at = NOW() WHERE id = 1', [!!light]);
  if (buzzer !== null && buzzer !== undefined) await pool.query('UPDATE actuator_state SET buzzer = $1, updated_at = NOW() WHERE id = 1', [!!buzzer]);
  if (fan    !== null && fan    !== undefined) await pool.query('UPDATE actuator_state SET fan    = $1, updated_at = NOW() WHERE id = 1', [!!fan]);
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
  const actions  = { pump: null, pump_duration_seconds: 0, light: null, buzzer: null, fan: null };
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

  // Temperature → fan + buzzer alert
  // Fan uses 2°C hysteresis: turns ON above tempMax, only turns OFF below tempMax-2
  // This prevents rapid on/off cycling when temperature hovers near the threshold
  if (log.temp !== null) {
    if (log.temp > tempMax) {
      if (!state.fan) {
        actions.fan = true;
        reasons.push(`Temperature HIGH at ${log.temp}°C (max ${tempMax}°C) — fan ON`);
      }
      if (!state.buzzer) {
        actions.buzzer = true;
        reasons.push(`Temperature HIGH at ${log.temp}°C — alert`);
      }
    } else if (log.temp < tempMin && !state.buzzer) {
      actions.buzzer = true;
      reasons.push(`Temperature LOW at ${log.temp}°C (min ${tempMin}°C) — alert`);
    } else if (log.temp >= tempMin && log.temp <= tempMax) {
      if (state.buzzer) { actions.buzzer = false; reasons.push(`Temperature normal — buzzer OFF`); }
      if (state.fan && log.temp <= tempMax - 2) {
        actions.fan = false;
        reasons.push(`Temperature back to safe range — fan OFF`);
      }
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
  const plantCtx = plant
    ? `Plant: ${plant.emoji} ${plant.name}\nIdeal: Soil ${plant.soil_min}–${plant.soil_max}%, Temp ${plant.temp_min}–${plant.temp_max}°C, Humidity ${plant.hum_min}–${plant.hum_max}%, Light ${plant.light_min}–${plant.light_max}%`
    : 'No plant profile selected — use general plant care guidelines.';

  // Inject active experiment context so AI can follow it
  let expCtx = '';
  try {
    const { rows: activeExp } = await pool.query(
      "SELECT name, hypothesis, strategy_a, strategy_b, started_at FROM experiments WHERE status = 'running' LIMIT 1"
    );
    if (activeExp.length) {
      const e = activeExp[0];
      expCtx = `\nACTIVE EXPERIMENT: "${e.name}" (running since ${new Date(e.started_at).toLocaleDateString()})
Hypothesis: ${e.hypothesis || 'N/A'}
Strategy A: ${JSON.stringify(e.strategy_a)}
Strategy B: ${JSON.stringify(e.strategy_b)}
→ Follow Strategy B conditions when making decisions to properly test this experiment.\n`;
    }
  } catch (_) {}


  const prompt = `You are an AI greenhouse autopilot for an Arduino-based plant monitoring system.

${plantCtx}${expCtx}

Live sensor readings:
- Soil moisture: ${log.soil ?? 'N/A'}%
- Water level: ${log.water ?? 'N/A'} raw (0-1023; <200=EMPTY, <500=low, <800=medium, ≥800=full)
- Light: ${log.light ?? 'N/A'}%
- Temperature: ${log.temp ?? 'N/A'}°C
- Humidity: ${log.hum ?? 'N/A'}%

Current actuator state: Pump=${state.pump ? 'ON' : 'OFF'}, Grow light=${state.light ? 'ON' : 'OFF'}, Buzzer=${state.buzzer ? 'ON' : 'OFF'}, Fan=${state.fan ? 'ON' : 'OFF'}

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
    "buzzer": <true|false|null>,
    "fan": <true|false|null>
  }
}`;

  const decision = await callGeminiJSON(prompt, { maxOutputTokens: 512, temperature: 0.1, endpoint: 'autopilot-ai' });
  // Safety override: block pump if water empty
  if (log.water !== null && log.water < 200 && decision.actions?.pump === true) {
    decision.actions.pump = false;
    decision.analysis += ' (Pump blocked: water tank empty.)';
  }
  return decision;
}

// ─── Feature 14: AI auto-creates experiments when pilot mode is active ────────
async function maybeCreateAIExperiment() {
  if (Date.now() - lastAIExpMs < EXP_SUG_TTL) return; // once per 4 hours max
  lastAIExpMs = Date.now(); // claim the slot immediately to prevent races

  try {
    // Skip if there's already a running experiment
    const { rows: running } = await pool.query(
      "SELECT id FROM experiments WHERE status = 'running' LIMIT 1"
    );
    if (running.length) return;

    const [{ rows: logs }, plant, { rows: health }] = await Promise.all([
      pool.query(`SELECT soil, water, light, temp, hum FROM logs WHERE time > NOW() - INTERVAL '7 days' ORDER BY time DESC LIMIT 100`),
      getActivePlant(),
      pool.query('SELECT score, status FROM health_scores ORDER BY created_at DESC LIMIT 3'),
    ]);
    if (logs.length < 10) return;

    const avg   = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'N/A';
    const soilV = logs.filter(r => r.soil  != null).map(r => r.soil);
    const tempV = logs.filter(r => r.temp  != null).map(r => r.temp);
    const humV  = logs.filter(r => r.hum   != null).map(r => r.hum);
    const lightV= logs.filter(r => r.light != null).map(r => r.light);

    const plantCtx = plant
      ? `Plant: ${plant.emoji} ${plant.name} | Ideal: soil ${plant.soil_min}–${plant.soil_max}%, temp ${plant.temp_min}–${plant.temp_max}°C`
      : 'No plant profile.';

    const prompt = `You are an AI plant scientist. Design ONE smart A/B experiment for this greenhouse.

${plantCtx}
${health.length ? `Recent health: ${health.map(h => h.score + '/100 (' + h.status + ')').join(', ')}` : ''}
7-day averages: soil=${avg(soilV)}%, temp=${avg(tempV)}°C, hum=${avg(humV)}%, light=${avg(lightV)}%

Return ONLY valid JSON (no markdown):
{
  "name": "Short experiment name",
  "hypothesis": "If we [change X], then [metric Y] should improve because [reason]",
  "strategy_a": { "label": "Current Approach", "description": "Keep current settings", "condition": "existing threshold" },
  "strategy_b": { "label": "New Approach", "description": "What to test", "condition": "new threshold" },
  "duration_days": 5
}`;

    const exp = await callGeminiJSON(prompt, { maxOutputTokens: 500, temperature: 0.4, endpoint: 'experiments' });
    await pool.query(
      `INSERT INTO experiments (name, hypothesis, strategy_a, strategy_b, duration_days) VALUES ($1,$2,$3,$4,$5)`,
      [exp.name, exp.hypothesis, JSON.stringify(exp.strategy_a), JSON.stringify(exp.strategy_b), exp.duration_days ?? 5]
    );
    console.log(`[AI-PILOT] Auto-created experiment: "${exp.name}"`);
  } catch (err) {
    console.error('[AI-PILOT experiment]', err.message);
    lastAIExpMs = 0; // reset so it can retry next cycle
  }
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

    // Feature 14: AI pilot auto-creates experiments
    if (mode === 'ai') maybeCreateAIExperiment().catch(() => {});
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
      fan        BOOLEAN     NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`INSERT INTO actuator_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await pool.query('ALTER TABLE actuator_state ADD COLUMN IF NOT EXISTS fan BOOLEAN NOT NULL DEFAULT FALSE').catch(() => {});
  await pool.query('ALTER TABLE actuator_state ADD COLUMN IF NOT EXISTS led_r INT NOT NULL DEFAULT 255').catch(() => {});
  await pool.query('ALTER TABLE actuator_state ADD COLUMN IF NOT EXISTS led_g INT NOT NULL DEFAULT 255').catch(() => {});
  await pool.query('ALTER TABLE actuator_state ADD COLUMN IF NOT EXISTS led_b INT NOT NULL DEFAULT 0').catch(() => {});

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id             SERIAL      PRIMARY KEY,
      endpoint       TEXT        NOT NULL DEFAULT 'unknown',
      prompt_tokens  INT         NOT NULL DEFAULT 0,
      output_tokens  INT         NOT NULL DEFAULT 0,
      total_tokens   INT         NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS experiments (
      id               SERIAL      PRIMARY KEY,
      name             TEXT        NOT NULL,
      hypothesis       TEXT,
      strategy_a       JSONB       NOT NULL,
      strategy_b       JSONB       NOT NULL,
      duration_days    INT         NOT NULL DEFAULT 7,
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at         TIMESTAMPTZ,
      result           JSONB,
      status           TEXT        NOT NULL DEFAULT 'running'
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
  if (!process.env.GEMINI_API_KEY) return null;

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

  const result = await callGeminiJSON(prompt, { maxOutputTokens: 512, temperature: 0.2, endpoint: 'health-score' });
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
  if (!process.env.GEMINI_API_KEY) return null;

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

  const r = await callGeminiJSON(prompt, { maxOutputTokens: 700, temperature: 0.4, endpoint: 'daily-report' });
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
      fan:     state.fan    ? 1 : 0,
      led_r:   state.led_r,
      led_g:   state.led_g,
      led_b:   state.led_b,
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
    const { device, value, duration } = req.body;
    if (!['light', 'pump', 'buzzer', 'fan'].includes(device)) {
      return res.status(400).json({ error: 'Invalid device' });
    }
    const on = value === '1' || value === 1 || value === true || value === 'true';

    if (device === 'pump' && on) {
      // Pump always uses a timer to auto-shutoff — prevents running dry
      const sec = await schedulePumpOff(duration ?? 10);
      console.log(`[CTRL] PUMP ON for ${sec}s (manual)`);
    } else {
      await pool.query(
        `UPDATE actuator_state SET ${device} = $1, updated_at = NOW() WHERE id = 1`,
        [on]
      );
      console.log(`[CTRL] ${device.toUpperCase()} -> ${on ? 'ON' : 'OFF'}`);
    }

    const state = await getActuatorState();
    res.json({ success: true, state });
  } catch (err) {
    console.error('[POST /api/control]', err.message);
    res.status(500).json({ success: false });
  }
});

// ─── LED Color API ────────────────────────────────────────────────
app.post('/api/led-color', async (req, res) => {
  try {
    const r = Math.min(255, Math.max(0, parseInt(req.body.r) || 0));
    const g = Math.min(255, Math.max(0, parseInt(req.body.g) || 0));
    const b = Math.min(255, Math.max(0, parseInt(req.body.b) || 0));
    await pool.query('UPDATE actuator_state SET led_r = $1, led_g = $2, led_b = $3, updated_at = NOW() WHERE id = 1', [r, g, b]);
    console.log(`[LED] Color set to rgb(${r},${g},${b})`);
    res.json({ success: true, led_r: r, led_g: g, led_b: b });
  } catch (err) {
    console.error('[POST /api/led-color]', err.message);
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

    const rawReply = (await callGemini(message, {
      systemPrompt,
      history,
      maxOutputTokens: 600,
      temperature:     0.7,
      endpoint:        'chat',
    })) || 'No response from AI.';

    // Extract optional action suggestion from reply
    const { text: reply, action } = extractChatAction(rawReply);

    await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', ['assistant', reply]);
    res.json({ response: reply, action: action ?? null });
  } catch (err) {
    const status = err.geminiError ? 502 : 500;
    console.error('[POST /api/chat]', err.message);
    res.status(status).json({ error: err.message });
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

  p += `Actuators: Light=${state.light?'ON':'OFF'}, Pump=${state.pump?'ON':'OFF'}, Buzzer=${state.buzzer?'ON':'OFF'}, Fan=${state.fan?'ON':'OFF'}\n\n`;
  p += 'Be brief and practical.';
  if (plant) p += ` Always compare readings against the ideal ranges for ${plant.name} and give plant-specific advice.`;
  p += `\n\nDEVICE CONTROL: If the user asks you to perform a device action OR if sensor data clearly requires immediate intervention, you may suggest one action. Append this block at the VERY END of your reply on its own line (no other text after it):
[ACTION:{"type":"pump","value":true,"pump_duration_seconds":8,"label":"Run pump for 8 seconds","confirm_text":"Activate the water pump for 8 seconds to hydrate the soil."}]
Valid types: "pump" (value always true, pump_duration_seconds 1-30), "light" (value true/false), "buzzer" (value true/false), "fan" (value true/false).
ONLY include this block when the user explicitly asks you to control something, or when a sensor reading is critically wrong and requires immediate action. Never include it for general advice.`;
  return p;
}

// ─── Chat action helper ────────────────────────────────────────────
function extractChatAction(text) {
  const match = text.match(/\[ACTION:(\{[\s\S]*?\})\]/);
  if (!match) return { text: text.trim(), action: null };
  try {
    const action   = JSON.parse(match[1]);
    const cleanText = text.replace(/\[ACTION:[\s\S]*?\]/, '').trim();
    return { text: cleanText, action };
  } catch {
    return { text: text.trim(), action: null };
  }
}

// ─── Chat action execution endpoint ───────────────────────────────
app.post('/api/chat/action', async (req, res) => {
  try {
    const { type, value, pump_duration_seconds } = req.body;
    if (!['pump', 'light', 'buzzer', 'fan'].includes(type)) {
      return res.status(400).json({ error: 'Invalid device type' });
    }
    if (type === 'pump') {
      const sec = await schedulePumpOff(pump_duration_seconds ?? 8);
      await pool.query('UPDATE actuator_state SET pump = TRUE, updated_at = NOW() WHERE id = 1');
      console.log(`[CHAT-ACTION] Pump ON for ${sec}s (AI-recommended)`);
      return res.json({ success: true, message: `Pump activated for ${sec} seconds` });
    }
    const on = value === true || value === 'true' || value === 1;
    await pool.query(`UPDATE actuator_state SET ${type} = $1, updated_at = NOW() WHERE id = 1`, [on]);
    console.log(`[CHAT-ACTION] ${type.toUpperCase()} → ${on ? 'ON' : 'OFF'}`);
    res.json({ success: true, message: `${type} turned ${on ? 'ON' : 'OFF'}` });
  } catch (err) {
    console.error('[POST /api/chat/action]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

// ═══════════════════════════════════════════════════════════════════
// FEATURE 2: Predictive Plant Stress Detection
// ═══════════════════════════════════════════════════════════════════
app.get('/api/predictions', async (req, res) => {
  try {
    if (Date.now() - predCache.at < PRED_TTL && predCache.data) return res.json(predCache.data);

    const { rows } = await pool.query(`
      SELECT soil, water, light, temp, hum, time
      FROM logs WHERE time > NOW() - INTERVAL '6 hours'
      ORDER BY time ASC
    `);

    if (rows.length < 3) {
      return res.json({ predictions: [], overall_outlook: 'Not enough data yet — need at least 3 readings over 6 hours.', generated_at: new Date().toISOString() });
    }

    const extract = (key) => rows.filter(r => r[key] != null).map(r => Number(r[key]));
    const soilV = extract('soil');  const waterV = extract('water');
    const lightV = extract('light'); const tempV  = extract('temp'); const humV = extract('hum');

    const firstMs = new Date(rows[0].time).getTime();
    const lastMs  = new Date(rows[rows.length - 1].time).getTime();
    const spanH   = ((lastMs - firstMs) / 3_600_000).toFixed(1);
    const intMin  = rows.length > 1 ? ((lastMs - firstMs) / (rows.length - 1) / 60_000).toFixed(0) : '?';
    const last    = rows[rows.length - 1];

    const prompt = `You are an expert plant stress prediction AI. Analyze these sensor trends from the last ${spanH} hours and predict upcoming plant stress events.

Current readings: soil=${last.soil ?? 'N/A'}%, water=${last.water ?? 'N/A'} raw, light=${last.light ?? 'N/A'}%, temp=${last.temp ?? 'N/A'}°C, humidity=${last.hum ?? 'N/A'}%

Trend (change per reading; readings every ~${intMin} min):
- Soil:  ${computeTrend(soilV).toFixed(3)} %/reading  (${soilV.length} readings, ${soilV.length > 0 ? Math.min(...soilV) : 'N/A'}–${soilV.length > 0 ? Math.max(...soilV) : 'N/A'}%)
- Water: ${computeTrend(waterV).toFixed(3)} raw/reading
- Light: ${computeTrend(lightV).toFixed(3)} %/reading
- Temp:  ${computeTrend(tempV).toFixed(3)} °C/reading
- Hum:   ${computeTrend(humV).toFixed(3)} %/reading

Based on ${rows.length} readings over ${spanH} hours, predict stress events. Use real timing (e.g. "in ~2 hours", "by tonight"). Only flag real risks with clear trend evidence.

Return ONLY valid JSON (no markdown):
{
  "predictions": [
    {
      "type": "water_stress|heat_stress|low_light_stress|overwatering_risk|humidity_problem|sensor_failure",
      "severity": "low|medium|high|critical",
      "title": "short title",
      "description": "precise prediction with timing based on the trend rate",
      "time_estimate": "e.g. '~2 hours' or 'by 9:30 PM'",
      "recommended_action": "what to do and when",
      "confidence": "low|medium|high"
    }
  ],
  "overall_outlook": "1-2 sentence plant outlook for the next few hours",
  "next_check": "when to check again"
}`;

    const result = await callGeminiJSON(prompt, { maxOutputTokens: 800, temperature: 0.2, endpoint: 'predictions' });
    predCache.data = { ...result, generated_at: new Date().toISOString(), readings: rows.length, span_hours: spanH };
    predCache.at   = Date.now();
    res.json(predCache.data);
  } catch (err) {
    console.error('[PREDICTIONS]', err.message);
    res.status(500).json({ error: err.message, predictions: [] });
  }
});

// Force refresh predictions
app.post('/api/predictions/refresh', (_req, res) => { predCache.at = 0; res.json({ ok: true }); });

// ═══════════════════════════════════════════════════════════════════
// FEATURE 6: AI Root Cause Analysis
// ═══════════════════════════════════════════════════════════════════
app.get('/api/root-cause', async (req, res) => {
  try {
    const force = req.query.force === '1';
    if (!force && Date.now() - rcCache.at < RC_TTL && rcCache.data) return res.json(rcCache.data);

    const [{ rows: healthRows }, { rows: logRows }] = await Promise.all([
      pool.query('SELECT score, status, created_at FROM health_scores ORDER BY created_at DESC LIMIT 20'),
      pool.query(`SELECT soil, water, light, temp, hum, time FROM logs WHERE time > NOW() - INTERVAL '12 hours' ORDER BY time DESC LIMIT 48`),
    ]);

    if (healthRows.length < 2 && logRows.length < 5) {
      return res.json({ analysis: null, message: 'Not enough data for root cause analysis — need health score history and recent logs.' });
    }

    const currentScore  = healthRows[0]?.score ?? 'N/A';
    const previousScore = healthRows[1]?.score ?? 'N/A';
    const scoreDelta    = (typeof currentScore === 'number' && typeof previousScore === 'number') ? currentScore - previousScore : 0;

    const scoreHistory  = healthRows.slice(0, 10).map(r => `${r.score} (${r.status}) at ${new Date(r.created_at).toLocaleTimeString()}`).join('\n  ');
    const logSummary    = logRows.slice(0, 24).map(r =>
      `soil:${r.soil ?? '—'}% water:${r.water ?? '—'} light:${r.light ?? '—'}% temp:${r.temp ?? '—'}°C hum:${r.hum ?? '—'}%`
    ).join('\n  ');

    const prompt = `You are an expert plant health AI analyst. Perform a root cause analysis of the current plant health situation.

Health Score History (newest first):
  ${scoreHistory}

Current: ${currentScore}/100 | Previous: ${previousScore}/100 | Change: ${scoreDelta > 0 ? '+' : ''}${scoreDelta} points

Last 24 Sensor Readings (newest first):
  ${logSummary}

Identify the REAL reasons for the current health score. Be specific — name exact values and durations. Do not guess; only cite what the data shows.

Return ONLY valid JSON (no markdown):
{
  "current_score": ${currentScore},
  "trend": "improving|stable|declining",
  "primary_cause": "The single main driver of the current health situation with specific values",
  "secondary_causes": ["other contributing factor with data", "..."],
  "sensor_analysis": {
    "soil":  { "status": "ok|warning|critical", "note": "specific observation" },
    "water": { "status": "ok|warning|critical", "note": "specific observation" },
    "light": { "status": "ok|warning|critical", "note": "specific observation" },
    "temp":  { "status": "ok|warning|critical", "note": "specific observation" },
    "hum":   { "status": "ok|warning|critical", "note": "specific observation" }
  },
  "timeline": "Brief narrative of what happened chronologically and why the score is where it is",
  "recovery_steps": ["concrete step 1", "concrete step 2", "concrete step 3"]
}`;

    const result = await callGeminiJSON(prompt, { maxOutputTokens: 800, temperature: 0.2, endpoint: 'root-cause' });
    rcCache.data = { ...result, generated_at: new Date().toISOString() };
    rcCache.at   = Date.now();
    res.json(rcCache.data);
  } catch (err) {
    console.error('[ROOT-CAUSE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/root-cause/refresh', (_req, res) => { rcCache.at = 0; res.json({ ok: true }); });

// ═══════════════════════════════════════════════════════════════════
// FEATURE 7: AI Experiment Mode
// ═══════════════════════════════════════════════════════════════════
app.get('/api/experiments', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM experiments ORDER BY started_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/experiments', async (req, res) => {
  try {
    const { name, hypothesis, strategy_a, strategy_b, duration_days = 7 } = req.body;
    if (!name || !strategy_a || !strategy_b) return res.status(400).json({ error: 'name, strategy_a and strategy_b are required' });
    const { rows } = await pool.query(
      `INSERT INTO experiments (name, hypothesis, strategy_a, strategy_b, duration_days) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, hypothesis || null, JSON.stringify(strategy_a), JSON.stringify(strategy_b), duration_days]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/experiments/:id/end', async (req, res) => {
  try {
    const { rows: expRows } = await pool.query('SELECT * FROM experiments WHERE id = $1', [req.params.id]);
    if (!expRows.length) return res.status(404).json({ error: 'Experiment not found' });
    const exp = expRows[0];

    const { rows: logs } = await pool.query(
      `SELECT soil, water, light, temp, hum, time FROM logs WHERE time >= $1 ORDER BY time ASC`,
      [exp.started_at]
    );

    const logSample = logs.slice(0, 60).map(r => `soil:${r.soil ?? '—'}% water:${r.water ?? '—'} light:${r.light ?? '—'}% temp:${r.temp ?? '—'}°C`).join('\n');

    const prompt = `Analyze this plant watering experiment and provide results.

Experiment: "${exp.name}"
Hypothesis: ${exp.hypothesis || 'N/A'}
Duration planned: ${exp.duration_days} days | Data collected: ${logs.length} readings

Strategy A: ${JSON.stringify(exp.strategy_a)}
Strategy B: ${JSON.stringify(exp.strategy_b)}

Sensor log sample (${Math.min(logs.length, 60)} of ${logs.length} readings):
${logSample}

Analyze what happened and which strategy performed better. Use specific numbers where possible.

Return ONLY valid JSON (no markdown):
{
  "winner": "a|b|tie",
  "conclusion": "Main conclusion from the experiment",
  "strategy_a_result": { "summary": "...", "strengths": "...", "weaknesses": "..." },
  "strategy_b_result": { "summary": "...", "strengths": "...", "weaknesses": "..." },
  "key_insight": "The single most important thing learned",
  "recommendation": "Which strategy to use going forward and why"
}`;

    const result = await callGeminiJSON(prompt, { maxOutputTokens: 900, temperature: 0.3, endpoint: 'experiments' });
    await pool.query(
      `UPDATE experiments SET status = 'completed', ended_at = NOW(), result = $1 WHERE id = $2`,
      [JSON.stringify(result), exp.id]
    );
    const { rows: updated } = await pool.query('SELECT * FROM experiments WHERE id = $1', [exp.id]);
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/experiments/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM experiments WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// FEATURE 8: Personalized Plant Care Model
// ═══════════════════════════════════════════════════════════════════
app.get('/api/plant-model', async (req, res) => {
  try {
    const force = req.query.force === '1';
    if (!force && Date.now() - modelCache.at < MODEL_TTL && modelCache.data) return res.json(modelCache.data);

    const { rows } = await pool.query(`
      SELECT soil, water, light, temp, hum, time
      FROM logs WHERE time > NOW() - INTERVAL '7 days'
      ORDER BY time ASC
    `);

    if (rows.length < 20) {
      return res.json({ model: null, message: `Need more data — have ${rows.length} readings, need at least 20 (about 2-3 days of readings).` });
    }

    // Drying rate: consecutive readings where soil is falling (no pump data in logs)
    const dryingRates = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1].soil != null && rows[i].soil != null) {
        const dtH  = (new Date(rows[i].time) - new Date(rows[i - 1].time)) / 3_600_000;
        const drop = rows[i - 1].soil - rows[i].soil;
        // Only count drops (not jumps from watering) within a reasonable window
        if (drop > 0 && drop < 20 && dtH > 0 && dtH < 1) dryingRates.push(drop / dtH);
      }
    }

    // Soil jumps upward = likely watering events
    const wateringJumps = [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i - 1].soil != null && rows[i].soil != null) {
        const jump = rows[i].soil - rows[i - 1].soil;
        if (jump > 3) wateringJumps.push(jump); // >3% jump = watering
      }
    }

    // Light by hour
    const lightHours = {};
    rows.forEach(r => {
      if (r.light == null) return;
      const h = new Date(r.time).getHours();
      if (!lightHours[h]) lightHours[h] = [];
      lightHours[h].push(r.light);
    });
    const avgLightH = Object.fromEntries(
      Object.entries(lightHours).map(([h, vs]) => [h, (vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(0)])
    );

    const soilVals       = rows.filter(r => r.soil  != null).map(r => r.soil);
    const avgSoil        = soilVals.length ? (soilVals.reduce((a, b) => a + b, 0) / soilVals.length).toFixed(1) : 'N/A';
    const avgDryRate     = dryingRates.length   ? (dryingRates.reduce((a, b) => a + b, 0) / dryingRates.length).toFixed(2)     : null;
    const avgWaterJump   = wateringJumps.length ? (wateringJumps.reduce((a, b) => a + b, 0) / wateringJumps.length).toFixed(1) : null;
    const wateringEvents = wateringJumps.length;

    const stats = { readings: rows.length, avg_soil: avgSoil, avg_drying_pct_per_hour: avgDryRate, avg_watering_jump_pct: avgWaterJump, watering_events: wateringEvents, light_by_hour: avgLightH };

    const prompt = `You are a plant science AI. Build a personalized care model from real greenhouse data.

Data from last 7 days (${rows.length} readings):
- Average soil moisture: ${avgSoil}%
- Average drying rate: ${avgDryRate ?? 'N/A'}% per hour (gradual drops between waterings)
- Detected watering events: ${wateringEvents} (soil jumps >3% counted as watering)
- Average soil moisture jump per watering: ${avgWaterJump ?? 'N/A'}%
- Light level by hour of day: ${JSON.stringify(avgLightH)}

Use these real numbers to produce a personalized model for THIS specific greenhouse.

Return ONLY valid JSON (no markdown):
{
  "insights": [
    { "icon": "💧", "title": "Drying Rate", "detail": "specific number-based insight" },
    { "icon": "⏱️", "title": "Watering Effect", "detail": "specific number-based insight" },
    { "icon": "☀️", "title": "Light Pattern", "detail": "specific hours + levels from data" },
    { "icon": "🌱", "title": "Soil Behavior", "detail": "trend and range observation" }
  ],
  "hours_to_critical_dryness": "estimated hours from average moisture to critical level, based on drying rate",
  "recommended_watering_seconds": "optimal pump duration based on pump effect data",
  "best_light_hours": "hours with strongest natural light (from data)",
  "low_light_hours": "hours where grow light would help most",
  "personalized_tip": "one specific, data-driven tip unique to this greenhouse",
  "summary": "2-3 sentence summary of this greenhouse's specific behavior"
}`;

    const result = await callGeminiJSON(prompt, { maxOutputTokens: 800, temperature: 0.3, endpoint: 'plant-model' });
    modelCache.data = { ...result, stats, generated_at: new Date().toISOString() };
    modelCache.at   = Date.now();
    res.json(modelCache.data);
  } catch (err) {
    console.error('[PLANT-MODEL]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/plant-model/refresh', (_req, res) => { modelCache.at = 0; res.json({ ok: true }); });

// ═══════════════════════════════════════════════════════════════════
// Token Usage Tracker
// ═══════════════════════════════════════════════════════════════════
app.get('/api/token-usage', async (_req, res) => {
  try {
    const [{ rows: recent }, { rows: byEndpoint }, { rows: overall }, { rows: daily }] = await Promise.all([
      // Last 100 individual requests
      pool.query(`
        SELECT id, endpoint, prompt_tokens, output_tokens, total_tokens, created_at
        FROM token_usage ORDER BY created_at DESC LIMIT 100
      `),
      // Aggregated per endpoint
      pool.query(`
        SELECT
          endpoint,
          COUNT(*)::INT             AS calls,
          SUM(prompt_tokens)::INT   AS prompt_tokens,
          SUM(output_tokens)::INT   AS output_tokens,
          SUM(total_tokens)::INT    AS total_tokens,
          AVG(total_tokens)::INT    AS avg_tokens,
          MAX(total_tokens)::INT    AS max_tokens
        FROM token_usage
        GROUP BY endpoint
        ORDER BY total_tokens DESC
      `),
      // Grand total
      pool.query(`
        SELECT
          COUNT(*)::INT             AS total_calls,
          COALESCE(SUM(prompt_tokens),0)::INT  AS grand_prompt,
          COALESCE(SUM(output_tokens),0)::INT  AS grand_output,
          COALESCE(SUM(total_tokens),0)::INT   AS grand_total
        FROM token_usage
      `),
      // Daily totals (last 14 days)
      pool.query(`
        SELECT
          DATE(created_at)          AS day,
          COUNT(*)::INT             AS calls,
          SUM(total_tokens)::INT    AS total_tokens
        FROM token_usage
        WHERE created_at > NOW() - INTERVAL '14 days'
        GROUP BY DATE(created_at)
        ORDER BY day ASC
      `),
    ]);
    res.json({ recent, by_endpoint: byEndpoint, overall: overall[0], daily });
  } catch (err) {
    console.error('[TOKEN-USAGE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/token-usage', async (_req, res) => {
  try {
    await pool.query('DELETE FROM token_usage');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// FEATURE 13: AI-Based Sensor Fusion
// ═══════════════════════════════════════════════════════════════════
app.get('/api/sensor-fusion', async (req, res) => {
  try {
    const force = req.query.force === '1';
    if (!force && Date.now() - fusionCache.at < FUSION_TTL && fusionCache.data) return res.json(fusionCache.data);

    const [{ rows }, plant] = await Promise.all([
      pool.query('SELECT soil, water, light, temp, hum, time FROM logs ORDER BY time DESC LIMIT 3'),
      getActivePlant(),
    ]);

    if (!rows.length) return res.json({ fusion: null, message: 'No sensor data yet.' });

    const latest   = rows[0];
    const plantCtx = plant
      ? `Plant: ${plant.emoji} ${plant.name} — ideal soil ${plant.soil_min}–${plant.soil_max}%, temp ${plant.temp_min}–${plant.temp_max}°C, hum ${plant.hum_min}–${plant.hum_max}%, light ${plant.light_min}–${plant.light_max}%`
      : 'No plant profile — use general best-practice ranges.';

    const prompt = `You are a plant science AI that analyzes CROSS-SENSOR RELATIONSHIPS — not individual readings.

${plantCtx}
Current readings: soil=${latest.soil ?? 'N/A'}%, water=${latest.water ?? 'N/A'} raw (0-1023; <200=empty), light=${latest.light ?? 'N/A'}%, temp=${latest.temp ?? 'N/A'}°C, humidity=${latest.hum ?? 'N/A'}%

Identify patterns that ONLY make sense when combining multiple sensors:
- soil low + humidity high → root-level dryness (NOT air dryness); environment is fine but roots need water
- soil low + humidity low → full environmental dryness; both root and air moisture are lacking
- light low + temp dropping → cold dim day; photosynthesis and growth rate will drop together
- soil wet + humidity high → overwatering risk; mold/rot possible
- soil medium + temp high → heat-driven evaporation will drain soil faster than expected
- water raw < 200 + soil dropping → critical double depletion; tank empty AND roots drying
- light high + hum low → high transpiration; plant losing water faster than average

Return ONLY valid JSON (no markdown):
{
  "fused_state": "2-5 word compound state label (e.g. 'Root-Level Dryness', 'Healthy Equilibrium', 'Cold Dim Growth Day', 'Heat Evaporation Risk')",
  "state_severity": "ok|warning|critical",
  "primary_relationship": {
    "sensors": ["soil", "hum"],
    "observation": "What these sensors together show — use specific numbers",
    "interpretation": "The plant-relevant insight that a single sensor CANNOT give"
  },
  "secondary_relationships": [
    { "sensors": ["light", "temp"], "observation": "...", "interpretation": "..." }
  ],
  "growth_forecast": "Specific prediction about growth rate/direction for the next 12 hours",
  "growth_level": "optimal|good|reduced|poor|halted",
  "priority_insight": "The single most important insight from combining ALL sensors together",
  "recommendation": "The most important action this compound analysis calls for"
}`;

    const result = await callGeminiJSON(prompt, { maxOutputTokens: 700, temperature: 0.2, endpoint: 'sensor-fusion' });
    fusionCache.data = { ...result, generated_at: new Date().toISOString() };
    fusionCache.at   = Date.now();
    res.json(fusionCache.data);
  } catch (err) {
    console.error('[SENSOR-FUSION]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sensor-fusion/refresh', (_req, res) => { fusionCache.at = 0; res.json({ ok: true }); });

// ═══════════════════════════════════════════════════════════════════
// FEATURE 14: AI Experiment Suggestions
// ═══════════════════════════════════════════════════════════════════
app.get('/api/experiments/suggest', async (req, res) => {
  try {
    const force = req.query.force === '1';
    if (!force && Date.now() - expSugCache.at < EXP_SUG_TTL && expSugCache.data) return res.json(expSugCache.data);

    const [{ rows: logs }, plant, { rows: health }] = await Promise.all([
      pool.query(`SELECT soil, water, light, temp, hum, time FROM logs WHERE time > NOW() - INTERVAL '7 days' ORDER BY time DESC LIMIT 100`),
      getActivePlant(),
      pool.query('SELECT score, status FROM health_scores ORDER BY created_at DESC LIMIT 5'),
    ]);

    if (logs.length < 10) {
      return res.json({ suggestions: [], message: `Need more data — have ${logs.length} readings, need ≥10 (about 1 day of readings).` });
    }

    const avg   = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'N/A';
    const soilV = logs.filter(r => r.soil  != null).map(r => r.soil);
    const tempV = logs.filter(r => r.temp  != null).map(r => r.temp);
    const humV  = logs.filter(r => r.hum   != null).map(r => r.hum);
    const lightV= logs.filter(r => r.light != null).map(r => r.light);

    const plantCtx = plant
      ? `Active plant: ${plant.emoji} ${plant.name}\nIdeal: soil ${plant.soil_min}–${plant.soil_max}%, temp ${plant.temp_min}–${plant.temp_max}°C, hum ${plant.hum_min}–${plant.hum_max}%, light ${plant.light_min}–${plant.light_max}%`
      : 'No plant profile — use general best-practice ranges.';

    const prompt = `You are a plant science experiment designer. Based on real greenhouse data, suggest 2 targeted A/B experiments to improve plant health.

${plantCtx}
${health.length ? `Recent health scores: ${health.map(h => h.score + '/100 (' + h.status + ')').join(', ')}` : 'No health data yet.'}

Observed averages (last 7 days, ${logs.length} readings):
- Soil moisture: ${avg(soilV)}%
- Temperature:   ${avg(tempV)}°C
- Humidity:      ${avg(humV)}%
- Light:         ${avg(lightV)}%

Rules:
- Test ONE variable per experiment (soil threshold, watering duration, light schedule, etc.)
- Strategy A = current/conservative approach (based on the actual data above)
- Strategy B = the new approach being tested (use specific numbers)
- Duration 3–7 days; actionable with: pump (soil moisture) and grow light (light level)

Return ONLY valid JSON (no markdown):
{
  "suggestions": [
    {
      "name": "Clear experiment name",
      "hypothesis": "If we [do X], then [metric Y] will [improve] because [plant science reason]",
      "rationale": "1-2 sentences: why this experiment is worth doing given the data above",
      "strategy_a": { "label": "Current Approach", "description": "Specific current behavior with numbers", "condition": "e.g. pump when soil < 30%" },
      "strategy_b": { "label": "New Approach", "description": "What to test — specific target values", "condition": "e.g. pump when soil < 45%" },
      "duration_days": 5,
      "success_metric": "What measurement will determine the winner",
      "expected_outcome": "What improvement Strategy B should achieve"
    }
  ]
}`;

    const result = await callGeminiJSON(prompt, { maxOutputTokens: 1000, temperature: 0.4, endpoint: 'experiments' });
    expSugCache.data = { ...result, generated_at: new Date().toISOString() };
    expSugCache.at   = Date.now();
    res.json(expSugCache.data);
  } catch (err) {
    console.error('[EXP-SUGGEST]', err.message);
    res.status(500).json({ error: err.message, suggestions: [] });
  }
});

app.post('/api/experiments/suggest/refresh', (_req, res) => { expSugCache.at = 0; res.json({ ok: true }); });

// ═══════════════════════════════════════════════════════════════════
// FEATURE 12: AI Hardware Failure Prediction
// ═══════════════════════════════════════════════════════════════════
app.get('/api/hardware', async (req, res) => {
  try {
    const force = req.query.force === '1';
    if (!force && Date.now() - hwCache.at < HW_TTL && hwCache.data) return res.json(hwCache.data);

    // ── Fetch data ──────────────────────────────────────────────────
    const [{ rows: logs }, { rows: pumpEvents }] = await Promise.all([
      pool.query(`
        SELECT soil, water, light, temp, hum, time
        FROM logs WHERE time > NOW() - INTERVAL '6 hours'
        ORDER BY time ASC
      `),
      pool.query(`
        SELECT created_at, actions FROM autopilot_log
        WHERE actions->>'pump' = 'true'
          AND created_at > NOW() - INTERVAL '24 hours'
        ORDER BY created_at ASC
      `),
    ]);

    if (logs.length < 5) {
      return res.json({
        risks: [],
        healthy_components: [],
        overall_status: 'unknown',
        summary: 'Not enough data for hardware diagnostics — need at least 5 sensor readings.',
        generated_at: new Date().toISOString(),
      });
    }

    // ── Statistical analysis per sensor ────────────────────────────
    const stats = (key) => {
      const vals = logs.filter(r => r[key] != null).map(r => Number(r[key]));
      if (!vals.length) return { count: 0, mean: null, stddev: null, min: null, max: null };
      const mean   = vals.reduce((a, b) => a + b, 0) / vals.length;
      const stddev = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
      return { count: vals.length, mean: +mean.toFixed(2), stddev: +stddev.toFixed(3), min: Math.min(...vals), max: Math.max(...vals) };
    };

    const soilSt  = stats('soil');
    const waterSt = stats('water');
    const lightSt = stats('light');
    const tempSt  = stats('temp');
    const humSt   = stats('hum');

    // A sensor is "stuck" if stddev < 0.3 over ≥8 readings (reads the same value constantly)
    const stuck = (s, minCount = 8) => s.count >= minCount && s.stddev !== null && s.stddev < 0.3;

    // ── Pump effectiveness analysis ─────────────────────────────────
    // For each pump-ON event, compare soil moisture before vs after
    const pumpChecks = [];
    for (const pe of pumpEvents) {
      const activatedAt = new Date(pe.created_at).getTime();
      const before = logs.filter(r => {
        const t = new Date(r.time).getTime();
        return t >= activatedAt - 3 * 60_000 && t < activatedAt && r.soil != null;
      });
      const after  = logs.filter(r => {
        const t = new Date(r.time).getTime();
        return t > activatedAt && t <= activatedAt + 25 * 60_000 && r.soil != null;
      });

      if (before.length && after.length) {
        const soilBefore   = before[before.length - 1].soil;
        const soilAfterMax = Math.max(...after.map(r => r.soil));
        pumpChecks.push({
          at: pe.created_at,
          soilBefore,
          soilAfterMax,
          delta: +(soilAfterMax - soilBefore).toFixed(1),
          effective: soilAfterMax - soilBefore >= 2,
        });
      }
    }

    const failedPumps   = pumpChecks.filter(c => !c.effective);
    const workedPumps   = pumpChecks.filter(c => c.effective);
    const pumpFailureRate = pumpChecks.length ? failedPumps.length / pumpChecks.length : null;

    // ── Water tank empty for extended time ─────────────────────────
    const waterReadings  = logs.filter(r => r.water != null);
    const emptyReadings  = waterReadings.filter(r => r.water < 200);
    const emptyFraction  = waterReadings.length ? emptyReadings.length / waterReadings.length : 0;

    // ── Build concise context for Gemini ──────────────────────────
    const pumpSummary = pumpChecks.length === 0
      ? 'No autopilot pump activations recorded in the last 24h.'
      : `Pump activated ${pumpChecks.length}× in last 24h: ` +
        `${workedPumps.length} worked (soil ↑≥2%), ${failedPumps.length} had no effect.\n` +
        (failedPumps.length
          ? `  No-effect events: ${failedPumps.slice(0, 3).map(c => `soil ${c.soilBefore}%→${c.soilAfterMax}%`).join(', ')}`
          : '');

    const lastLog      = logs[logs.length - 1];
    const currentState = await getActuatorState();

    const prompt = `You are a hardware diagnostics AI for an Arduino IoT greenhouse system. Analyze sensor statistics and actuator behavior to detect hardware failures or abnormalities.

SENSOR STATISTICS (last 6 hours, ${logs.length} readings):
Soil  — mean: ${soilSt.mean ?? 'N/A'}%, stddev: ${soilSt.stddev ?? 'N/A'}, range: [${soilSt.min}–${soilSt.max}]%, readings: ${soilSt.count}
Water — mean: ${waterSt.mean ?? 'N/A'} raw, stddev: ${waterSt.stddev ?? 'N/A'}, range: [${waterSt.min}–${waterSt.max}], readings: ${waterSt.count}
Light — mean: ${lightSt.mean ?? 'N/A'}%, stddev: ${lightSt.stddev ?? 'N/A'}, range: [${lightSt.min}–${lightSt.max}]%, readings: ${lightSt.count}
Temp  — mean: ${tempSt.mean ?? 'N/A'}°C, stddev: ${tempSt.stddev ?? 'N/A'}, range: [${tempSt.min}–${tempSt.max}]°C, readings: ${tempSt.count}
Hum   — mean: ${humSt.mean ?? 'N/A'}%, stddev: ${humSt.stddev ?? 'N/A'}, range: [${humSt.min}–${humSt.max}]%, readings: ${humSt.count}

STUCK SENSOR FLAGS (stddev < 0.3 over 8+ readings = likely disconnected or broken):
Soil sensor stuck:  ${stuck(soilSt)}
Water sensor stuck: ${stuck(waterSt)}
Light sensor stuck: ${stuck(lightSt)}
Temp sensor stuck:  ${stuck(tempSt)}
Hum sensor stuck:   ${stuck(humSt)}

PUMP BEHAVIOR (last 24h):
${pumpSummary}
Pump failure rate: ${pumpChecks.length ? (pumpFailureRate * 100).toFixed(0) + '%' : 'N/A (no recorded activations)'}

WATER TANK:
${emptyFraction > 0 ? `Water level below 200 raw in ${(emptyFraction * 100).toFixed(0)}% of readings in last 6h (${emptyReadings.length}/${waterReadings.length} readings < 200)` : 'Water level appears adequate.'}

CURRENT STATE:
Latest — soil: ${lastLog.soil ?? 'N/A'}%, water: ${lastLog.water ?? 'N/A'}, light: ${lastLog.light ?? 'N/A'}%, temp: ${lastLog.temp ?? 'N/A'}°C
Actuators — pump: ${currentState.pump ? 'ON' : 'OFF'}, grow light: ${currentState.light ? 'ON' : 'OFF'}

RULES FOR GOOD ANALYSIS:
1. Only flag a REAL risk if the numbers clearly support it (e.g. pumpFailureRate ≥ 50%, stuck sensor flag = true, water empty >80% of readings)
2. Low stddev on temp/humidity can be NORMAL in a stable indoor environment — do NOT flag as stuck unless it's truly 0.000
3. If the pump was never activated (autopilot in manual mode), note that pump health can't be assessed
4. Use specific numbers in the reason and evidence fields

Return ONLY valid JSON (no markdown):
{
  "overall_status": "healthy|warning|critical",
  "risks": [
    {
      "component": "Pump|Soil Sensor|Water Sensor|Light Sensor|Temp Sensor|Humidity Sensor|Relay|Water Tank|Tubing",
      "risk_level": "low|medium|high|critical",
      "title": "Short descriptive issue title",
      "reason": "1-2 sentences with specific numbers explaining why this is flagged",
      "evidence": "The exact stat that triggered this (e.g. 'pump activated 3×, soil rose <2% each time')",
      "possible_causes": ["Specific cause 1", "Specific cause 2", "Specific cause 3"],
      "diagnostic_steps": ["Check step 1", "Check step 2"]
    }
  ],
  "healthy_components": ["List only components confirmed working normally"],
  "summary": "1-2 sentence overall hardware assessment"
}`;

    const result = await callGeminiJSON(prompt, { maxOutputTokens: 1000, temperature: 0.15, endpoint: 'hardware' });

    const data = {
      ...result,
      _raw: {
        pump_checks:   pumpChecks.length,
        pump_failures: failedPumps.length,
        logs_analyzed: logs.length,
      },
      generated_at: new Date().toISOString(),
    };
    hwCache.data = data;
    hwCache.at   = Date.now();
    res.json(data);
  } catch (err) {
    console.error('[HARDWARE]', err.message);
    res.status(500).json({ error: err.message, risks: [] });
  }
});

app.post('/api/hardware/refresh', (_req, res) => { hwCache.at = 0; res.json({ ok: true }); });

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
