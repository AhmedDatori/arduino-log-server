# Backend Route Map

This file explains which backend file owns each part of the greenhouse system.

## Device And Dashboard Basics

- `routes/sensorAndControlRoutes.js`
  - Receives ESP32 sensor logs with `POST /log`.
  - Returns recent logs with `GET /api/logs`.
  - Stores and returns actuator state with `/api/state` and `/api/control`.

- `routes/cameraRoutes.js`
  - Receives ESP32-CAM frames with `POST /camera/frame`.
  - Stores the camera IP with `POST /camera/register`.
  - Returns the latest frame, timeline frames, and AI photo diagnoses.

## Plant And Automation

- `routes/plantRoutes.js`
  - Creates, edits, selects, and deletes plant profiles.

- `routes/modeAndAutopilotRoutes.js`
  - Switches between manual, rules, and AI autopilot modes.
  - Runs autopilot manually and returns autopilot history.

- `services/autopilot.js`
  - Contains the rules engine and AI autopilot decision flow.
  - Does not define HTTP routes directly.

## AI Features

- `routes/plantIntelligenceRoutes.js`
  - Creates health scores.
  - Generates daily reports.
  - Runs camera-based plant diagnosis.

- `routes/aiInsightRoutes.js`
  - Forecasts stress events.
  - Explains root causes.
  - Manages experiments.
  - Builds personalized plant-care models.
  - Tracks token usage.
  - Runs sensor-fusion and hardware diagnostics.

- `ai/geminiClient.js`
  - Sends all Gemini requests.
  - Extracts JSON responses.
  - Logs token usage.

- `agent-prompts/`
  - Plain-English explanations of what each AI prompt is responsible for.

## Alerts And Background Work

- `routes/alertAndConversationRoutes.js`
  - Returns and clears alerts.
  - Returns and clears AI chat conversation history.
  - Provides the notification checker used by scheduled jobs.

- `jobs/scheduledJobs.js`
  - Starts repeating jobs for alerts, health score refresh, daily reports, and camera diagnosis.

## Database And Settings

- `database/index.js`
  - Owns the PostgreSQL connection.
  - Creates and migrates database tables at startup.

- `config.js`
  - Reads environment variables for port, database, and Gemini model.
