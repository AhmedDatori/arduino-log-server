'use strict';

function registerSensorAndControlRoutes(app, { pool, stateService, actuatorService, autopilotService }) {
  const { getActuatorState, parseSensorMessage } = stateService;
  const { schedulePumpOff } = actuatorService;
  const { runAutopilot } = autopilotService;

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
  
}

module.exports = { registerSensorAndControlRoutes };
