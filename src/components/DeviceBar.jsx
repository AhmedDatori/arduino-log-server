import React from 'react';
import { ago } from '../utils';

export default function DeviceBar({ latest, total }) {
  const isOnline = latest
    ? (Date.now() - new Date(latest.time).getTime()) < 60_000
    : false;

  return (
    <div className="device-bar">
      <div className="device-bar-inner">

        <div className="db-item">
          <span className={`status-dot ${isOnline ? 'online' : 'offline'}`} />
          <span className="db-label">Status</span>
          <span className={`db-val ${isOnline ? 'green' : 'amber'}`}>
            {!latest
              ? 'Waiting for Arduino...'
              : isOnline
              ? 'Online'
              : `Offline — last seen ${ago(latest.time)}`}
          </span>
        </div>

        {latest && (
          <>
            <div className="db-item">
              <span className="db-label">Device</span>
              <span className="db-val">{latest.device}</span>
            </div>
            <div className="db-item">
              <span className="db-label">Last Seen</span>
              <span className="db-val">{ago(latest.time)}</span>
            </div>
          </>
        )}

        <div className="db-item">
          <span className="db-label">Logs</span>
          <span className="db-val">{total}</span>
        </div>

      </div>
    </div>
  );
}
