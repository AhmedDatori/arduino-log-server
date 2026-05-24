// ─── All API calls to the Express backend ─────────────────────────

async function request(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${url} → ${res.status}`);
  return res.json();
}

function formBody(data) {
  const params = new URLSearchParams();
  Object.entries(data).forEach(([k, v]) => params.append(k, String(v)));
  return params;
}

// ─── Logs ──────────────────────────────────────────────────────────
export const fetchLogs    = () => request('/api/logs');
export const deleteLogs   = () => request('/api/logs', { method: 'DELETE' });

// ─── Actuators ─────────────────────────────────────────────────────
export const fetchState   = () => request('/api/state');
export const postControl  = (device, value) =>
  request('/api/control', { method: 'POST', body: formBody({ device, value }) });

// ─── Chat ──────────────────────────────────────────────────────────
export const fetchConversations  = () => request('/api/conversations');
export const deleteConversations = () => request('/api/conversations', { method: 'DELETE' });

// Chat returns JSON even on error (the error field shows the real reason)
export async function sendChatMessage(message) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    body:   formBody({ message }),
  });
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  return data; // caller reads data.response or data.error
}

// ─── Plants ────────────────────────────────────────────────────────
export const fetchPlants  = () => request('/api/plants');
export const selectPlant  = (id) => request(`/api/plants/${id}/select`, { method: 'POST' });
export const deletePlant  = (id) => request(`/api/plants/${id}`, { method: 'DELETE' });
export const createPlant  = (data) => request('/api/plants', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
export const updatePlant  = (id, data) => request(`/api/plants/${id}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

// ─── Reports ───────────────────────────────────────────────────────
export const fetchReports    = () => request('/api/reports');
export const generateReport  = () => request('/api/reports/generate', { method: 'POST' });

// ─── Health Score ──────────────────────────────────────────────────
export const fetchHealth   = () => request('/api/health');
export const refreshHealth = () => request('/api/health/refresh', { method: 'POST' });

// ─── Notifications ─────────────────────────────────────────────────
export const fetchNotifications  = () => request('/api/notifications');
export const deleteNotifications = () => request('/api/notifications', { method: 'DELETE' });
export const ackNotification     = (id) =>
  request(`/api/notifications/${id}/ack`, { method: 'POST' });

// ─── Autopilot / Mode ─────────────────────────────────────────────
export const fetchMode = () => request('/api/mode');
export const setMode   = (mode) => request('/api/mode', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json' },
  body:    JSON.stringify({ mode }),
});
export const fetchAutopilotLog = () => request('/api/autopilot/log');
export const triggerAutopilot  = () => request('/api/autopilot/run', { method: 'POST' });

// ─── Predictions ───────────────────────────────────────────────────
export const fetchPredictions    = ()  => request('/api/predictions');
export const refreshPredictions  = ()  => request('/api/predictions/refresh', { method: 'POST' });

// ─── Root Cause Analysis ───────────────────────────────────────────
export const fetchRootCause      = ()  => request('/api/root-cause');
export const refreshRootCause    = ()  => request('/api/root-cause/refresh', { method: 'POST' });

// ─── Experiments ───────────────────────────────────────────────────
export const fetchExperiments  = ()     => request('/api/experiments');
export const createExperiment  = (data) => request('/api/experiments', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});
export const endExperiment     = (id)   => request(`/api/experiments/${id}/end`, { method: 'POST' });
export const deleteExperiment  = (id)   => request(`/api/experiments/${id}`, { method: 'DELETE' });

// ─── Plant Care Model ─────────────────────────────────────────────
export const fetchPlantModel   = ()  => request('/api/plant-model');
export const refreshPlantModel = ()  => request('/api/plant-model/refresh', { method: 'POST' });

// ─── Token Usage ──────────────────────────────────────────────────
export const fetchTokenUsage  = () => request('/api/token-usage');
export const clearTokenUsage  = () => request('/api/token-usage', { method: 'DELETE' });
