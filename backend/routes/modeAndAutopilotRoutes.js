'use strict';

function registerModeAndAutopilotRoutes(app, { pool, stateService, autopilotService }) {
  const { getMode, getActuatorState, getActivePlant } = stateService;
  const { runRulesEngine, runAIEngine, applyAutopilotActions } = autopilotService;

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
  
}

module.exports = { registerModeAndAutopilotRoutes };
