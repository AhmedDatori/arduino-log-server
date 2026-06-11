'use strict';

const { computeTrend } = require('../utils/trends');

function registerAiInsightRoutes(app, { pool, stateService, aiClient }) {
  const { getActuatorState, getActivePlant } = stateService;
  const { callGeminiJSON } = aiClient;
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
}

module.exports = { registerAiInsightRoutes };
