'use strict';

function createPlantIntelligenceModule(app, { pool, stateService, aiClient }) {
  const { getActuatorState, getActivePlant } = stateService;
  const { callGeminiJSON, callGeminiVision } = aiClient;

  async function diagnosePlant(imageBase64) {
    const plant    = await getActivePlant();
    const plantCtx = plant
      ? `The currently active plant type is: ${plant.emoji} ${plant.name}.\nIdeal conditions — Soil: ${plant.soil_min}–${plant.soil_max}%, Temp: ${plant.temp_min}–${plant.temp_max}°C, Humidity: ${plant.hum_min}–${plant.hum_max}%, Light: ${plant.light_min}–${plant.light_max}%.`
      : 'No plant type is configured in the system.';
  
    const prompt = `You are an expert plant health diagnostician analysing a photo taken by a greenhouse camera.
  
  ${plantCtx}
  
  Examine the plant(s) visible in the image. Assess leaf colour, texture, posture, signs of disease or pest damage, soil surface, and any other visible indicators.
  
  Respond ONLY with valid JSON, no markdown:
  {
    "health_score": <integer 0-100, 100 = perfect health>,
    "status": "<'healthy'|'fair'|'stressed'|'critical'>",
    "summary": "<2-3 sentences describing overall appearance and health>",
    "issues": [
      { "issue": "<short name>", "severity": "<'low'|'medium'|'high'>", "description": "<what you observe>" }
    ],
    "recommendations": ["<specific action 1>", "<specific action 2>"],
    "alerts": ["<urgent alert text, only if critical issue found — omit array entry otherwise>"],
    "plant_suggested": "<if you can identify the plant species and it differs from the current type, give the common name; otherwise null>"
  }`;
  
    const result = await callGeminiVision(prompt, imageBase64, { maxOutputTokens: 700, temperature: 0.2 });
  
    // Normalise
    result.health_score   = Math.max(0, Math.min(100, Number(result.health_score) || 50));
    result.issues         = Array.isArray(result.issues)         ? result.issues         : [];
    result.recommendations= Array.isArray(result.recommendations)? result.recommendations: [];
    result.alerts         = Array.isArray(result.alerts)         ? result.alerts.filter(Boolean) : [];
  
    await pool.query(
      `INSERT INTO plant_diagnoses
         (image_b64, health_score, status, summary, issues, recommendations, alerts, plant_suggested)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        imageBase64,
        result.health_score,
        result.status   || 'unknown',
        result.summary  || '',
        JSON.stringify(result.issues),
        JSON.stringify(result.recommendations),
        JSON.stringify(result.alerts),
        result.plant_suggested || null,
      ]
    );
  
    // Notifications for visual alerts
    for (const alert of result.alerts) {
      await pool.query(
        'INSERT INTO notifications (type, message, severity) VALUES ($1,$2,$3)',
        ['camera-visual', `[Camera AI] ${alert}`, 'warning']
      ).catch(() => {});
    }
    if (result.health_score < 40) {
      await pool.query(
        'INSERT INTO notifications (type, message, severity) VALUES ($1,$2,$3)',
        ['camera-health', `Visual plant health critical: ${result.health_score}/100 — ${result.summary}`, 'danger']
      ).catch(() => {});
    }
  
    console.log(`[VISION] Diagnosis: ${result.status} (${result.health_score}/100)`);
    return result;
  }
  
  async function diagnosePlantFromLatestFrame() {
    const { rows } = await pool.query(
      'SELECT image_b64 FROM camera_frames ORDER BY created_at DESC LIMIT 1'
    );
    if (!rows.length) { console.log('[VISION auto] No frames available'); return; }
    await diagnosePlant(rows[0].image_b64);
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
  
    // Include latest visual diagnosis if one was taken in the last 24 hours
    let visualCtx = '';
    try {
      const { rows: vRows } = await pool.query(
        `SELECT health_score, status, summary, issues, recommendations
         FROM plant_diagnoses WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 1`,
        [start]
      );
      if (vRows.length) {
        const v = vRows[0];
        const issueStr = (v.issues || []).map(i => `${i.issue} (${i.severity})`).join(', ');
        visualCtx = `\nVisual AI camera diagnosis: ${v.status} health score ${v.health_score}/100.
  ${v.summary}${issueStr ? `\nVisually detected issues: ${issueStr}.` : ''}\n`;
      }
    } catch (_) {}
  
    const prompt = `You are writing a daily greenhouse report for a plant owner.
  
  ${plantCtx}${visualCtx}Data from the last 24 hours (${d.readings} readings):
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

  return { computeHealthScore, generateDailyReport, diagnosePlant, diagnosePlantFromLatestFrame };
}

module.exports = { createPlantIntelligenceModule };
