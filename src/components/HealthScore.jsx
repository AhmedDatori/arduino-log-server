import React, { useState, useEffect, useCallback } from 'react';
import { fetchHealth, refreshHealth } from '../api';
import { ago } from '../utils';
import './HealthScore.css';

const SENSORS = [
  { key: 'soil',  icon: '🌿', label: 'Soil Moisture' },
  { key: 'water', icon: '💧', label: 'Water Level'   },
  { key: 'light', icon: '☀️', label: 'Light'          },
  { key: 'temp',  icon: '🌡️', label: 'Temperature'   },
  { key: 'hum',   icon: '💦', label: 'Humidity'      },
];

function scoreColor(score) {
  if (score >= 75) return '#3dffa0';
  if (score >= 50) return '#f5a524';
  if (score >= 25) return '#ff8c42';
  return '#ff4d6d';
}

function scoreLabel(score) {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Poor';
  return 'Critical';
}

// SVG circular gauge
function CircleGauge({ score }) {
  const R   = 54;
  const C   = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(100, score ?? 0));
  const arc = C * (1 - pct / 100);
  const color = scoreColor(pct);

  return (
    <svg viewBox="0 0 128 128" className="health-gauge-svg">
      {/* track */}
      <circle cx="64" cy="64" r={R} fill="none" stroke="#0f1e2e" strokeWidth="10" />
      {/* progress */}
      <circle
        cx="64" cy="64" r={R}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={arc}
        transform="rotate(-90 64 64)"
        style={{ transition: 'stroke-dashoffset 1s ease, stroke .5s ease', filter: `drop-shadow(0 0 8px ${color}88)` }}
      />
      {/* score number */}
      <text x="64" y="60" textAnchor="middle" dominantBaseline="middle"
        fill={color}
        style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 26, fontWeight: 700 }}>
        {score ?? '—'}
      </text>
      <text x="64" y="82" textAnchor="middle"
        fill="#4a6080"
        style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 11 }}>
        / 100
      </text>
    </svg>
  );
}

export default function HealthScore() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const h = await fetchHealth();
      setData(h);
    } catch {
      // ignore — no score yet, empty state is shown
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const h = await refreshHealth();
      setData(h);
    } catch {
      // ignore — score stays as-is, user can retry
    } finally {
      setRefreshing(false);
    }
  };

  const score     = data?.score   ?? null;
  const color     = scoreColor(score ?? 0);
  const breakdown = data?.breakdown ?? {};

  return (
    <div className="health-card">
      {/* Header row */}
      <div className="health-header">
        <div className="health-title">
          <span className="health-icon">🌱</span>
          <span>Plant Health Score</span>
        </div>
        <div className="health-meta">
          {data?.created_at && (
            <span className="health-updated">Updated {ago(data.created_at)}</span>
          )}
          <button
            className="health-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh score now"
          >
            {refreshing ? '⏳' : '↻'} {refreshing ? 'Analyzing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="health-loading">Checking plant health…</div>
      ) : score === null ? (
        <div className="health-loading">
          No score yet — click Refresh to analyze
        </div>
      ) : (
        <div className="health-body">
          {/* Left: gauge */}
          <div className="health-gauge-wrap">
            <CircleGauge score={score} />
            <div className="health-status-badge" style={{ color, borderColor: `${color}40`, background: `${color}0f` }}>
              {scoreLabel(score)}
            </div>
          </div>

          {/* Right: info + breakdown */}
          <div className="health-right">
            <p className="health-status-text" style={{ color }}>
              {data.status}
            </p>
            {data.advice && (
              <p className="health-advice">{data.advice}</p>
            )}

            <div className="health-breakdown">
              {SENSORS.map(({ key, icon, label }) => {
                const item  = breakdown[key];
                const pts   = item?.score ?? null;
                const note  = item?.note  ?? '';
                const pct   = pts !== null ? (pts / 20) * 100 : 0;
                const c     = scoreColor((pct / 100) * 100);
                return (
                  <div key={key} className="breakdown-row">
                    <span className="breakdown-icon">{icon}</span>
                    <div className="breakdown-track-wrap">
                      <div className="breakdown-labels">
                        <span className="breakdown-label">{label}</span>
                        <span className="breakdown-note">{note}</span>
                      </div>
                      <div className="breakdown-track">
                        <div
                          className="breakdown-fill"
                          style={{
                            width: `${pct}%`,
                            background: c,
                            boxShadow: `0 0 6px ${c}66`,
                          }}
                        />
                      </div>
                    </div>
                    <span className="breakdown-pts" style={{ color: c }}>
                      {pts ?? '—'}<span className="score-denom">/20</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
