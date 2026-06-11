# Dashboard Insight Prompts

Purpose: turn greenhouse history into readable advice and diagnostics.

Prompt families:
- Health score: converts latest readings into a 0-100 plant health score.
- Daily report: summarizes the last 24 hours for a plant owner.
- Predictions: forecasts likely stress events from recent trends.
- Root cause: explains why health is improving or declining.
- Experiments: suggests and evaluates A/B growing strategies.
- Hardware diagnostics: checks whether sensors, pump, tank, or tubing may be failing.
- Sensor fusion: explains relationships between readings that are not obvious from one sensor alone.

Code owners:
- `backend/routes/plantIntelligenceRoutes.js`
- `backend/routes/aiInsightRoutes.js`
