import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLatestFrame, fetchFrameList, fetchFrame, fetchDiagnoses, runDiagnosis } from '../api';
import './CameraView.css';

// ── Time helpers ──────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtTimeShort(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function fmtRelative(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5)  return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}
function fmtWindow(oldest, newest) {
  if (!oldest || !newest) return '';
  const mins = Math.round((new Date(newest) - new Date(oldest)) / 60000);
  if (mins < 1)  return '< 1 min window';
  if (mins < 60) return `${mins} min window`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m window`;
}
function ageMs(iso) {
  return iso ? Date.now() - new Date(iso).getTime() : Infinity;
}

// ── Health ring ───────────────────────────────────────────────────
function HealthRing({ score }) {
  const R    = 36;
  const circ = 2 * Math.PI * R;
  const fill = (Math.max(0, Math.min(100, score)) / 100) * circ;
  const col  = score >= 75 ? '#3dffa0' : score >= 50 ? '#f5a524' : '#ff4d6d';
  return (
    <svg width="92" height="92" viewBox="0 0 92 92" className="diag-ring">
      <circle cx="46" cy="46" r={R} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="5" />
      <circle
        cx="46" cy="46" r={R} fill="none"
        stroke={col} strokeWidth="5"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 46 46)"
        style={{ transition: 'stroke-dasharray .8s ease', filter: `drop-shadow(0 0 7px ${col}55)` }}
      />
      <text x="46" y="42" textAnchor="middle" fill={col} fontSize="19" fontWeight="700" fontFamily="JetBrains Mono,monospace">{score}</text>
      <text x="46" y="57" textAnchor="middle" fill="rgba(255,255,255,.22)" fontSize="8.5" fontFamily="DM Sans,sans-serif" letterSpacing="1">/100</text>
    </svg>
  );
}

// ── Severity pill ─────────────────────────────────────────────────
const SEV = {
  low:    { color: '#3dffa0', bg: 'rgba(61,255,160,.1)',  border: 'rgba(61,255,160,.25)' },
  medium: { color: '#f5a524', bg: 'rgba(245,165,36,.1)', border: 'rgba(245,165,36,.25)' },
  high:   { color: '#ff4d6d', bg: 'rgba(255,77,109,.1)', border: 'rgba(255,77,109,.25)' },
};

function SevPill({ level }) {
  const s = SEV[level] ?? SEV.low;
  return (
    <span className="sev-pill" style={{ color: s.color, background: s.bg, borderColor: s.border }}>
      {level}
    </span>
  );
}

// ── Diagnosis card (accordion) ────────────────────────────────────
function DiagCard({ diag, expanded, onToggle }) {
  const issues   = diag.issues          ?? [];
  const recs     = diag.recommendations ?? [];
  const alerts   = (diag.alerts         ?? []).filter(Boolean);
  const score    = diag.health_score;
  const col      = score == null ? 'var(--text-muted)' : score >= 75 ? '#3dffa0' : score >= 50 ? '#f5a524' : '#ff4d6d';

  return (
    <div className={`diag-card${expanded ? ' diag-card--open' : ''}`}>

      {/* Clickable header */}
      <button className="diag-header" onClick={onToggle}>
        {/* Left: ring (when expanded) or score pill (when collapsed) */}
        {expanded && score != null ? (
          <HealthRing score={score} />
        ) : (
          <div className="diag-score-chip" style={{ color: col, borderColor: col + '44', background: col + '11' }}>
            {score ?? '—'}
          </div>
        )}

        <div className="diag-header-body">
          <div className="diag-header-top">
            <span className="diag-status-text" style={{ color: col }}>
              {diag.status ?? 'unknown'}
            </span>
            {score != null && !expanded && (
              <span className="diag-score-sub" style={{ color: col }}>{score}/100</span>
            )}
            {alerts.length > 0 && (
              <span className="diag-alert-count">⚠ {alerts.length} alert{alerts.length > 1 ? 's' : ''}</span>
            )}
          </div>
          <div className="diag-header-time">
            {new Date(diag.created_at).toLocaleString()}
          </div>
          {!expanded && diag.summary && (
            <div className="diag-preview">{diag.summary.slice(0, 90)}{diag.summary.length > 90 ? '…' : ''}</div>
          )}
        </div>

        <span className="diag-chevron">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="diag-body">
          {alerts.length > 0 && (
            <div className="diag-alert-strip">
              {alerts.map((a, i) => (
                <div key={i} className="diag-alert-row">
                  <span className="diag-alert-icon">⚠️</span>
                  {a}
                </div>
              ))}
            </div>
          )}

          {diag.summary && (
            <p className="diag-summary">{diag.summary}</p>
          )}

          {issues.length > 0 && (
            <div className="diag-section">
              <div className="diag-section-label">Issues detected</div>
              <div className="diag-issues-grid">
                {issues.map((iss, i) => (
                  <div key={i} className={`diag-issue-cell diag-issue--${iss.severity}`}>
                    <div className="diag-issue-row">
                      <span className="diag-issue-name">{iss.issue}</span>
                      <SevPill level={iss.severity} />
                    </div>
                    {iss.description && (
                      <span className="diag-issue-desc">{iss.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {recs.length > 0 && (
            <div className="diag-section">
              <div className="diag-section-label">Recommendations</div>
              <div className="diag-recs">
                {recs.map((r, i) => (
                  <div key={i} className="diag-rec-row">
                    <span className="diag-rec-bullet">›</span>
                    {r}
                  </div>
                ))}
              </div>
            </div>
          )}

          {diag.plant_suggested && (
            <div className="diag-suggest-banner">
              <span className="diag-suggest-icon">💡</span>
              <span>
                Camera AI identified this as <strong>{diag.plant_suggested}</strong>
                &nbsp;— update your plant profile in the Plants tab.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function CameraView() {
  const [currentImage, setCurrentImage] = useState(null);
  const [currentTime,  setCurrentTime]  = useState(null);
  const [cameraOnline, setCameraOnline] = useState(false);

  const [frames,       setFrames]       = useState([]);
  const [timelineIdx,  setTimelineIdx]  = useState(-1);
  const [isLive,       setIsLive]       = useState(true);
  const [loadingFrame, setLoadingFrame] = useState(false);

  const [diagnoses,    setDiagnoses]    = useState([]);
  const [expandedId,   setExpandedId]   = useState(null);
  const [running,      setRunning]      = useState(false);
  const [runMsg,       setRunMsg]       = useState('');
  const [loadingDiag,  setLoadingDiag]  = useState(true);

  const pollRef    = useRef(null);
  const listRef    = useRef(null);
  const isLiveRef  = useRef(isLive);
  isLiveRef.current = isLive;

  const fetchAndShowLatest = useCallback(async () => {
    try {
      const data = await fetchLatestFrame();
      if (data.id) {
        setCurrentImage(data.image);
        setCurrentTime(data.created_at);
        setCameraOnline(ageMs(data.created_at) < 20000);
      } else {
        setCameraOnline(false);
      }
    } catch (_) { setCameraOnline(false); }
  }, []);

  const refreshFrameList = useCallback(async () => {
    try {
      const list = await fetchFrameList();
      setFrames(list);
      if (isLiveRef.current) setTimelineIdx(list.length - 1);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchAndShowLatest();
    refreshFrameList();
    fetchDiagnoses()
      .then(d => { setDiagnoses(d); if (d.length > 0) setExpandedId(d[0].id); })
      .catch(() => {})
      .finally(() => setLoadingDiag(false));
  }, [fetchAndShowLatest, refreshFrameList]);

  useEffect(() => {
    if (!isLive) { clearInterval(pollRef.current); return; }
    pollRef.current = setInterval(fetchAndShowLatest, 5000);
    return () => clearInterval(pollRef.current);
  }, [isLive, fetchAndShowLatest]);

  useEffect(() => {
    listRef.current = setInterval(refreshFrameList, 10000);
    return () => clearInterval(listRef.current);
  }, [refreshFrameList]);

  const handleSlider = async (e) => {
    const idx = Number(e.target.value);
    setIsLive(false);
    setTimelineIdx(idx);
    if (!frames[idx]) return;
    setLoadingFrame(true);
    try {
      const data = await fetchFrame(frames[idx].id);
      setCurrentImage(data.image);
      setCurrentTime(data.created_at);
    } catch (_) {}
    setLoadingFrame(false);
  };

  const goLive = () => {
    setIsLive(true);
    setTimelineIdx(frames.length - 1);
    fetchAndShowLatest();
  };

  const handleRunDiagnosis = async () => {
    setRunning(true);
    setRunMsg('');
    try {
      await runDiagnosis();
      const d = await fetchDiagnoses();
      setDiagnoses(d);
      if (d.length > 0) setExpandedId(d[0].id);
      setRunMsg('Analysis complete');
      setTimeout(() => setRunMsg(''), 4000);
    } catch (err) {
      setRunMsg(err.message);
    } finally {
      setRunning(false);
    }
  };

  const pct      = frames.length > 1 ? Math.round((Math.max(0, timelineIdx) / (frames.length - 1)) * 100) : 100;
  const oldest   = frames[0];
  const newest   = frames[frames.length - 1];
  const selFrame = frames[timelineIdx];

  return (
    <div className="view-wrap cam-view">

      {/* ── Viewer card ─────────────────────────────────────────── */}
      <div className="cam-card">

        {/* HUD top strip */}
        <div className="cam-hud">
          <div className="cam-hud-left">
            <span className={`cam-mode-dot ${isLive && cameraOnline ? 'is-live' : ''}`} />
            <span className="cam-mode-label">{isLive ? 'LIVE' : 'REVIEW'}</span>
            {currentTime && (
              <>
                <span className="cam-hud-sep">·</span>
                <span className="cam-hud-time">{fmtTime(currentTime)}</span>
                {isLive && <span className="cam-hud-age">{fmtRelative(currentTime)}</span>}
              </>
            )}
            {!isLive && loadingFrame && <span className="cam-hud-loading">loading…</span>}
          </div>
          <div className="cam-hud-right">
            <span className={`cam-status-pill ${cameraOnline ? 'cam-status-pill--on' : 'cam-status-pill--off'}`}>
              <span className="cam-status-dot" />
              {cameraOnline ? 'Camera Online' : 'Camera Offline'}
            </span>
          </div>
        </div>

        {/* Frame */}
        <div className="cam-frame-wrap">
          {currentImage ? (
            <img
              src={`data:image/jpeg;base64,${currentImage}`}
              className={`cam-frame-img${loadingFrame ? ' cam-frame-img--dim' : ''}`}
              alt="Greenhouse camera"
            />
          ) : (
            <div className="cam-no-frame">
              <div className="cam-no-frame-glyph">📷</div>
              <div className="cam-no-frame-title">Waiting for first frame</div>
              <div className="cam-no-frame-hint">
                Flash <code>greenhouse_cam.ino</code> to your ESP32-CAM.<br />
                It will push a JPEG every 5 seconds automatically.
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div className="cam-tl">
          {/* Time labels row */}
          <div className="cam-tl-labels">
            <span className="cam-tl-edge">{fmtTimeShort(oldest?.created_at)}</span>
            <span className="cam-tl-sel-time">
              {selFrame
                ? new Date(selFrame.created_at).toLocaleString()
                : frames.length === 0 ? 'No frames stored' : ''}
            </span>
            <span className="cam-tl-edge">{fmtTimeShort(newest?.created_at)}</span>
          </div>

          {/* Scrubber */}
          <div className="cam-tl-scrubber-wrap">
            <input
              type="range"
              className="cam-tl-scrubber"
              style={{ '--pct': `${pct}%` }}
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={timelineIdx < 0 ? 0 : timelineIdx}
              onChange={handleSlider}
              disabled={frames.length === 0}
            />
          </div>

          {/* Footer */}
          <div className="cam-tl-foot">
            <span className="cam-tl-meta">
              {frames.length > 0
                ? `${frames.length} frames · ${fmtWindow(oldest?.created_at, newest?.created_at)}`
                : 'Waiting for camera…'}
            </span>
            <button
              className={`cam-live-btn${isLive ? ' cam-live-btn--active' : ''}`}
              onClick={goLive}
              disabled={isLive && cameraOnline}
            >
              <span className={`cam-live-btn-dot${isLive && cameraOnline ? ' is-pulsing' : ''}`} />
              {isLive ? 'Live' : 'Go Live'}
            </button>
          </div>
        </div>
      </div>

      {/* ── AI Vision ──────────────────────────────────────────── */}
      <div className="cam-ai-header">
        <div className="cam-ai-title-group">
          <div className="cam-ai-title">AI Plant Vision</div>
          <div className="cam-ai-sub">Hourly auto-diagnosis · Gemini Vision</div>
        </div>
        <div className="cam-ai-actions">
          {runMsg && (
            <span className={`cam-run-msg${runMsg === 'Analysis complete' ? ' cam-run-msg--ok' : ''}`}>
              {runMsg}
            </span>
          )}
          <button
            className="btn-generate"
            onClick={handleRunDiagnosis}
            disabled={running || !currentImage}
            title={!currentImage ? 'No frames stored yet' : 'Re-run AI diagnosis on the latest stored frame'}
          >
            {running ? 'Analysing…' : 'Analyse Now'}
          </button>
        </div>
      </div>

      {/* Diagnosis list */}
      {loadingDiag ? (
        <div className="cam-diag-loading">
          <span className="dot-pulse"><span/><span/><span/></span>
          Loading diagnoses
        </div>
      ) : diagnoses.length === 0 ? (
        <div className="cam-diag-empty">
          No diagnoses yet — the first one runs 30 seconds after server boot, then every hour.<br />
          Or click <strong>Analyse Now</strong> above.
        </div>
      ) : (
        <div className="diag-list">
          {diagnoses.map(d => (
            <DiagCard
              key={d.id}
              diag={d}
              expanded={expandedId === d.id}
              onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
            />
          ))}
        </div>
      )}

    </div>
  );
}
