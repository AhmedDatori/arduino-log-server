import React, { useState, useEffect, useCallback } from 'react';
import { fetchPredictions, refreshPredictions } from '../api';
import './PredictionCard.css';

const TYPE_ICONS = {
  water_stress:      '💧',
  heat_stress:       '🌡️',
  low_light_stress:  '🌑',
  overwatering_risk: '🌊',
  humidity_problem:  '💦',
  sensor_failure:    '⚠️',
};

const SEV_CLASS = { low: 'sev-low', medium: 'sev-med', high: 'sev-high', critical: 'sev-crit' };
const CONF_LABEL = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };

function PredictionItem({ pred }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`pred-item ${SEV_CLASS[pred.severity] ?? ''}`} onClick={() => setExpanded(e => !e)}>
      <div className="pred-item-top">
        <span className="pred-type-icon">{TYPE_ICONS[pred.type] ?? '🔮'}</span>
        <div className="pred-item-info">
          <span className="pred-title">{pred.title}</span>
          <span className="pred-time">{pred.time_estimate}</span>
        </div>
        <span className={`pred-sev-badge sev-${pred.severity}`}>{pred.severity.toUpperCase()}</span>
        <span className="pred-chevron">{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && (
        <div className="pred-item-body">
          <p className="pred-desc">{pred.description}</p>
          <div className="pred-action">
            <span className="pred-action-label">ACTION</span>
            {pred.recommended_action}
          </div>
          <span className="pred-conf">{CONF_LABEL[pred.confidence] ?? ''}</span>
        </div>
      )}
    </div>
  );
}

export default function PredictionCard() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setError('');
      const result = await fetchPredictions();
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshPredictions();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div className="pred-card pred-loading">Analyzing trends…</div>;

  const predictions = data?.predictions ?? [];
  const allClear    = predictions.length === 0;

  return (
    <div className="pred-card">
      <div className="pred-header">
        <div className="pred-header-left">
          <span className="pred-header-icon">🔮</span>
          <span className="pred-header-title">AI Stress Forecast</span>
          {data?.span_hours && (
            <span className="pred-header-sub">based on {data.span_hours}h of data ({data.readings} readings)</span>
          )}
        </div>
        <button className="pred-refresh-btn" onClick={handleRefresh} disabled={refreshing} title="Refresh predictions">
          {refreshing ? '⟳' : '↻'}
        </button>
      </div>

      {error && <div className="pred-error">{error}</div>}

      {allClear ? (
        <div className="pred-all-clear">
          <span className="pred-all-clear-icon">✅</span>
          <div>
            <div className="pred-all-clear-title">All clear</div>
            <div className="pred-all-clear-sub">{data?.overall_outlook ?? 'No stress events predicted in the near future.'}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="pred-list">
            {predictions.map((p, i) => <PredictionItem key={i} pred={p} />)}
          </div>
          {data?.overall_outlook && (
            <div className="pred-outlook">
              <span className="pred-outlook-label">OUTLOOK</span>
              {data.overall_outlook}
            </div>
          )}
        </>
      )}

      {data?.generated_at && (
        <div className="pred-footer">
          Updated {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          {data?.next_check && ` · check again ${data.next_check}`}
        </div>
      )}
    </div>
  );
}
