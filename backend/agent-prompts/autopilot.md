# Autopilot Prompt

Purpose: decide whether the greenhouse should change any actuator state.

Inputs:
- Current soil moisture, water level, light, temperature, and humidity.
- Current actuator state: pump, grow light, buzzer, and fan.
- Active plant profile and ideal ranges.
- Running experiment context when experiment mode is active.

Safety rules:
- Never run the pump if water level is below 200.
- Pump duration must stay between 1 and 30 seconds.
- Use the buzzer only for critical temperature alerts.
- Return `null` for actuators that should not change.

Code owner: `backend/services/autopilot.js`.
