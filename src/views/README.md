# Views

Views are full pages in the Smart Green House dashboard.

- `StatusView.jsx` is the main live dashboard with sensors, controls, health score, autopilot, forecast, and LED color.
- `HistoryView.jsx` shows recent sensor logs.
- `CameraView.jsx` shows ESP32-CAM frames and visual plant diagnoses.
- `ReportsView.jsx` shows daily AI reports.
- `PlantsView.jsx` manages plant profiles and ideal growing ranges.
- `ChatView.jsx` provides AI chat and suggested actions.
- `AlertsView.jsx` shows warnings and alerts.
- `LabView.jsx` groups advanced AI tools: hardware checks, root cause, experiments, and plant model.
- `UsageView.jsx` shows Gemini token usage.

Each view keeps its own CSS file next to it.
