'use strict';

function createActuatorService(pool) {
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

  return { schedulePumpOff, applyAutopilotActions };
}

module.exports = { createActuatorService };
