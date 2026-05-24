import React, { useState, useEffect, useCallback } from 'react';
import { fetchAutopilotLog, triggerAutopilot } from '../api';
import { ago } from '../utils';
import './AutopilotStatus.css';

const RISK_META = {
  low:      { color: '#3dffa0', bg: 'rgba(61,255,160,.06)',  border: 'rgba(61,255,160,.18)'  },
  medium:   { color: '#f5a524', bg: 'rgba(245,165,36,.06)',  border: 'rgba(245,165,36,.18)'  },
  high:     { color: '#ff4d6d', bg: 'rgba(255,77,109,.06)',  border: 'rgba(255,77,109,.18)'  },
  critical: { color: '#ff4d6d', bg: 'rgba(255,77,109,.12)',  border: 'rgba(255,77,109,.4)'   },
};

const ACTION_ICONS = { light: '💡', pump: '💧', buzzer: '🔔' };

function ActionChip({ name, value }) {
  if (value === null || value === undefined) return null;
  if (name === 'pump_duration_seconds') return null;
  return (
    <span className={`ap-action-chip ${value ? 'on' : 'off'}`}>
      {ACTION_ICONS[name] || '•'} {name} {value ? 'ON' : 'OFF'}
    </span>
  );
}

export default function AutopilotStatus({ mode }) {
  const [log,     setLog]     = useState([]);
  const [running, setRunning] = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchAutopilotLog();
      setLog(data);
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRun = async () => {
    if (running) return;
    setRunning(true);
    setError('');
    try {
      await triggerAutopilot();
      await load();
    } catch (err) {
      setError(err.message || 'Failed to run autopilot');
    } finally {
      setRunning(false);
    }
  };

  const isActive = mode !== 'manual';
  const last = log[0] ?? null;
  const m = last ? (RISK_META[last.risk_level] ?? RISK_META.low) : null;

  return (
    <div className="ap-card">
      <div className="ap-header">
        <div className="ap-title">
          <span className={`ap-dot ${isActive ? 'active' : ''}`} />
          Last Decision
        </div>
        {isActive && (
          <button className="ap-run-btn" onClick={handleRun} disabled={running}>
            {running ? '⟳ Running…' : '▶ Run Now'}
          </button>
        )}
      </div>

      {error && <div className="ap-error">{error}</div>}

      {!isActive ? (
        <div className="ap-inactive">
          Manual mode active — switch to <strong>Rules</strong> or <strong>AI Pilot</strong> to enable the autopilot
        </div>
      ) : !last ? (
        <div className="ap-inactive">
          No decisions logged yet — waiting for next sensor reading…
        </div>
      ) : (
        <div className="ap-last" style={{ background: m.bg, borderColor: m.border }}>
          <div className="ap-last-top">
            <span className="ap-mode-chip">
              {last.mode === 'ai' ? '🤖 AI Pilot' : '⚙️ Rules'}
            </span>
            <span className="ap-risk" style={{ color: m.color }}>
              {last.risk_level.toUpperCase()}
            </span>
            <span className="ap-ago">{ago(last.created_at)}</span>
          </div>
          <p className="ap-analysis">{last.analysis}</p>
          {last.reasoning && last.reasoning !== last.analysis && (
            <p className="ap-reasoning">{last.reasoning}</p>
          )}
          {last.actions && (
            <div className="ap-actions-row">
              {Object.entries(last.actions).map(([k, v]) => (
                <ActionChip key={k} name={k} value={v} />
              ))}
            </div>
          )}
        </div>
      )}

      {log.length > 1 && (
        <div className="ap-history">
          <div className="ap-history-label">Recent decisions</div>
          {log.slice(1, 5).map(entry => {
            const em = RISK_META[entry.risk_level] ?? RISK_META.low;
            return (
              <div key={entry.id} className="ap-history-row">
                <span className="ap-history-dot" style={{ background: em.color }} />
                <span className="ap-history-mode">
                  {entry.mode === 'ai' ? '🤖' : '⚙️'}
                </span>
                <span className="ap-history-analysis">{entry.analysis.slice(0, 80)}{entry.analysis.length > 80 ? '…' : ''}</span>
                <span className="ap-history-ago">{ago(entry.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
