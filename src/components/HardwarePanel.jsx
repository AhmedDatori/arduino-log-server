import React, { useState, useEffect, useCallback } from 'react';
import { fetchHardware, refreshHardware } from '../api';
import './HardwarePanel.css';

// ── Constants ──────────────────────────────────────────────────────────────
const RISK_CFG = {
  critical: { color: '#ff4d6d', bg: 'rgba(255,77,109,.09)', border: 'rgba(255,77,109,.45)', pulse: true  },
  high:     { color: '#ff4d6d', bg: 'rgba(255,77,109,.06)', border: 'rgba(255,77,109,.3)',  pulse: false },
  medium:   { color: '#f5a524', bg: 'rgba(245,165,36,.06)', border: 'rgba(245,165,36,.28)', pulse: false },
  low:      { color: '#38b2f8', bg: 'rgba(56,178,248,.05)', border: 'rgba(56,178,248,.22)', pulse: false },
};

const STATUS_CFG = {
  healthy:  { label: 'All Systems Normal', color: '#3dffa0', icon: '✅' },
  warning:  { label: 'Attention Required', color: '#f5a524', icon: '⚠️' },
  critical: { label: 'Critical Issues',    color: '#ff4d6d', icon: '🚨' },
  unknown:  { label: 'Insufficient Data',  color: '#4a6080', icon: '❓' },
};

const COMPONENT_ICONS = {
  'Pump':             '💧',
  'Soil Sensor':      '🌿',
  'Water Sensor':     '🪣',
  'Light Sensor':     '☀️',
  'Temp Sensor':      '🌡️',
  'Humidity Sensor':  '💦',
  'Relay':            '⚡',
  'Water Tank':       '🚰',
  'Tubing':           '🔧',
};

// ── Single risk card ───────────────────────────────────────────────────────
function RiskCard({ risk }) {
  const [expanded, setExpanded] = useState(risk.risk_level === 'critical');
  const cfg = RISK_CFG[risk.risk_level] ?? RISK_CFG.medium;
  const icon = COMPONENT_ICONS[risk.component] ?? '🔩';

  return (
    <div
      className={`hw-risk-card${cfg.pulse ? ' hw-pulse' : ''}`}
      style={{ '--risk-color': cfg.color, '--risk-bg': cfg.bg, '--risk-border': cfg.border }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Card header */}
      <div className="hw-risk-top">
        <span className="hw-risk-icon">{icon}</span>

        <div className="hw-risk-info">
          <span className="hw-risk-component">{risk.component}</span>
          <span className="hw-risk-title">{risk.title}</span>
        </div>

        <div className="hw-risk-right">
          <span
            className="hw-risk-badge"
            style={{ color: cfg.color, borderColor: cfg.color, background: cfg.bg }}
          >
            {risk.risk_level.toUpperCase()}
          </span>
          <span className="hw-risk-chevron">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Reason line always visible */}
      <p className="hw-risk-reason">{risk.reason}</p>

      {/* Expanded body */}
      {expanded && (
        <div className="hw-risk-body">
          {/* Evidence */}
          {risk.evidence && (
            <div className="hw-evidence">
              <span className="hw-evidence-label">📊 EVIDENCE</span>
              <span className="hw-evidence-text">{risk.evidence}</span>
            </div>
          )}

          {/* Possible causes */}
          {risk.possible_causes?.length > 0 && (
            <div className="hw-causes">
              <span className="hw-causes-label">🔍 POSSIBLE CAUSES</span>
              <ul className="hw-causes-list">
                {risk.possible_causes.map((c, i) => (
                  <li key={i} className="hw-cause-item">
                    <span className="hw-cause-bullet" style={{ background: cfg.color }} />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Diagnostic steps */}
          {risk.diagnostic_steps?.length > 0 && (
            <div className="hw-diag">
              <span className="hw-diag-label">🛠️ HOW TO VERIFY</span>
              {risk.diagnostic_steps.map((s, i) => (
                <div key={i} className="hw-diag-step">
                  <span className="hw-diag-num">{i + 1}</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function HardwarePanel() {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await fetchHardware());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshHardware(); await load(); }
    catch (err) { setError(err.message); }
    finally { setRefreshing(false); }
  };

  // ── Derive state ─────────────────────────────────────────────────
  const status  = data?.overall_status ?? 'unknown';
  const stCfg   = STATUS_CFG[status] ?? STATUS_CFG.unknown;
  const risks   = data?.risks ?? [];
  const healthy = data?.healthy_components ?? [];

  // Sort risks by severity (critical first)
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sortedRisks   = [...risks].sort((a, b) => (severityOrder[a.risk_level] ?? 9) - (severityOrder[b.risk_level] ?? 9));

  return (
    <div className="lab-panel hw-panel">
      {/* Header */}
      <div className="lab-panel-header">
        <div className="lab-panel-title">
          <span>🔧</span> Hardware Diagnostics
          <span className="lab-panel-sub">
            AI detects hardware failures from sensor patterns
          </span>
        </div>
        <div className="hw-header-right">
          {data && (
            <span
              className="hw-status-badge"
              style={{ color: stCfg.color, borderColor: stCfg.color, background: `${stCfg.color}12` }}
            >
              {stCfg.icon} {stCfg.label}
            </span>
          )}
          <button
            className="lab-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing || loading}
          >
            {refreshing ? '⟳ Scanning…' : '↻ Re-scan'}
          </button>
        </div>
      </div>

      {error && <div className="lab-error">{error}</div>}

      {loading ? (
        <div className="lab-loading">Scanning hardware…</div>

      ) : !data || (risks.length === 0 && !data.summary) ? (
        <div className="lab-empty">No hardware data available yet.</div>

      ) : (
        <>
          {/* Summary bar */}
          {data.summary && (
            <div className="hw-summary-bar">
              <span className="hw-summary-icon">{stCfg.icon}</span>
              <p className="hw-summary-text">{data.summary}</p>
            </div>
          )}

          {/* Risk cards */}
          {sortedRisks.length > 0 ? (
            <div className="hw-risks">
              <div className="hw-section-label">
                ⚠️ DETECTED RISKS
                <span className="hw-count-badge">{sortedRisks.length}</span>
              </div>
              {sortedRisks.map((risk, i) => (
                <RiskCard key={i} risk={risk} />
              ))}
            </div>
          ) : (
            <div className="hw-all-clear">
              <span className="hw-all-clear-icon">✅</span>
              <div>
                <div className="hw-all-clear-title">No Hardware Issues Detected</div>
                <div className="hw-all-clear-sub">All monitored components appear to be functioning normally.</div>
              </div>
            </div>
          )}

          {/* Healthy components */}
          {healthy.length > 0 && (
            <div className="hw-healthy">
              <span className="hw-healthy-label">✅ CONFIRMED WORKING</span>
              <div className="hw-healthy-chips">
                {healthy.map((c, i) => (
                  <span key={i} className="hw-healthy-chip">
                    {COMPONENT_ICONS[c] ?? '🔩'} {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="hw-meta">
            {data._raw && (
              <span>
                {data._raw.logs_analyzed} readings analyzed · {data._raw.pump_checks} pump event{data._raw.pump_checks !== 1 ? 's' : ''} checked
              </span>
            )}
            {data.generated_at && (
              <span>
                · scanned {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
