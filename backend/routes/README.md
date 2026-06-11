# Routes

Route files define the HTTP API used by the ESP32 devices and the React dashboard.

- `sensorAndControlRoutes.js` receives sensor logs and controls hardware state.
- `cameraRoutes.js` receives ESP32-CAM frames and returns camera history.
- `plantRoutes.js` manages plant profiles and ideal sensor ranges.
- `modeAndAutopilotRoutes.js` controls manual, rules, and AI autopilot modes.
- `chatRoutes.js` handles AI chat and AI-recommended actuator actions.
- `alertAndConversationRoutes.js` handles alerts and saved chat history.
- `plantIntelligenceRoutes.js` handles health scores, daily reports, and camera plant diagnosis.
- `aiInsightRoutes.js` handles advanced AI tools: predictions, root cause, experiments, plant model, token usage, sensor fusion, and hardware diagnostics.

When adding a new endpoint, choose the route file by user-facing feature. If it grows too large, create a new route file with a clear name and register it in `../app.js`.
