'use strict';

const express = require('express');

function registerCameraRoutes(app, { pool, plantIntelligence }) {
  const { diagnosePlant } = plantIntelligence;

  app.post('/camera/register', async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    try {
      await pool.query(
        `INSERT INTO camera_state (id, ip, last_seen) VALUES (1, $1, NOW())
         ON CONFLICT (id) DO UPDATE SET ip = $1, last_seen = NOW()`,
        [ip]
      );
      console.log(`[CAMERA] Registered IP: ${ip}`);
      res.json({ ok: true });
    } catch (err) {
      console.error('[CAMERA REGISTER]', err.message);
      res.status(500).json({ error: err.message });
    }
  });
  
  // ─── Camera: receive a frame push from ESP32-CAM ──────────────────
  // Stores JPEG in camera_frames rolling buffer (max 500 frames).
  // Also accepts /camera/photo for backward compatibility.
  async function handleFrameUpload(req, res) {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'No image data — send raw JPEG with Content-Type: image/jpeg' });
    }
    try {
      const imageBase64 = req.body.toString('base64');
      await pool.query('INSERT INTO camera_frames (image_b64) VALUES ($1)', [imageBase64]);
      // Prune: keep last 500 frames
      pool.query(
        `DELETE FROM camera_frames WHERE id NOT IN (
           SELECT id FROM camera_frames ORDER BY created_at DESC LIMIT 500
         )`
      ).catch(() => {});
      res.json({ ok: true, bytes: req.body.length });
    } catch (err) {
      console.error('[CAMERA FRAME]', err.message);
      res.status(500).json({ error: err.message });
    }
  }
  
  app.post('/camera/frame', express.raw({ type: 'image/jpeg', limit: '2mb' }), handleFrameUpload);
  app.post('/camera/photo', express.raw({ type: 'image/jpeg', limit: '2mb' }), handleFrameUpload);
  
  // ─── Camera: get registered IP ─────────────────────────────────────
  app.get('/api/camera/ip', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT ip, last_seen FROM camera_state WHERE id = 1');
      if (!rows.length || !rows[0].ip) return res.json({ ip: null });
      res.json({ ip: rows[0].ip, last_seen: rows[0].last_seen });
    } catch (err) {
      res.status(500).json({ ip: null, error: err.message });
    }
  });
  
  // ─── Camera: latest frame (with image) ────────────────────────────
  app.get('/api/camera/frames/latest', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, image_b64, created_at FROM camera_frames ORDER BY created_at DESC LIMIT 1'
      );
      if (!rows.length) return res.json({ frame: null });
      res.json({ id: rows[0].id, image: rows[0].image_b64, created_at: rows[0].created_at });
    } catch (err) {
      res.status(500).json({ frame: null, error: err.message });
    }
  });
  
  // ─── Camera: frame list for timeline (id + timestamp only) ─────────
  app.get('/api/camera/frames', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, created_at FROM camera_frames ORDER BY created_at ASC'
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json([]);
    }
  });
  
  // ─── Camera: specific frame by id ─────────────────────────────────
  app.get('/api/camera/frames/:id', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, image_b64, created_at FROM camera_frames WHERE id = $1',
        [parseInt(req.params.id, 10)]
      );
      if (!rows.length) return res.status(404).json({ error: 'Frame not found' });
      res.json({ id: rows[0].id, image: rows[0].image_b64, created_at: rows[0].created_at });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // Legacy alias kept for any old code
  app.get('/api/camera/latest', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, image_b64, created_at FROM camera_frames ORDER BY created_at DESC LIMIT 1'
      );
      if (!rows.length) return res.json({ photo: null });
      res.json({ photo: rows[0].image_b64, captured_at: rows[0].created_at });
    } catch (err) {
      res.status(500).json({ photo: null });
    }
  });
  
  // ─── Camera: list plant diagnoses ──────────────────────────────────
  app.get('/api/diagnoses', async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, health_score, status, summary, issues, recommendations, alerts, plant_suggested, created_at
         FROM plant_diagnoses ORDER BY created_at DESC LIMIT 20`
      );
      res.json(rows);
    } catch (err) {
      console.error('[GET /api/diagnoses]', err.message);
      res.status(500).json([]);
    }
  });
  
  // ─── Camera: re-run AI diagnosis on latest stored frame ───────────
  app.post('/api/diagnoses/run', async (req, res) => {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({ error: 'Gemini API not configured — add GEMINI_API_KEY' });
    }
    try {
      const { rows } = await pool.query(
        'SELECT image_b64 FROM camera_frames ORDER BY created_at DESC LIMIT 1'
      );
      if (!rows.length) {
        return res.status(404).json({ error: 'No frames stored yet — wait for the camera to send one' });
      }
      const result = await diagnosePlant(rows[0].image_b64);
      res.json(result);
    } catch (err) {
      console.error('[DIAGNOSES RUN]', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerCameraRoutes };
