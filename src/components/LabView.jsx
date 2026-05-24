import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchRootCause, refreshRootCause,
  fetchExperiments, createExperiment, endExperiment, deleteExperiment,
  fetchPlantModel, refreshPlantModel,
} from '../api';
import HardwarePanel from './HardwarePanel';
import './LabView.css';

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — Root Cause Analysis
// ══════════════════════════════════════════════════════════════════════════════
const STATUS_COLORS = {
  ok:       { color: '#3dffa0', bg: 'rgba(61,255,160,.06)',  border: 'rgba(61,255,160,.2)'  },
  warning:  { color: '#f5a524', bg: 'rgba(245,165,36,.06)',  border: 'rgba(245,165,36,.2)'  },
  critical: { color: '#ff4d6d', bg: 'rgba(255,77,109,.08)',  border: 'rgba(255,77,109,.2)'  },
};
const SENSOR_ICONS = { soil: '🌿', water: '💧', light: '☀️', temp: '🌡️', hum: '💦' };
const TREND_ICON   = { improving: '📈', stable: '➡️', declining: '📉' };

function RootCausePanel() {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [error,     setError]     = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await fetchRootCause());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshRootCause(); await load(); }
    finally { setRefreshing(false); }
  };

  return (
    <div className="lab-panel">
      <div className="lab-panel-header">
        <div className="lab-panel-title">
          <span>🔍</span> Root Cause Analysis
          <span className="lab-panel-sub">Why is the plant at this health level?</span>
        </div>
        <button className="lab-refresh-btn" onClick={handleRefresh} disabled={refreshing || loading}>
          {refreshing ? '⟳ Analyzing…' : '↻ Re-analyze'}
        </button>
      </div>

      {error && <div className="lab-error">{error}</div>}

      {loading ? (
        <div className="lab-loading">Analyzing plant health history…</div>
      ) : !data?.primary_cause ? (
        <div className="lab-empty">{data?.message ?? 'No analysis available. Generate a health score first.'}</div>
      ) : (
        <div className="rc-body">
          {/* Score + Trend */}
          <div className="rc-score-row">
            <div className="rc-score">
              <span className="rc-score-num">{data.current_score}</span>
              <span className="rc-score-denom">/100</span>
            </div>
            <div className="rc-trend">
              {TREND_ICON[data.trend] ?? '➡️'}
              <span>{data.trend ?? 'stable'}</span>
            </div>
          </div>

          {/* Primary cause */}
          <div className="rc-primary">
            <div className="rc-primary-label">PRIMARY CAUSE</div>
            <p className="rc-primary-text">{data.primary_cause}</p>
          </div>

          {/* Secondary causes */}
          {data.secondary_causes?.length > 0 && (
            <div className="rc-secondary">
              <div className="rc-secondary-label">CONTRIBUTING FACTORS</div>
              <ul className="rc-secondary-list">
                {data.secondary_causes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          {/* Sensor breakdown */}
          {data.sensor_analysis && (
            <div className="rc-sensors">
              {Object.entries(data.sensor_analysis).map(([key, val]) => {
                const m = STATUS_COLORS[val.status] ?? STATUS_COLORS.ok;
                return (
                  <div key={key} className="rc-sensor-row" style={{ borderColor: m.border, background: m.bg }}>
                    <span className="rc-sensor-icon">{SENSOR_ICONS[key] ?? '•'}</span>
                    <div className="rc-sensor-info">
                      <span className="rc-sensor-name">{key.toUpperCase()}</span>
                      <span className="rc-sensor-note">{val.note}</span>
                    </div>
                    <span className="rc-sensor-status" style={{ color: m.color }}>{val.status.toUpperCase()}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Timeline */}
          {data.timeline && (
            <div className="rc-timeline">
              <div className="rc-timeline-label">TIMELINE</div>
              <p>{data.timeline}</p>
            </div>
          )}

          {/* Recovery steps */}
          {data.recovery_steps?.length > 0 && (
            <div className="rc-recovery">
              <div className="rc-recovery-label">RECOVERY PLAN</div>
              {data.recovery_steps.map((step, i) => (
                <div key={i} className="rc-recovery-step">
                  <span className="rc-step-num">{i + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}

          {data.generated_at && (
            <div className="lab-generated-at">
              Analyzed {new Date(data.generated_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 7 — AI Experiment Mode
// ══════════════════════════════════════════════════════════════════════════════
const BLANK_FORM = {
  name: '', hypothesis: '',
  strategy_a: { label: '', condition: '' },
  strategy_b: { label: '', condition: '' },
  duration_days: 7,
};

function ExperimentsPanel() {
  const [experiments, setExperiments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [form,        setForm]        = useState(BLANK_FORM);
  const [saving,      setSaving]      = useState(false);
  const [ending,      setEnding]      = useState(null);
  const [error,       setError]       = useState('');

  const load = useCallback(async () => {
    try {
      setExperiments(await fetchExperiments());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name || !form.strategy_a.label || !form.strategy_b.label) {
      setError('Name, Strategy A label, and Strategy B label are required.'); return;
    }
    setSaving(true); setError('');
    try {
      await createExperiment(form);
      setForm(BLANK_FORM); setShowForm(false); await load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleEnd = async (id) => {
    if (!confirm('End this experiment and run AI analysis?')) return;
    setEnding(id);
    try { await endExperiment(id); await load(); }
    catch (err) { setError(err.message); }
    finally { setEnding(null); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this experiment?')) return;
    try { await deleteExperiment(id); await load(); }
    catch (err) { setError(err.message); }
  };

  const pf = (path, val) => setForm(f => {
    const next = { ...f };
    const parts = path.split('.');
    let cur = next;
    parts.slice(0, -1).forEach(p => { cur[p] = { ...cur[p] }; cur = cur[p]; });
    cur[parts[parts.length - 1]] = val;
    return next;
  });

  const running   = experiments.filter(e => e.status === 'running');
  const completed = experiments.filter(e => e.status === 'completed');

  return (
    <div className="lab-panel">
      <div className="lab-panel-header">
        <div className="lab-panel-title">
          <span>🧪</span> Experiment Mode
          <span className="lab-panel-sub">A/B test watering and care strategies over time</span>
        </div>
        <button className="lab-action-btn" onClick={() => setShowForm(s => !s)}>
          {showForm ? '✕ Cancel' : '+ New Experiment'}
        </button>
      </div>

      {error && <div className="lab-error">{error}</div>}

      {/* New experiment form */}
      {showForm && (
        <form className="exp-form" onSubmit={handleCreate}>
          <div className="exp-form-row">
            <div className="exp-field exp-field-flex">
              <label>Experiment Name *</label>
              <input className="exp-input" value={form.name} onChange={e => pf('name', e.target.value)} placeholder="e.g. Watering Threshold Test" />
            </div>
            <div className="exp-field exp-field-small">
              <label>Duration (days)</label>
              <input className="exp-input" type="number" min="1" max="30" value={form.duration_days} onChange={e => pf('duration_days', Number(e.target.value))} />
            </div>
          </div>
          <div className="exp-field">
            <label>Hypothesis (optional)</label>
            <input className="exp-input" value={form.hypothesis} onChange={e => pf('hypothesis', e.target.value)} placeholder="e.g. Watering at 35% will reduce stress events" />
          </div>
          <div className="exp-strategies">
            <div className="exp-strategy exp-strategy-a">
              <div className="exp-strategy-badge">Strategy A</div>
              <div className="exp-field">
                <label>Label *</label>
                <input className="exp-input" value={form.strategy_a.label} onChange={e => pf('strategy_a.label', e.target.value)} placeholder="e.g. Water at 25% soil" />
              </div>
              <div className="exp-field">
                <label>Condition / Rule</label>
                <input className="exp-input" value={form.strategy_a.condition} onChange={e => pf('strategy_a.condition', e.target.value)} placeholder="e.g. Pump when soil < 25%" />
              </div>
            </div>
            <div className="exp-strategy exp-strategy-b">
              <div className="exp-strategy-badge">Strategy B</div>
              <div className="exp-field">
                <label>Label *</label>
                <input className="exp-input" value={form.strategy_b.label} onChange={e => pf('strategy_b.label', e.target.value)} placeholder="e.g. Water at 35% soil" />
              </div>
              <div className="exp-field">
                <label>Condition / Rule</label>
                <input className="exp-input" value={form.strategy_b.condition} onChange={e => pf('strategy_b.condition', e.target.value)} placeholder="e.g. Pump when soil < 35%" />
              </div>
            </div>
          </div>
          <div className="exp-form-footer">
            <button type="submit" className="lab-action-btn" disabled={saving}>{saving ? 'Creating…' : 'Start Experiment'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="lab-loading">Loading experiments…</div>
      ) : experiments.length === 0 ? (
        <div className="lab-empty">No experiments yet — create one to start comparing strategies.</div>
      ) : (
        <>
          {/* Running experiments */}
          {running.length > 0 && (
            <div className="exp-section">
              <div className="exp-section-label">RUNNING</div>
              {running.map(exp => (
                <ExperimentCard key={exp.id} exp={exp} onEnd={handleEnd} onDelete={handleDelete} ending={ending === exp.id} />
              ))}
            </div>
          )}
          {/* Completed experiments */}
          {completed.length > 0 && (
            <div className="exp-section">
              <div className="exp-section-label">COMPLETED</div>
              {completed.map(exp => (
                <ExperimentCard key={exp.id} exp={exp} onEnd={handleEnd} onDelete={handleDelete} ending={false} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExperimentCard({ exp, onEnd, onDelete, ending }) {
  const [open, setOpen] = useState(false);
  const result = exp.result;
  const isRunning = exp.status === 'running';
  const started   = new Date(exp.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const ended     = exp.ended_at ? new Date(exp.ended_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;

  const WINNER_STYLE = {
    a: { color: '#38b2f8', border: 'rgba(56,178,248,.3)', bg: 'rgba(56,178,248,.06)' },
    b: { color: '#3dffa0', border: 'rgba(61,255,160,.3)', bg: 'rgba(61,255,160,.06)' },
    tie: { color: '#f5a524', border: 'rgba(245,165,36,.3)', bg: 'rgba(245,165,36,.06)' },
  };

  return (
    <div className="exp-card">
      <div className="exp-card-header" onClick={() => setOpen(o => !o)}>
        <div className="exp-card-left">
          <span className={`exp-status-dot ${isRunning ? 'running' : 'done'}`} />
          <div>
            <div className="exp-card-name">{exp.name}</div>
            <div className="exp-card-meta">{started}{ended ? ` → ${ended}` : ` · ${exp.duration_days}d planned`}</div>
          </div>
          {result?.winner && (
            <span className="exp-winner-badge" style={WINNER_STYLE[result.winner] ?? {}}>
              {result.winner === 'tie' ? '🤝 Tie' : `Strategy ${result.winner.toUpperCase()} wins`}
            </span>
          )}
        </div>
        <span className="exp-chevron">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="exp-card-body">
          {exp.hypothesis && <p className="exp-hypothesis">Hypothesis: {exp.hypothesis}</p>}

          <div className="exp-strategies-row">
            <div className="exp-strat-pill exp-strat-a">
              <span className="exp-strat-tag">A</span>
              <div>
                <div className="exp-strat-label">{exp.strategy_a?.label}</div>
                {exp.strategy_a?.condition && <div className="exp-strat-cond">{exp.strategy_a.condition}</div>}
              </div>
            </div>
            <div className="exp-vs">vs</div>
            <div className="exp-strat-pill exp-strat-b">
              <span className="exp-strat-tag">B</span>
              <div>
                <div className="exp-strat-label">{exp.strategy_b?.label}</div>
                {exp.strategy_b?.condition && <div className="exp-strat-cond">{exp.strategy_b.condition}</div>}
              </div>
            </div>
          </div>

          {result && (
            <div className="exp-result">
              <div className="exp-result-conclusion">{result.conclusion}</div>
              <div className="exp-result-grid">
                <div className="exp-result-col">
                  <div className="exp-result-col-title" style={{ color: '#38b2f8' }}>Strategy A</div>
                  <p>{result.strategy_a_result?.summary}</p>
                  {result.strategy_a_result?.strengths && <p className="exp-result-strength">✓ {result.strategy_a_result.strengths}</p>}
                  {result.strategy_a_result?.weaknesses && <p className="exp-result-weak">✗ {result.strategy_a_result.weaknesses}</p>}
                </div>
                <div className="exp-result-col">
                  <div className="exp-result-col-title" style={{ color: '#3dffa0' }}>Strategy B</div>
                  <p>{result.strategy_b_result?.summary}</p>
                  {result.strategy_b_result?.strengths && <p className="exp-result-strength">✓ {result.strategy_b_result.strengths}</p>}
                  {result.strategy_b_result?.weaknesses && <p className="exp-result-weak">✗ {result.strategy_b_result.weaknesses}</p>}
                </div>
              </div>
              {result.key_insight && (
                <div className="exp-key-insight">
                  <span className="exp-key-insight-label">KEY INSIGHT</span>
                  {result.key_insight}
                </div>
              )}
              {result.recommendation && (
                <div className="exp-recommendation">
                  <span className="exp-recommendation-label">RECOMMENDATION</span>
                  {result.recommendation}
                </div>
              )}
            </div>
          )}

          <div className="exp-card-actions">
            {isRunning && (
              <button className="lab-action-btn" onClick={() => onEnd(exp.id)} disabled={ending}>
                {ending ? '⟳ Analyzing…' : '⏹ End & Analyze'}
              </button>
            )}
            <button className="lab-danger-btn" onClick={() => onDelete(exp.id)}>🗑 Delete</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FEATURE 8 — Personalized Plant Care Model
// ══════════════════════════════════════════════════════════════════════════════
function PlantModelPanel() {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await fetchPlantModel());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshPlantModel(); await load(); }
    finally { setRefreshing(false); }
  };

  return (
    <div className="lab-panel">
      <div className="lab-panel-header">
        <div className="lab-panel-title">
          <span>🧠</span> Personalized Plant Model
          <span className="lab-panel-sub">Your greenhouse's unique behavioral fingerprint</span>
        </div>
        <button className="lab-refresh-btn" onClick={handleRefresh} disabled={refreshing || loading}>
          {refreshing ? '⟳ Learning…' : '↻ Relearn'}
        </button>
      </div>

      {error && <div className="lab-error">{error}</div>}

      {loading ? (
        <div className="lab-loading">Building your plant model…</div>
      ) : !data || data.model === null ? (
        <div className="lab-empty">{data?.message ?? 'No model yet. Need more sensor history.'}</div>
      ) : (
        <div className="pm-body">
          {/* Summary */}
          {data.summary && (
            <div className="pm-summary">{data.summary}</div>
          )}

          {/* Insights grid */}
          {data.insights?.length > 0 && (
            <div className="pm-insights">
              {data.insights.map((ins, i) => (
                <div key={i} className="pm-insight">
                  <span className="pm-insight-icon">{ins.icon}</span>
                  <div className="pm-insight-body">
                    <div className="pm-insight-title">{ins.title}</div>
                    <div className="pm-insight-detail">{ins.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick stats */}
          <div className="pm-stats">
            {data.hours_to_critical_dryness && (
              <div className="pm-stat">
                <div className="pm-stat-val">{data.hours_to_critical_dryness}</div>
                <div className="pm-stat-label">to critical dryness</div>
              </div>
            )}
            {data.recommended_watering_seconds && (
              <div className="pm-stat">
                <div className="pm-stat-val">{data.recommended_watering_seconds}</div>
                <div className="pm-stat-label">ideal watering</div>
              </div>
            )}
            {data.best_light_hours && (
              <div className="pm-stat">
                <div className="pm-stat-val">{data.best_light_hours}</div>
                <div className="pm-stat-label">peak light</div>
              </div>
            )}
          </div>

          {/* Personalized tip */}
          {data.personalized_tip && (
            <div className="pm-tip">
              <span className="pm-tip-label">YOUR GREENHOUSE TIP</span>
              {data.personalized_tip}
            </div>
          )}

          {/* Raw stats */}
          {data.stats && (
            <div className="pm-raw-stats">
              <span className="pm-raw-label">Based on {data.stats.readings} readings</span>
              {data.stats.avg_drying_pct_per_hour && <span>· {data.stats.avg_drying_pct_per_hour}%/hr drying rate</span>}
              {data.stats.avg_pump_effect_pct && <span>· {data.stats.avg_pump_effect_pct}% pump effect</span>}
            </div>
          )}

          {data.generated_at && (
            <div className="lab-generated-at">
              Model built {new Date(data.generated_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Lab View — combines all 3 Lab panels
// ══════════════════════════════════════════════════════════════════════════════
export default function LabView() {
  return (
    <div className="view-wrap">
      <div className="view-header">
        <h2 className="section-title">🧪 AI Lab</h2>
      </div>
      <p className="lab-intro">
        Advanced AI analysis tools — hardware diagnostics, root cause diagnosis, A/B strategy experiments, and a personalized behavioral model built from your greenhouse's own data.
      </p>

      <HardwarePanel />
      <RootCausePanel />
      <ExperimentsPanel />
      <PlantModelPanel />
    </div>
  );
}
