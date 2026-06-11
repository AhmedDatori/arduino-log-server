import React from 'react';
import { ago, waterInfo, soilInfo, lightInfo, tempInfo, humInfo } from '../utils';
import { deleteLogs } from '../api';
import './HistoryView.css';

// Color class from hex color
function colorClass(color) {
  const map = { '#3dffa0': 'cv-g', '#f5a524': 'cv-a', '#ff4d6d': 'cv-r', '#38b2f8': 'cv-b' };
  return map[color] ?? 'cv-m';
}

function WaterCell({ value }) {
  if (value === null || value === undefined) return <span className="cv-m">—</span>;
  const info = waterInfo(value);
  return <span className={colorClass(info.color)}>{info.label}</span>;
}

function NumCell({ value, infoFn, suffix = '' }) {
  if (value === null || value === undefined) return <span className="cv-m">—</span>;
  const info    = infoFn(value);
  const display = typeof value === 'number' && !Number.isInteger(value)
    ? value.toFixed(1)
    : value;
  return <span className={colorClass(info.color)}>{display}{suffix}</span>;
}

export default function HistoryView({ logs, onLogsCleared }) {
  const handleClear = async () => {
    if (!confirm('Delete all logs? This cannot be undone.')) return;
    await deleteLogs();
    onLogsCleared();
  };

  return (
    <div className="view-wrap">

      <div className="view-header">
        <h2 className="section-title">📈 Log History</h2>
        <button className="btn-danger" onClick={handleClear}>🗑 Clear All</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Time</th>
              <th>Device</th>
              <th>Water</th>
              <th>Soil</th>
              <th>Light</th>
              <th>Temp</th>
              <th>Humidity</th>
            </tr>
          </thead>
          <tbody>
            {logs.length === 0 ? (
              <tr>
                <td colSpan="8" className="empty-cell">No logs yet — waiting for Arduino</td>
              </tr>
            ) : (
              logs.map((log, i) => {
                const t = new Date(log.time);
                return (
                  <tr key={log.id}>
                    <td className="cell-num">{i + 1}</td>
                    <td className="cell-time">
                      {t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      <span className="cell-ago">{ago(log.time)}</span>
                    </td>
                    <td className="cell-dev">{log.device}</td>
                    <td><WaterCell value={log.water} /></td>
                    <td><NumCell  value={log.soil}  infoFn={soilInfo}  suffix="%" /></td>
                    <td><NumCell  value={log.light} infoFn={lightInfo} suffix="%" /></td>
                    <td><NumCell  value={log.temp}  infoFn={tempInfo}  suffix="°" /></td>
                    <td><NumCell  value={log.hum}   infoFn={humInfo}   suffix="%" /></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
