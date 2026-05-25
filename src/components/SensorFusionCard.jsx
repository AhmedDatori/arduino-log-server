import React, { useState, useEffect, useCallback } from 'react';
import { fetchFusion, refreshFusion } from '../api';
import './SensorFusionCard.css';

// ── Constants ──────────────────────────────────────────────────────────────
const GROWTH_CFG = {
  optimal: { icon: '🚀', label: 'Optimal',  color: '#3dffa0' },
  good:    { icon: '🌱', label: 'Good',      color: '#3dffa0' },
  reduced: { icon: '🐢', label: 'Reduced',   color: '#f5a524' },
  poor:    { icon: '⚠️', label: 'Poor',      color: '#ff4d6d' },
  halted:  { icon: '🛑', label: 'Halted',    color: '#ff4d6d' },
};

const SEV_CFG = {
  ok:       { color: '#3dffa0', bg: 'rgba(61,255,160,.08)',  border: 'rgba(61,255,160,.25)'  },
  warning:  { color: '#f5a524', bg: 'rgba(245,165,36,.08)',  border: 'rgba(245,165,36,.25)'  },
  critical: { color: '#ff4d6d', bg: 'rgba(255,77,109,.09)',  border: 'rgba(255,77,109,.35)'  },
};

const SENSOR_ICON = { soil: '🌿', water: '💧', light: '☀️', temp: '🌡️', hum: '💦' };

function RelationshipRow({ rel, accent }) {
  const icons = (rel.sensors ?? []).map(s => SENSOR_ICON[s] ?? '🔬').join(' + ');
  return (
    <div className="sf-relation" style={{ borderColor: `${accent}30` }}>
      <div className="sf-relation-sensors" style={{ color: accent }}>{icons}</div>
      <div className="sf-relation-body">
        <div className="sf-relation-obs">{rel.observation}</div>
        <div className="sf-relation-interp">{rel.interpretation}</div>
      </div>
    </div>
  );
}

export default function SensorFusionCard() {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await fetchFusion());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshFusion(); await load(); }
    catch (err) { setError(err.message); }
    finally { setRefreshing(false); }
  };

  const sev  = data?.state_severity ?? 'ok';
  const scfg = SEV_CFG[sev] ?? SEV_CFG.ok;
  const grow = GROWTH_CFG[data?.growth_level] ?? GROWTH_CFG.good;
  const secondary = data?.secondary_relationships ?? [];

  return (
    <div
      className="sf-card"
      style={data ? { '--sf-color': scfg.color, '--sf-bg': scfg.bg, '--sf-border': scfg.border } : {}}
    >
      {/* Header */}
      <div className="sf-header">
        <div className="sf-title">
          <span className="sf-title-icon">🧠</span>
          Sensor Intelligence
          <span className="sf-subtitle">Cross-sensor fusion analysis</span>
        </div>
        <div className="sf-header-right">
          {data?.fused_state && (
            <span className="sf-state-badge" style={{ color: scfg.color, borderColor: scfg.color, background: scfg.bg }}>
              {data.fused_state}
            </span>
          )}
          <button
            className="sf-refresh-btn"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            title="Re-analyze sensor combinations"
          >
            {refreshing ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {error && <div className="sf-error">{error}</div>}

      {loading ? (
        <div className="sf-loading">Fusing sensor data…</div>
      ) : !data?.primary_relationship ? (
        <div className="sf-empty">{data?.message ?? 'No sensor data available yet.'}</div>
      ) : (
        <div className="sf-body">

          {/* Primary cross-sensor insight */}
          <div className="sf-primary">
            <RelationshipRow rel={data.primary_relationship} accent={scfg.color} />
          </div>

          {/* Secondary relationships */}
          {secondary.length > 0 && (
            <div className="sf-secondary">
              {secondary.map((rel, i) => (
                <RelationshipRow key={i} rel={rel} accent="#38b2f8" />
              ))}
            </div>
          )}

          {/* Bottom row: growth forecast + priority insight */}
          <div className="sf-bottom">
            {/* Growth forecast pill */}
            <div className="sf-growth" style={{ color: grow.color, borderColor: `${grow.color}40`, background: `${grow.color}0d` }}>
              <span className="sf-growth-icon">{grow.icon}</span>
              <div>
                <span className="sf-growth-label">{grow.label} Growth</span>
                <span className="sf-growth-forecast">{data.growth_forecast}</span>
              </div>
            </div>

            {/* Priority insight */}
            {data.priority_insight && (
              <div className="sf-insight">
                <span className="sf-insight-label">💡 KEY INSIGHT</span>
                <span className="sf-insight-text">{data.priority_insight}</span>
              </div>
            )}
          </div>

          {/* Recommendation */}
          {data.recommendation && (
            <div className="sf-recommendation" style={{ borderColor: `${scfg.color}30` }}>
              <span className="sf-rec-label">→ Recommended Action</span>
              <span className="sf-rec-text">{data.recommendation}</span>
            </div>
          )}

          {data.generated_at && (
            <div className="sf-meta">
              fused {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
