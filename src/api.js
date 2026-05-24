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

// ─── Notifications ─────────────────────────────────────────────────
export const fetchNotifications  = () => request('/api/notifications');
export const deleteNotifications = () => request('/api/notifications', { method: 'DELETE' });
export const ackNotification     = (id) =>
  request(`/api/notifications/${id}/ack`, { method: 'POST' });
