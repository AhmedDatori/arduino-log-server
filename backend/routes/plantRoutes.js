'use strict';

function registerPlantRoutes(app, { pool }) {
  app.get('/api/plants', async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT * FROM plant_profiles ORDER BY is_preset DESC, id ASC'
      );
      res.json(rows);
    } catch (err) {
      res.status(500).json([]);
    }
  });
  
  app.post('/api/plants/:id/select', async (req, res) => {
    try {
      await pool.query('UPDATE plant_profiles SET is_active = FALSE');
      await pool.query('UPDATE plant_profiles SET is_active = TRUE WHERE id = $1', [req.params.id]);
      const { rows } = await pool.query('SELECT * FROM plant_profiles WHERE id = $1', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      console.log(`[PLANT] Active plant: ${rows[0].emoji} ${rows[0].name}`);
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.post('/api/plants', async (req, res) => {
    try {
      const { name, emoji, soil_min, soil_max, temp_min, temp_max, hum_min, hum_max, light_min, light_max, notes } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
      const { rows } = await pool.query(
        `INSERT INTO plant_profiles (name, emoji, soil_min, soil_max, temp_min, temp_max, hum_min, hum_max, light_min, light_max, notes, is_preset)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE) RETURNING *`,
        [name.trim(), emoji || '🌱',
         Number(soil_min)||30, Number(soil_max)||70,
         Number(temp_min)||15, Number(temp_max)||30,
         Number(hum_min)||40,  Number(hum_max)||70,
         Number(light_min)||30, Number(light_max)||80,
         notes?.trim() || null]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.put('/api/plants/:id', async (req, res) => {
    try {
      const { rows: check } = await pool.query('SELECT is_preset FROM plant_profiles WHERE id = $1', [req.params.id]);
      if (!check.length) return res.status(404).json({ error: 'Not found' });
      if (check[0].is_preset) return res.status(403).json({ error: 'Preset plants cannot be edited' });
      const { name, emoji, soil_min, soil_max, temp_min, temp_max, hum_min, hum_max, light_min, light_max, notes } = req.body;
      const { rows } = await pool.query(
        `UPDATE plant_profiles SET name=$1, emoji=$2, soil_min=$3, soil_max=$4, temp_min=$5, temp_max=$6,
         hum_min=$7, hum_max=$8, light_min=$9, light_max=$10, notes=$11 WHERE id=$12 RETURNING *`,
        [name.trim(), emoji || '🌱',
         Number(soil_min), Number(soil_max),
         Number(temp_min), Number(temp_max),
         Number(hum_min),  Number(hum_max),
         Number(light_min), Number(light_max),
         notes?.trim() || null, req.params.id]
      );
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.delete('/api/plants/:id', async (req, res) => {
    try {
      const { rows: check } = await pool.query('SELECT is_preset FROM plant_profiles WHERE id = $1', [req.params.id]);
      if (!check.length) return res.status(404).json({ error: 'Not found' });
      if (check[0].is_preset) return res.status(403).json({ error: 'Preset plants cannot be deleted' });
      await pool.query('DELETE FROM plant_profiles WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerPlantRoutes };
