import React, { useState, useEffect, useCallback } from 'react';
import { fetchTokenUsage, clearTokenUsage } from '../api';
import './UsageView.css';

const ENDPOINT_META = {
  'chat':         { icon: '💬', label: 'AI Chat'         },
  'health-score': { icon: '❤️', label: 'Health Score'    },
  'daily-report': { icon: '📋', label: 'Daily Reports'   },
  'autopilot-ai': { icon: '🤖', label: 'AI Autopilot'    },
  'predictions':  { icon: '🔮', label: 'Stress Forecast' },
  'root-cause':   { icon: '🔍', label: 'Root Cause'      },
  'experiments':  { icon: '🧪', label: 'Experiments'     },
  'plant-model':  { icon: '🧠', label: 'Plant Model'     },
  'unknown':      { icon: '❓', label: 'Unknown'         },
};

function fmt(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function timeStr(ts) {
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
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

  const overall = data?.overall ?? {};
  const byEp    = data?.by_endpoint ?? [];
  const recent  = data?.recent ?? [];
  const daily   = data?.daily ?? [];
  const grandTotal = overall.grand_total ?? 0;

  return (
    <div className="view-wrap">

      {/* ── Header ───────────────────────────────────────────── */}
      <div className="view-header">
        <h2 className="section-title">📊 Token Usage</h2>
        <button className="btn-danger" onClick={handleClear} disabled={clearing}>
          {clearing ? 'Clearing…' : '🗑 Clear'}
        </button>
      </div>

      {error && <div className="usg-error">{error}</div>}

      {loading ? (
        <div className="usg-loading">Loading usage data…</div>
      ) : (
        <>

          {/* ── Stats strip ─────────────────────────────────── */}
          <div className="usg-strip">
            <div className="usg-strip-item">
              <span className="usg-strip-val">{fmt(grandTotal)}</span>
              <span className="usg-strip-lbl">Total Tokens</span>
            </div>
            <div className="usg-strip-div" />
            <div className="usg-strip-item">
              <span className="usg-strip-val">{fmt(overall.grand_prompt)}</span>
              <span className="usg-strip-lbl">↓ Input</span>
            </div>
            <div className="usg-strip-div" />
            <div className="usg-strip-item">
              <span className="usg-strip-val">{fmt(overall.grand_output)}</span>
              <span className="usg-strip-lbl">↑ Output</span>
            </div>
            <div className="usg-strip-div" />
            <div className="usg-strip-item">
              <span className="usg-strip-val">{fmt(overall.total_calls)}</span>
              <span className="usg-strip-lbl">API Calls</span>
            </div>
            <div className="usg-strip-div" />
            <div className="usg-strip-item">
              <span className="usg-strip-val">
                {overall.total_calls > 0 ? fmt(Math.round(grandTotal / overall.total_calls)) : '—'}
              </span>
              <span className="usg-strip-lbl">Avg / Call</span>
            </div>
          </div>

          {/* ── Per-feature breakdown table ──────────────────── */}
          {byEp.length > 0 && (
            <section className="usg-section">
              <div className="usg-section-title">Usage by Feature</div>

              <table className="usg-table">
                <thead>
                  <tr>
                    <th className="usg-th-left">Feature</th>
                    <th>Calls</th>
                    <th>Input Tokens</th>
                    <th>Output Tokens</th>
                    <th>Total Tokens</th>
                    <th>Avg / Call</th>
                    <th>Peak Call</th>
                    <th className="usg-th-left">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {byEp.map(row => {
                    const meta  = ENDPOINT_META[row.endpoint] ?? ENDPOINT_META.unknown;
                    const share = grandTotal > 0 ? ((row.total_tokens / grandTotal) * 100).toFixed(1) : 0;
                    return (
                      <tr key={row.endpoint}>
                        <td className="usg-td-feature">
                          <span className="usg-ep-icon">{meta.icon}</span>
                          {meta.label}
                        </td>
                        <td className="usg-td-num">{row.calls}</td>
                        <td className="usg-td-num usg-dim">{fmt(row.prompt_tokens)}</td>
                        <td className="usg-td-num usg-dim">{fmt(row.output_tokens)}</td>
                        <td className="usg-td-num usg-bright">{fmt(row.total_tokens)}</td>
                        <td className="usg-td-num">{fmt(row.avg_tokens)}</td>
                        <td className="usg-td-num">{fmt(row.max_tokens)}</td>
                        <td className="usg-td-bar">
                          <div className="usg-share-wrap">
                            <div className="usg-share-bar" style={{ width: `${share}%` }} />
                            <span className="usg-share-pct">{share}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* ── Daily chart ──────────────────────────────────── */}
          {daily.length > 0 && (
            <section className="usg-section">
              <div className="usg-section-title">Daily Token Burn — Last 14 Days</div>
              <div className="usg-chart">
                {(() => {
                  const maxT = Math.max(...daily.map(d => d.total_tokens || 0)) || 1;
                  return daily.map(d => {
                    const pct = Math.max(2, (d.total_tokens / maxT) * 100);
                    const date = new Date(d.day);
                    return (
                      <div key={d.day} className="usg-chart-col" title={`${d.day}: ${fmt(d.total_tokens)} tokens · ${d.calls} calls`}>
                        <span className="usg-chart-num">{fmt(d.total_tokens)}</span>
                        <div className="usg-chart-bar-wrap">
                          <div className="usg-chart-bar" style={{ height: `${pct}%` }} />
                        </div>
                        <span className="usg-chart-day">
                          {date.toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
                        </span>
                        <span className="usg-chart-calls">{d.calls}×</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
          )}

          {/* ── Request log ──────────────────────────────────── */}
          {recent.length > 0 && (
            <section className="usg-section">
              <div className="usg-section-title">Request Log — Last {recent.length}</div>
              <table className="usg-table usg-log-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="usg-th-left">Feature</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Total</th>
                    <th className="usg-th-left">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row, i) => {
                    const meta = ENDPOINT_META[row.endpoint] ?? ENDPOINT_META.unknown;
                    return (
                      <tr key={row.id}>
                        <td className="usg-td-num usg-dim">{i + 1}</td>
                        <td className="usg-td-feature">
                          <span className="usg-ep-icon">{meta.icon}</span>
                          {meta.label}
                        </td>
                        <td className="usg-td-num usg-blue">{row.prompt_tokens}</td>
                        <td className="usg-td-num usg-amber">{row.output_tokens}</td>
                        <td className="usg-td-num usg-bright">{row.total_tokens}</td>
                        <td className="usg-td-time">{timeStr(row.created_at)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {!byEp.length && (
            <div className="usg-empty">
              No token usage recorded yet — make any AI request and it will appear here automatically.
            </div>
          )}

        </>
      )}
    </div>
  );
}
