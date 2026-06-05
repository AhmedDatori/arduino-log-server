import React, { useState, useEffect, useCallback } from 'react';
import { fetchCameraIp, fetchLatestPhoto, fetchDiagnoses, runDiagnosis } from '../api';
import './CameraView.css';

// ── Health badge ──────────────────────────────────────────────────
function HealthBadge({ score, status }) {
  const color =
    score >= 75 ? '#3dffa0' :
    score >= 50 ? '#f5a524' :
                  '#ff4d6d';
  return (
    <span
      className="diag-badge"
      style={{ color, borderColor: color + '44', background: color + '11' }}
    >
      {status} · {score}/100
    </span>
  );
}

// ── Single diagnosis card ─────────────────────────────────────────
function DiagCard({ diag, isLatest }) {
  const issues         = diag.issues         ?? [];
  const recommendations= diag.recommendations?? [];
  const alerts         = (diag.alerts ?? []).filter(Boolean);

  return (
    <div className={`diag-card${isLatest ? ' diag-card--latest' : ''}`}>
      <div className="diag-card-header">
        {diag.health_score != null
          ? <HealthBadge score={diag.health_score} status={diag.status} />
          : <span className="diag-badge diag-badge--na">{diag.status}</span>
        }
        <span className="diag-time">
          {new Date(diag.created_at).toLocaleString()}
        </span>
        {isLatest && <span className="diag-latest-chip">Latest</span>}
      </div>

      {diag.summary && <p className="diag-summary">{diag.summary}</p>}

      {alerts.length > 0 && (
        <div className="diag-alerts">
          {alerts.map((a, i) => (
            <div key={i} className="diag-alert">⚠️ {a}</div>
          ))}
        </div>
      )}

      {issues.length > 0 && (
        <div className="diag-section">
          <div className="diag-section-title">Issues detected</div>
          {issues.map((iss, i) => (
            <div key={i} className={`diag-issue diag-issue--${iss.severity}`}>
              <span className="diag-issue-name">{iss.issue}</span>
              {iss.description && (
                <span className="diag-issue-desc">{iss.description}</span>
              )}
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
          &nbsp;— go to Plants to update your profile.
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function CameraView() {
  const [cameraIp,    setCameraIp]    = useState(null);
  const [lastSeen,    setLastSeen]    = useState(null);
  const [latestPhoto, setLatestPhoto] = useState(null); // { src, at }
  const [diagnoses,   setDiagnoses]   = useState([]);
  const [streamError, setStreamError] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [running,     setRunning]     = useState(false);
  const [runMsg,      setRunMsg]      = useState('');

  const load = useCallback(async () => {
    try {
      const [ipData, photoData, diagData] = await Promise.all([
        fetchCameraIp(),
        fetchLatestPhoto(),
        fetchDiagnoses(),
      ]);
      setCameraIp(ipData.ip ?? null);
      setLastSeen(ipData.last_seen ?? null);
      setLatestPhoto(
        photoData.photo
          ? { src: photoData.photo, at: photoData.captured_at }
          : null
      );
      setDiagnoses(diagData);
    } catch (err) {
      console.error('[CameraView]', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRunDiagnosis = async () => {
    setRunning(true);
    setRunMsg('');
    try {
      await runDiagnosis();
      await load();
      setRunMsg('Done — scroll down for latest result');
      setTimeout(() => setRunMsg(''), 3000);
    } catch (err) {
      setRunMsg(err.message);
    } finally {
      setRunning(false);
    }
  };

  const streamUrl = cameraIp ? `http://${cameraIp}/stream` : null;

  return (
    <div className="view-wrap cam-view">

      {/* ── Live stream section ───────────────────────────── */}
      <h2 className="section-title">Live Camera Feed</h2>

      <div className="cam-stream-card">
        {cameraIp ? (
          <>
            <div className="cam-stream-wrap">
              {!streamError ? (
                <img
                  src={streamUrl}
                  className="cam-stream"
                  alt="Live greenhouse stream"
                  onError={() => setStreamError(true)}
                />
              ) : (
                <div className="cam-stream-offline">
                  <div className="cam-offline-icon">📷</div>
                  <div className="cam-offline-msg">
                    Stream not reachable from this browser
                    <span className="cam-offline-hint">
                      (requires same Wi-Fi network as the camera)
                    </span>
                  </div>
                  <a
                    href={streamUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="cam-open-link"
                  >
                    Try opening stream in new tab →
                  </a>
                </div>
              )}
            </div>

            <div className="cam-stream-footer">
              <span className="cam-ip-badge">
                {cameraIp}
                {lastSeen && (
                  <span className="cam-ip-seen">
                    &nbsp;· seen {new Date(lastSeen).toLocaleTimeString()}
                  </span>
                )}
              </span>
              <div className="cam-stream-links">
                <a href={`http://${cameraIp}/capture`} target="_blank" rel="noreferrer">
                  Download snapshot
                </a>
                <a href={streamUrl} target="_blank" rel="noreferrer">
                  Open stream
                </a>
              </div>
            </div>
          </>
        ) : (
          <div className="cam-no-device">
            <div className="cam-offline-icon">📷</div>
            <div className="cam-no-device-title">No camera registered</div>
            <div className="cam-no-device-sub">
              Flash <code>greenhouse_cam.ino</code> to your ESP32-CAM.
              It will automatically register its IP when it connects to Wi-Fi.
            </div>
          </div>
        )}
      </div>

      {/* ── AI Vision section ─────────────────────────────── */}
      <div className="cam-ai-header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          AI Plant Vision
        </h2>
        <div className="cam-ai-meta">
          <span>Hourly auto-diagnosis · Gemini Vision</span>
          <div className="cam-run-wrap">
            <button
              className="cam-run-btn"
              onClick={handleRunDiagnosis}
              disabled={running || !latestPhoto}
              title={
                !latestPhoto
                  ? 'No photo yet — wait for the camera to upload one'
                  : 'Re-run AI diagnosis on the latest stored photo'
              }
            >
              {running ? '…' : '▶ Analyse now'}
            </button>
            {runMsg && <span className="cam-run-msg">{runMsg}</span>}
          </div>
        </div>
      </div>

      {/* Latest stored photo */}
      {latestPhoto && (
        <div className="cam-latest-photo">
          <div className="cam-latest-label">
            Last captured photo
            &nbsp;·&nbsp;
            {new Date(latestPhoto.at).toLocaleString()}
          </div>
          <img
            src={`data:image/jpeg;base64,${latestPhoto.src}`}
            className="cam-photo-img"
            alt="Latest plant capture from ESP32-CAM"
          />
        </div>
      )}

      {/* Diagnosis history */}
      {loading ? (
        <div className="cam-loading">Loading diagnoses…</div>
      ) : diagnoses.length === 0 ? (
        <div className="cam-empty">
          No diagnoses yet. The camera sends a photo every hour for AI analysis.
        </div>
      ) : (
        diagnoses.map((d, i) => (
          <DiagCard key={d.id} diag={d} isLatest={i === 0} />
        ))
      )}

    </div>
  );
}
