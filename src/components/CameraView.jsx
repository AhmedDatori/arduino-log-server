import React, { useState, useEffect, useRef, useCallback } from 'react';
import { fetchLatestFrame, fetchFrameList, fetchFrame, fetchDiagnoses, runDiagnosis } from '../api';
import './CameraView.css';

// ── Helpers ───────────────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}
function ageMs(iso) {
  return iso ? Date.now() - new Date(iso).getTime() : Infinity;
}

// ── Diagnosis card ────────────────────────────────────────────────
function HealthBadge({ score, status }) {
  const color = score >= 75 ? '#3dffa0' : score >= 50 ? '#f5a524' : '#ff4d6d';
  return (
    <span className="diag-badge" style={{ color, borderColor: color + '44', background: color + '11' }}>
      {status} · {score}/100
    </span>
  );
}

function DiagCard({ diag, isLatest }) {
  const issues          = diag.issues          ?? [];
  const recommendations = diag.recommendations ?? [];
  const alerts          = (diag.alerts ?? []).filter(Boolean);

  return (
    <div className={`diag-card${isLatest ? ' diag-card--latest' : ''}`}>
      <div className="diag-card-header">
        {diag.health_score != null
          ? <HealthBadge score={diag.health_score} status={diag.status} />
          : <span className="diag-badge diag-badge--na">{diag.status}</span>
        }
        <span className="diag-time">{fmtDateTime(diag.created_at)}</span>
        {isLatest && <span className="diag-latest-chip">Latest</span>}
      </div>

      {diag.summary && <p className="diag-summary">{diag.summary}</p>}

      {alerts.length > 0 && (
        <div className="diag-alerts">
          {alerts.map((a, i) => <div key={i} className="diag-alert">⚠️ {a}</div>)}
        </div>
      )}

      {issues.length > 0 && (
        <div className="diag-section">
          <div className="diag-section-title">Issues detected</div>
          {issues.map((iss, i) => (
            <div key={i} className={`diag-issue diag-issue--${iss.severity}`}>
              <span className="diag-issue-name">{iss.issue}</span>
              {iss.description && <span className="diag-issue-desc">{iss.description}</span>}
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="diag-section">
          <div className="diag-section-title">Recommendations</div>
          <ul className="diag-recs">
            {recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {diag.plant_suggested && (
        <div className="diag-plant-suggest">
          💡 Camera AI thinks this might be: <strong>{diag.plant_suggested}</strong>
          &nbsp;— update your plant profile in the Plants tab.
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function CameraView() {
  // Frame display state
  const [currentImage,    setCurrentImage]    = useState(null);   // base64 string
  const [currentTime,     setCurrentTime]     = useState(null);   // ISO string
  const [cameraOnline,    setCameraOnline]    = useState(false);

  // Timeline state
  const [frames,          setFrames]          = useState([]);     // [{id, created_at}]
  const [timelineIdx,     setTimelineIdx]     = useState(-1);
  const [isLive,          setIsLive]          = useState(true);

  // Diagnosis state
  const [diagnoses,       setDiagnoses]       = useState([]);
  const [running,         setRunning]         = useState(false);
  const [runMsg,          setRunMsg]          = useState('');

  const [loadingDiag,     setLoadingDiag]     = useState(true);

  const pollRef           = useRef(null);
  const listRefreshRef    = useRef(null);
  const isLiveRef         = useRef(isLive);
  isLiveRef.current = isLive;

  // ── Fetch latest frame ─────────────────────────────────────────
  const fetchAndShowLatest = useCallback(async () => {
    try {
      const data = await fetchLatestFrame();
      if (data.id) {
        setCurrentImage(data.image);
        setCurrentTime(data.created_at);
        setCameraOnline(ageMs(data.created_at) < 20000); // online if < 20s old
      } else {
        setCameraOnline(false);
      }
    } catch (_) {
      setCameraOnline(false);
    }
  }, []);

  // ── Refresh frame list (for timeline) ─────────────────────────
  const refreshFrameList = useCallback(async () => {
    try {
      const list = await fetchFrameList();
      setFrames(list);
      if (isLiveRef.current) setTimelineIdx(list.length - 1);
    } catch (_) {}
  }, []);

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    fetchAndShowLatest();
    refreshFrameList();
    fetchDiagnoses().then(d => setDiagnoses(d)).catch(() => {}).finally(() => setLoadingDiag(false));
  }, [fetchAndShowLatest, refreshFrameList]);

  // ── Live polling — new frame every 5s ─────────────────────────
  useEffect(() => {
    if (!isLive) {
      clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(fetchAndShowLatest, 5000);
    return () => clearInterval(pollRef.current);
  }, [isLive, fetchAndShowLatest]);

  // ── Timeline list refresh every 10s ───────────────────────────
  useEffect(() => {
    listRefreshRef.current = setInterval(refreshFrameList, 10000);
    return () => clearInterval(listRefreshRef.current);
  }, [refreshFrameList]);

  // ── Timeline slider ───────────────────────────────────────────
  const handleSlider = async (e) => {
    const idx = Number(e.target.value);
    setIsLive(false);
    setTimelineIdx(idx);
    if (frames[idx]) {
      try {
        const data = await fetchFrame(frames[idx].id);
        setCurrentImage(data.image);
        setCurrentTime(data.created_at);
      } catch (_) {}
    }
  };

  const goLive = () => {
    setIsLive(true);
    setTimelineIdx(frames.length - 1);
    fetchAndShowLatest();
  };

  // ── AI diagnosis ──────────────────────────────────────────────
  const handleRunDiagnosis = async () => {
    setRunning(true);
    setRunMsg('');
    try {
      await runDiagnosis();
      const d = await fetchDiagnoses();
      setDiagnoses(d);
      setRunMsg('Done');
      setTimeout(() => setRunMsg(''), 3000);
    } catch (err) {
      setRunMsg(err.message);
    } finally {
      setRunning(false);
    }
  };

  // ── Build timeline label ──────────────────────────────────────
  const oldest = frames[0];
  const newest = frames[frames.length - 1];
  const selectedFrame = frames[timelineIdx];

  return (
    <div className="view-wrap cam-view">

      {/* ── Frame viewer ─────────────────────────────────── */}
      <div className="cam-viewer-card">

        {/* Header bar */}
        <div className="cam-viewer-header">
          <div className="cam-status-wrap">
            <span className={`cam-dot ${cameraOnline ? 'cam-dot--online' : 'cam-dot--offline'}`} />
            <span className="cam-status-label">
              {cameraOnline ? 'Camera Online' : 'Camera Offline'}
            </span>
          </div>
          <span className="cam-frame-time">
            {isLive ? '▶ LIVE' : '⏸ PAUSED'}&nbsp;·&nbsp;{fmtTime(currentTime)}
          </span>
        </div>

        {/* Image */}
        <div className="cam-img-wrap">
          {currentImage ? (
            <img
              src={`data:image/jpeg;base64,${currentImage}`}
              className="cam-main-img"
              alt="Greenhouse camera frame"
            />
          ) : (
            <div className="cam-no-frame">
              <div className="cam-no-frame-icon">📷</div>
              <div className="cam-no-frame-title">No frames yet</div>
              <div className="cam-no-frame-sub">
                Flash <code>greenhouse_cam.ino</code> to your ESP32-CAM.
                It will push a frame every 5 seconds automatically.
              </div>
            </div>
          )}
        </div>

        {/* Timeline controls */}
        {frames.length > 1 && (
          <div className="cam-timeline">
            <div className="cam-timeline-labels">
              <span>{fmtTime(oldest?.created_at)}</span>
              <span className="cam-tl-selected">
                {selectedFrame ? fmtDateTime(selectedFrame.created_at) : ''}
              </span>
              <span>{fmtTime(newest?.created_at)}</span>
            </div>
            <div className="cam-timeline-row">
              <input
                type="range"
                className="cam-timeline-slider"
                min={0}
                max={frames.length - 1}
                value={timelineIdx < 0 ? frames.length - 1 : timelineIdx}
                onChange={handleSlider}
              />
            </div>
            <div className="cam-timeline-footer">
              <span className="cam-frame-count">{frames.length} frames stored</span>
              <button
                className={`cam-live-btn${isLive ? ' cam-live-btn--active' : ''}`}
                onClick={goLive}
                disabled={isLive}
              >
                {isLive ? '● Live' : '▶ Go Live'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── AI Vision section ─────────────────────────────── */}
      <div className="cam-ai-header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>AI Plant Vision</h2>
        <div className="cam-ai-meta">
          <span>Hourly auto-diagnosis · Gemini Vision</span>
          <div className="cam-run-wrap">
            <button
              className="cam-run-btn"
              onClick={handleRunDiagnosis}
              disabled={running || !currentImage}
              title={!currentImage ? 'No frames yet' : 'Re-run AI on latest frame'}
            >
              {running ? '…' : '▶ Analyse now'}
            </button>
            {runMsg && <span className="cam-run-msg">{runMsg}</span>}
          </div>
        </div>
      </div>

      {loadingDiag ? (
        <div className="cam-loading">Loading diagnoses…</div>
      ) : diagnoses.length === 0 ? (
        <div className="cam-empty">
          No AI diagnoses yet. Runs automatically every hour, or click "Analyse now".
        </div>
      ) : (
        diagnoses.map((d, i) => <DiagCard key={d.id} diag={d} isLatest={i === 0} />)
      )}

    </div>
  );
}
