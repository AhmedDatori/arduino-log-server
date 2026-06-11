'use strict';

const EXP_SUG_TTL = 4 * 60 * 60 * 1000;
const lastRun = { rules: 0, ai: 0 };
const COOLDOWN = { rules: 2 * 60 * 1000, ai: 10 * 60 * 1000 };
let lastAIExpMs = 0;

function createAutopilotService({ pool, stateService, actuatorService, aiClient }) {
  const { getActuatorState, getActivePlant, getMode } = stateService;
  const { applyAutopilotActions } = actuatorService;
  const { callGeminiJSON } = aiClient;

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

  return { runAutopilot, runRulesEngine, runAIEngine, applyAutopilotActions };
}

module.exports = { createAutopilotService };
