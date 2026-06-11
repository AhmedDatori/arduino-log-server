# Backend Folder Map

This folder contains the Node/Express backend for the greenhouse dashboard.

Start with `ROUTE_MAP.md` when you want to know which file owns a feature.

## Plain-English Structure

- `config.js` reads deployment settings such as the port, database connection, and Gemini model.
- `database/` owns the PostgreSQL connection and creates/migrates all tables when the server starts.
- `services/` contains reusable greenhouse logic, such as reading actuator state, scheduling pump shutoff, and running autopilot decisions.
- `routes/` contains HTTP endpoints. Each file is named after the dashboard area or device it supports.
- `ai/` contains the Gemini API wrapper used by all AI features.
- `jobs/` contains background tasks that run on timers, such as alert checks and hourly plant diagnosis.
- `utils/` contains small pure helper functions.
- `agent-prompts/` documents the AI prompt responsibilities in human-readable form.

## Quick Health Check

Run this after backend edits:

```bash
npm run check:backend
npm run build
```

## Request Flow

1. ESP32 posts sensor readings to `POST /log`.
2. `routes/sensorAndControlRoutes.js` stores the reading and returns the latest actuator commands.
3. If autopilot is enabled, `services/autopilot.js` decides whether to run the pump, light, buzzer, or fan.
4. The React dashboard uses `/api/...` routes to show history, camera frames, alerts, reports, and AI analysis.
