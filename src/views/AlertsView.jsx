import React from 'react';
import { ackNotification, deleteNotifications } from '../api';
import './AlertsView.css';

const SEVERITY_ICONS = { danger: '🔴', warning: '🟡', info: '🔵' };

function AlertItem({ alert, onDismiss }) {
  const time = new Date(alert.created_at).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour:  '2-digit', minute: '2-digit',
  });

  return (
    <div className={`alert-item ${alert.severity} ${alert.acknowledged ? 'acked' : ''}`}>
      <span className="alert-icon">
        {SEVERITY_ICONS[alert.severity] ?? SEVERITY_ICONS.warning}
      </span>
      <div className="alert-body">
        <p className="alert-msg">{alert.message}</p>
        <p className="alert-meta">
          {time}
          {alert.acknowledged && ' · Dismissed'}
        </p>
      </div>
      {!alert.acknowledged && (
        <button className="btn-ack" onClick={() => onDismiss(alert.id)}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export default function AlertsView({ alerts, onAlertsChanged }) {
  const handleDismiss = async (id) => {
    await ackNotification(id);
    onAlertsChanged();
  };

  const handleClearAll = async () => {
    if (!confirm('Clear all alerts?')) return;
    await deleteNotifications();
    onAlertsChanged();
  };

  return (
    <div className="view-wrap">

      <div className="view-header">
        <h2 className="section-title">🔔 Alerts</h2>
        <button className="btn-danger" onClick={handleClearAll}>🗑 Clear All</button>
      </div>

      {alerts.length === 0 ? (
        <div className="alerts-empty">
          <span style={{ fontSize: '2.5rem' }}>✅</span>
          <p>All clear — no alerts right now</p>
        </div>
      ) : (
        alerts.map(alert => (
          <AlertItem key={alert.id} alert={alert} onDismiss={handleDismiss} />
        ))
      )}

    </div>
  );
}
