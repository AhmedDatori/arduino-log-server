'use strict';

function registerChatRoutes(app, { pool, stateService, actuatorService, aiClient }) {
  const { getActuatorState, getActivePlant } = stateService;
  const { schedulePumpOff } = actuatorService;
  const { callGemini } = aiClient;

  app.post('/api/chat', async (req, res) => {
    try {
      const message = String(req.body.message || '').trim();
      if (!message) return res.status(400).json({ error: 'Empty message' });
  
      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({
          error: 'AI not configured — add GEMINI_API_KEY in Hostinger → Node.js → Environment Variables.',
        });
      }
  
      const [logsResult, state, historyResult, plant] = await Promise.all([
        pool.query('SELECT * FROM logs ORDER BY time DESC LIMIT 5'),
        getActuatorState(),
        pool.query('SELECT role, content FROM conversations ORDER BY created_at DESC LIMIT 30'),
        getActivePlant(),
      ]);
  
      const latest       = logsResult.rows[0];
      const systemPrompt = buildSystemPrompt(latest, state, plant);
  
      // Build strictly alternating user/model history for Gemini
      const history = [];
      let lastRole = null;
      for (const row of [...historyResult.rows].reverse()) {
        const role = row.role === 'assistant' ? 'model' : 'user';
        if (role !== lastRole) {
          history.push({ role, parts: [{ text: row.content }] });
          lastRole = role;
        }
      }
  
      // Save user message before calling Gemini
      await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', ['user', message]);
  
      const rawReply = (await callGemini(message, {
        systemPrompt,
        history,
        maxOutputTokens: 600,
        temperature:     0.7,
        endpoint:        'chat',
      })) || 'No response from AI.';
  
      // Extract optional action suggestion from reply
      const { text: reply, action } = extractChatAction(rawReply);
  
      await pool.query('INSERT INTO conversations (role, content) VALUES ($1, $2)', ['assistant', reply]);
      res.json({ response: reply, action: action ?? null });
    } catch (err) {
      const status = err.geminiError ? 502 : 500;
      console.error('[POST /api/chat]', err.message);
      res.status(status).json({ error: err.message });
    }
  });
  
  function buildSystemPrompt(latest, state, plant) {
    let p = 'You are a concise AI assistant for an Arduino IoT plant monitoring system.\n\n';
  
    if (plant) {
      p += `Currently monitoring: ${plant.emoji} ${plant.name}\n`;
      p += `Ideal conditions for ${plant.name}:\n`;
      p += `  Soil moisture: ${plant.soil_min}–${plant.soil_max}%\n`;
      p += `  Temperature:   ${plant.temp_min}–${plant.temp_max}°C\n`;
      p += `  Humidity:      ${plant.hum_min}–${plant.hum_max}%\n`;
      p += `  Light:         ${plant.light_min}–${plant.light_max}%\n`;
      if (plant.notes) p += `  Notes: ${plant.notes}\n`;
      p += '\n';
    }
  
    if (latest) {
      p += 'Current sensor readings:\n';
      p += `  Water level:   ${latest.water ?? 'N/A'} (raw 0-1023, <200=empty)\n`;
      p += `  Soil moisture: ${latest.soil  ?? 'N/A'}%\n`;
      p += `  Light:         ${latest.light ?? 'N/A'}%\n`;
      p += `  Temperature:   ${latest.temp  ?? 'N/A'}°C\n`;
      p += `  Humidity:      ${latest.hum   ?? 'N/A'}%\n`;
      p += `  Recorded at:   ${latest.time}\n\n`;
    }
  
    p += `Actuators: Light=${state.light?'ON':'OFF'}, Pump=${state.pump?'ON':'OFF'}, Buzzer=${state.buzzer?'ON':'OFF'}, Fan=${state.fan?'ON':'OFF'}\n\n`;
    p += 'Be brief and practical.';
    if (plant) p += ` Always compare readings against the ideal ranges for ${plant.name} and give plant-specific advice.`;
    p += `\n\nDEVICE CONTROL: If the user asks you to perform a device action OR if sensor data clearly requires immediate intervention, you may suggest one action. Append this block at the VERY END of your reply on its own line (no other text after it):
  [ACTION:{"type":"pump","value":true,"pump_duration_seconds":8,"label":"Run pump for 8 seconds","confirm_text":"Activate the water pump for 8 seconds to hydrate the soil."}]
  Valid types: "pump" (value always true, pump_duration_seconds 1-30), "light" (value true/false), "buzzer" (value true/false), "fan" (value true/false).
  ONLY include this block when the user explicitly asks you to control something, or when a sensor reading is critically wrong and requires immediate action. Never include it for general advice.`;
    return p;
  }
  
  // ─── Chat action helper ────────────────────────────────────────────
  function extractChatAction(text) {
    const match = text.match(/\[ACTION:(\{[\s\S]*?\})\]/);
    if (!match) return { text: text.trim(), action: null };
    try {
      const action   = JSON.parse(match[1]);
      const cleanText = text.replace(/\[ACTION:[\s\S]*?\]/, '').trim();
      return { text: cleanText, action };
    } catch {
      return { text: text.trim(), action: null };
    }
  }
  
  // ─── Chat action execution endpoint ───────────────────────────────
  app.post('/api/chat/action', async (req, res) => {
    try {
      const { type, value, pump_duration_seconds } = req.body;
      if (!['pump', 'light', 'buzzer', 'fan'].includes(type)) {
        return res.status(400).json({ error: 'Invalid device type' });
      }
      if (type === 'pump') {
        const sec = await schedulePumpOff(pump_duration_seconds ?? 8);
        await pool.query('UPDATE actuator_state SET pump = TRUE, updated_at = NOW() WHERE id = 1');
        console.log(`[CHAT-ACTION] Pump ON for ${sec}s (AI-recommended)`);
        return res.json({ success: true, message: `Pump activated for ${sec} seconds` });
      }
      const on = value === true || value === 'true' || value === 1;
      await pool.query(`UPDATE actuator_state SET ${type} = $1, updated_at = NOW() WHERE id = 1`, [on]);
      console.log(`[CHAT-ACTION] ${type.toUpperCase()} → ${on ? 'ON' : 'OFF'}`);
      res.json({ success: true, message: `${type} turned ${on ? 'ON' : 'OFF'}` });
    } catch (err) {
      console.error('[POST /api/chat/action]', err.message);
      res.status(500).json({ error: err.message });
    }
  });
}

module.exports = { registerChatRoutes };
