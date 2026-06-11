# Camera Diagnosis Prompt

Purpose: inspect the latest ESP32-CAM photo and summarize visible plant health.

Inputs:
- Latest JPEG frame stored by `/camera/frame`.
- Active plant profile and ideal environmental ranges.

Expected output:
- Health score from 0 to 100.
- Status such as healthy, fair, stressed, or critical.
- Visible issues, recommendations, and urgent alerts.

Code owner: `backend/routes/plantIntelligenceRoutes.js`.
