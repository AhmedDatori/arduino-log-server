import React, { useState, useEffect, useCallback } from 'react';
import { fetchReports, generateReport } from '../api';

const STATUS_CONFIG = {
  good: { color: '#3dffa0', bg: 'rgba(61,255,160,.08)',  border: 'rgba(61,255,160,.25)', label: '✅ Good Day'    },
  fair: { color: '#f5a524', bg: 'rgba(245,165,36,.08)',  border: 'rgba(245,165,36,.25)', label: '⚠️ Fair Day'    },
  poor: { color: '#ff4d6d', bg: 'rgba(255,77,109,.08)',  border: 'rgba(255,77,109,.25)', label: '🚨 Poor Day'    },
};

const SECTIONS = [
  { key: 'soil',  icon: '🌿', label: 'Soil Moisture'  },
  { key: 'water', icon: '💧', label: 'Water Level'    },
  { key: 'light', icon: '☀️', label: 'Light'          },
  { key: 'temp',  icon: '🌡️', label: 'Temperature'   },
  { key: 'hum',   icon: '💦', label: 'Humidity'       },
];

function ReportCard({ report }) {
  const [open, setOpen] = useState(false);
  const cfg = STATUS_CONFIG[report.status] ?? STATUS_CONFIG.fair;

  const date = new Date(report.created_at).toLocaleDateString([], {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <div className="report-card" style={{ borderColor: open ? cfg.border : '#1a2d42' }}>

      {/* Card header — always visible */}
      <button className="report-card-header" onClick={() => setOpen(o => !o)}>
        <div className="report-card-left">
          <span className="report-status-badge" style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}>
            {cfg.label}
          </span>
          <span className="report-title">{report.title}</span>
          <span className="report-date">{date}</span>
        </div>
        <span className="report-chevron" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▾
        </span>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="report-body">

          {/* Summary */}
          {report.summary && (
            <p className="report-summary">{report.summary}</p>
          )}

          {/* Sensor analysis */}
          <div className="report-sections">
            {SECTIONS.map(({ key, icon, label }) => report[key] && (
              <div key={key} className="report-section-row">
                <span className="report-section-icon">{icon}</span>
                <div>
                  <span className="report-section-label">{label}</span>
                  <p className="report-section-text">{report[key]}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Problem + Action */}
          {report.main_problem && (
            <div className="report-problem">
              <div className="report-problem-title">⚠️ Main Problem</div>
              <p>{report.main_problem}</p>
            </div>
          )}
          {report.action && (
            <div className="report-action">
              <div className="report-action-title">💡 Recommended Action</div>
              <p>{report.action}</p>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default function ReportsView() {
  const [reports,    setReports]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchReports();
      setReports(data);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    try {
      await generateReport();
      await load();
    } catch (err) {
      setError(err.message || 'Failed to generate report');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="view-wrap">

      <div className="view-header">
        <h2 className="section-title" style={{ margin: 0 }}>📋 Daily Reports</h2>
        <button
          className="btn-generate"
          onClick={handleGenerate}
          disabled={generating}
        >
          {generating ? '⏳ Generating…' : '✨ Generate Report'}
        </button>
      </div>

      {error && (
        <div className="report-error">{error}</div>
      )}

      <p className="reports-info">
        Reports are generated automatically every 24 hours, summarising sensor data and giving actionable advice.
      </p>

      {loading ? (
        <div className="reports-empty">
          <span style={{ fontSize: '2rem' }}>⏳</span>
          <p>Loading reports…</p>
        </div>
      ) : reports.length === 0 ? (
        <div className="reports-empty">
          <span style={{ fontSize: '2.5rem' }}>📋</span>
          <p>No reports yet</p>
          <p style={{ fontSize: '12px', color: '#2a3f58', marginTop: '.25rem' }}>
            Click <strong style={{ color: '#3dffa0' }}>Generate Report</strong> to create your first one
          </p>
        </div>
      ) : (
        <div className="reports-list">
          {reports.map(r => (
            <ReportCard key={r.id} report={r} />
          ))}
        </div>
      )}

    </div>
  );
}
