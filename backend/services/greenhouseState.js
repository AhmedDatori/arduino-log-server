'use strict';

const DEFAULT_ACTUATOR_STATE = {
  light: false,
  pump: false,
  buzzer: false,
  fan: false,
  led_r: 255,
  led_g: 255,
  led_b: 0,
};

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '' || value === 'N/A') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSensorMessage(message) {
  const values = {};

  String(message || '').split(',').forEach(pair => {
    const separator = pair.indexOf(':');
    if (separator <= 0) return;
    const key = pair.slice(0, separator).trim();
    values[key] = pair.slice(separator + 1).trim();
  });

  return {
    water: toNumberOrNull(values.water),
    soil: toNumberOrNull(values.soil),
    light: toNumberOrNull(values.light),
    temp: toNumberOrNull(values.temp),
    hum: toNumberOrNull(values.hum),
  };
}

function createGreenhouseState(pool) {
  async function getActuatorState() {
    const { rows } = await pool.query(
      'SELECT light, pump, buzzer, fan, led_r, led_g, led_b, pump_off_at FROM actuator_state WHERE id = 1'
    );

    if (!rows.length) return { ...DEFAULT_ACTUATOR_STATE };

    let state = rows[0];
    if (state.pump && state.pump_off_at && new Date(state.pump_off_at) <= new Date()) {
      await pool.query('UPDATE actuator_state SET pump = FALSE, pump_off_at = NULL WHERE id = 1');
      state = { ...state, pump: false, pump_off_at: null };
      console.log('[PUMP] Timer expired - pump OFF');
    }

    return {
      light: state.light,
      pump: state.pump,
      buzzer: state.buzzer,
      fan: state.fan ?? false,
      led_r: state.led_r ?? 255,
      led_g: state.led_g ?? 255,
      led_b: state.led_b ?? 0,
    };
  }

  async function getActivePlant() {
    const { rows } = await pool.query(
      'SELECT * FROM plant_profiles WHERE is_active = TRUE LIMIT 1'
    );
    return rows[0] ?? null;
  }

  async function getMode() {
    const { rows } = await pool.query('SELECT mode FROM settings WHERE id = 1');
    return rows[0]?.mode ?? 'manual';
  }

  return { getActuatorState, getActivePlant, getMode, parseSensorMessage };
}

module.exports = { createGreenhouseState, parseSensorMessage };
