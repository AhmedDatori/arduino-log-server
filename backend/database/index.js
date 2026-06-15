'use strict';

const { Pool } = require('pg');
const { databaseConfig } = require('../config');

const pool = new Pool(databaseConfig());

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
  await pool.query('ALTER TABLE actuator_state DROP COLUMN IF EXISTS led_r').catch(() => {});
  await pool.query('ALTER TABLE actuator_state DROP COLUMN IF EXISTS led_g').catch(() => {});
  await pool.query('ALTER TABLE actuator_state DROP COLUMN IF EXISTS led_b').catch(() => {});

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

  // Camera IP registry
  await pool.query(`
    CREATE TABLE IF NOT EXISTS camera_state (
      id        INT         PRIMARY KEY DEFAULT 1,
      ip        TEXT,
      last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`INSERT INTO camera_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

  // Rolling frame buffer for live feed / timeline
  await pool.query(`
    CREATE TABLE IF NOT EXISTS camera_frames (
      id         SERIAL      PRIMARY KEY,
      image_b64  TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS camera_frames_time_idx ON camera_frames (created_at DESC)`
  ).catch(() => {});

  // Visual plant diagnoses from Gemini Vision
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plant_diagnoses (
      id               SERIAL      PRIMARY KEY,
      image_b64        TEXT,
      health_score     INT,
      status           TEXT        NOT NULL DEFAULT 'unknown',
      summary          TEXT,
      issues           JSONB       NOT NULL DEFAULT '[]',
      recommendations  JSONB       NOT NULL DEFAULT '[]',
      alerts           JSONB       NOT NULL DEFAULT '[]',
      plant_suggested  TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

module.exports = { pool, initDB };
