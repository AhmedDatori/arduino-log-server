'use strict';

function createAlertAndConversationModule(app, { pool, stateService }) {
  const { getActuatorState } = stateService;

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
  

  return { checkNotifications, intervalMs: COOLDOWN_MS };
}

module.exports = { createAlertAndConversationModule };
