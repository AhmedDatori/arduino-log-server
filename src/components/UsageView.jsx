import React, { useState, useEffect, useCallback } from 'react';
import { fetchTokenUsage, clearTokenUsage } from '../api';
import './UsageView.css';

const ENDPOINT_META = {
  'chat':         { icon: '💬', label: 'AI Chat'           },
  'health-score': { icon: '❤️', label: 'Health Score'      },
  'daily-report': { icon: '📋', label: 'Daily Reports'     },
  'autopilot-ai': { icon: '🤖', label: 'AI Autopilot'      },
  'predictions':  { icon: '🔮', label: 'Stress Forecast'   },
  'root-cause':   { icon: '🔍', label: 'Root Cause'        },
  'experiments':  { icon: '🧪', label: 'Experiments'       },
  'plant-model':  { icon: '🧠', label: 'Plant Model'       },
  'unknown':      { icon: '❓', label: 'Unknown'           },
};

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function ago(ts) {
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Simple CSS bar chart — no library needed
function BarChart({ data }) {
  if (!data?.length) return null;
  const maxTokens = Math.max(...data.map(d => d.total_tokens || 0));
  if (maxTokens === 0) return null;
  return (
    <div className="usage-bar-chart">
      {data.map(d => {
        const meta = ENDPOINT_META[d.endpoint] ?? ENDPOINT_META.unknown;
        const pct  = maxTokens > 0 ? (d.total_tokens / maxTokens) * 100 : 0;
        return (
          <div key={d.endpoint} className="ubc-row">
            <div className="ubc-label">
              <span className="ubc-icon">{meta.icon}</span>
              <span className="ubc-name">{meta.label}</span>
            </div>
            <div className="ubc-bar-wrap">
              <div className="ubc-bar" style={{ width: `${pct}%` }} />
              <span className="ubc-bar-val">{fmt(d.total_tokens)}</span>
            </div>
            <div className="ubc-calls">{d.calls} calls</div>
          </div>
        );
      })}
    </div>
  );
}

export default function UsageView() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [clearing, setClearing] = useState(false);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    try {
      setError('');
      setData(await fetchTokenUsage());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    if (!confirm('Clear all token usage history?')) return;
    setClearing(true);
    try { await clearTokenUsage(); await load(); }
    catch (err) { setError(err.message); }
    finally { setClearing(false); }
  };

  const overall = data?.overall;
  const byEp    = data?.by_endpoint ?? [];
  const recent  = data?.recent ?? [];
  const daily   = data?.daily ?? [];

  return (
    <div className="view-wrap">
      <div className="view-header">
        <h2 className="section-title">📊 Token Usage</h2>
        <button className="btn-danger" onClick={handleClear} disabled={clearing}>
          {clearing ? 'Clearing…' : '🗑 Clear History'}
        </button>
      </div>

      {error && <div className="usage-error">{error}</div>}

      {loading ? (
        <div className="usage-loading">Loading usage data…</div>
      ) : (
        <>
          {/* ── Grand total cards ─────────────────────────────── */}
          <div className="usage-totals">
            <div className="usage-total-card usage-total-main">
              <div className="utc-icon">🔤</div>
              <div className="utc-val">{fmt(overall?.grand_total ?? 0)}</div>
              <div className="utc-label">Total Tokens Used</div>
            </div>
            <div className="usage-total-card">
              <div className="utc-icon">📥</div>
              <div className="utc-val">{fmt(overall?.grand_prompt ?? 0)}</div>
              <div className="utc-label">Input Tokens</div>
            </div>
            <div className="usage-total-card">
              <div className="utc-icon">📤</div>
              <div className="utc-val">{fmt(overall?.grand_output ?? 0)}</div>
              <div className="utc-label">Output Tokens</div>
            </div>
            <div className="usage-total-card">
              <div className="utc-icon">🔁</div>
              <div className="utc-val">{fmt(overall?.total_calls ?? 0)}</div>
              <div className="utc-label">Total API Calls</div>
            </div>
          </div>

          {/* ── Per-endpoint bar chart ─────────────────────────── */}
          {byEp.length > 0 && (
            <div className="usage-section">
              <div className="usage-section-label">BY FEATURE</div>
              <BarChart data={byEp} />
            </div>
          )}

          {/* ── Per-endpoint table ─────────────────────────────── */}
          {byEp.length > 0 && (
            <div className="usage-section">
              <div className="usage-section-label">BREAKDOWN</div>
              <div className="usage-table-wrap">
                <table className="usage-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>Calls</th>
                      <th>Input</th>
                      <th>Output</th>
                      <th>Total</th>
                      <th>Avg/Call</th>
                      <th>Peak</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byEp.map(row => {
                      const meta = ENDPOINT_META[row.endpoint] ?? ENDPOINT_META.unknown;
                      return (
                        <tr key={row.endpoint}>
                          <td>
                            <span className="usage-ep-icon">{meta.icon}</span>
                            <span className="usage-ep-label">{meta.label}</span>
                          </td>
                          <td className="usage-num">{row.calls}</td>
                          <td className="usage-num">{fmt(row.prompt_tokens)}</td>
                          <td className="usage-num">{fmt(row.output_tokens)}</td>
                          <td className="usage-num usage-num-total">{fmt(row.total_tokens)}</td>
                          <td className="usage-num">{fmt(row.avg_tokens)}</td>
                          <td className="usage-num">{fmt(row.max_tokens)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Daily sparkline ───────────────────────────────── */}
          {daily.length > 0 && (
            <div className="usage-section">
              <div className="usage-section-label">DAILY (LAST 14 DAYS)</div>
              <div className="usage-daily">
                {(() => {
                  const maxD = Math.max(...daily.map(d => d.total_tokens || 0)) || 1;
                  return daily.map(d => {
                    const h = Math.max(4, ((d.total_tokens / maxD) * 80));
                    return (
                      <div key={d.day} className="usage-day" title={`${d.day}: ${fmt(d.total_tokens)} tokens, ${d.calls} calls`}>
                        <div className="usage-day-bar" style={{ height: `${h}px` }} />
                        <div className="usage-day-val">{fmt(d.total_tokens)}</div>
                        <div className="usage-day-label">
                          {new Date(d.day).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* ── Recent requests log ───────────────────────────── */}
          {recent.length > 0 && (
            <div className="usage-section">
              <div className="usage-section-label">RECENT REQUESTS</div>
              <div className="usage-recent">
                {recent.map(row => {
                  const meta = ENDPOINT_META[row.endpoint] ?? ENDPOINT_META.unknown;
                  return (
                    <div key={row.id} className="usage-recent-row">
                      <span className="usage-recent-icon">{meta.icon}</span>
                      <span className="usage-recent-label">{meta.label}</span>
                      <div className="usage-recent-tokens">
                        <span className="urt-in"  title="Input tokens">↓{row.prompt_tokens}</span>
                        <span className="urt-out" title="Output tokens">↑{row.output_tokens}</span>
                        <span className="urt-tot">{fmt(row.total_tokens)} total</span>
                      </div>
                      <span className="usage-recent-ago">{ago(row.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!byEp.length && !loading && (
            <div className="usage-empty">
              No token usage recorded yet — make some AI requests and they'll show up here.
            </div>
          )}
        </>
      )}
    </div>
  );
}
