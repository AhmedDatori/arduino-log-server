import React from 'react';

// ─── Gauge SVG ─────────────────────────────────────────────────────
const CIRC   = 263.9;
const MAXARC = 197.9;

function Gauge({ pct, color }) {
  const clamped = Math.min(100, Math.max(0, isNaN(pct) ? 0 : pct));
  const arc     = (MAXARC * clamped / 100).toFixed(1);
  const gap     = (CIRC - parseFloat(arc)).toFixed(1);

  return (
    <svg viewBox="0 0 120 120" width="100" height="100">
      {/* Background track */}
      <circle
        r="42" cx="60" cy="60"
        fill="none" stroke="#0f1e2e" strokeWidth="9"
        strokeDasharray="197.9 66.0"
        transform="rotate(135 60 60)"
        strokeLinecap="round"
      />
      {/* Filled arc */}
      <circle
        r="42" cx="60" cy="60"
        fill="none" stroke={color} strokeWidth="9"
        strokeDasharray={`${arc} ${gap}`}
        transform="rotate(135 60 60)"
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
    </svg>
  );
}

function StatusBadge({ label, color }) {
  return (
    <span
      className="status-badge"
      style={{ color, borderColor: color, background: `${color}18` }}
    >
      {label}
    </span>
  );
}

// ─── Gauge-style card (water, soil, light) ─────────────────────────
export function GaugeCard({ icon, label, displayValue, pct, info }) {
  return (
    <div className="sensor-card" style={{ '--accent': info.color }}>
      <div className="card-icon">{icon}</div>
      <div className="card-label">{label}</div>
      <div className="gauge-wrap">
        <Gauge pct={pct} color={info.color} />
        <div className="gauge-center">
          <span className="gauge-val" style={{ color: info.color }}>
            {displayValue ?? '—'}
          </span>
        </div>
      </div>
      <StatusBadge label={info.label} color={info.color} />
    </div>
  );
}

// ─── Big number card (temperature, humidity) ───────────────────────
export function BigCard({ icon, label, value, unit, info }) {
  return (
    <div className="sensor-card" style={{ '--accent': info.color }}>
      <div className="card-icon">{icon}</div>
      <div className="card-label">{label}</div>
      <div className="bignum-wrap">
        {value === null || value === undefined ? (
          <span className="num-na">N/A</span>
        ) : (
          <>
            <span className="num-val" style={{ color: info.color }}>
              {value.toFixed(1)}
            </span>
            <span className="num-unit">{unit}</span>
          </>
        )}
      </div>
      <StatusBadge label={info.label} color={info.color} />
    </div>
  );
}
