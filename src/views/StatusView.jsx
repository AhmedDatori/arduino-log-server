import React, { useState, useEffect } from 'react';
import { GaugeCard, BigCard } from '../components/SensorCard';
import ControlCard from '../components/ControlCard';
import HealthScore from '../components/HealthScore';
import ModeSelector from '../components/ModeSelector';
import AutopilotStatus from '../components/AutopilotStatus';
import PredictionCard from '../components/PredictionCard';
import SensorFusionCard from '../components/SensorFusionCard';
import { waterInfo, soilInfo, lightInfo, tempInfo, humInfo } from '../utils';
import { setLedColor } from '../api';
import './StatusView.css';

// ── Plant vs sensor comparison ────────────────────────────────────
function sensorStatus(value, min, max) {
  if (value === null || value === undefined) return 'na';
  if (value >= min && value <= max) return 'good';
  const range   = max - min || 1;
  const outside = value < min ? min - value : value - max;
  return outside <= range * 0.25 ? 'fair' : 'poor';
}

const STATUS_META = {
  good: { label: 'Good',     color: '#3dffa0', bg: 'rgba(61,255,160,.08)',  border: 'rgba(61,255,160,.2)'  },
  fair: { label: 'Fair',     color: '#f5a524', bg: 'rgba(245,165,36,.08)',  border: 'rgba(245,165,36,.2)'  },
  poor: { label: 'Critical', color: '#ff4d6d', bg: 'rgba(255,77,109,.08)',  border: 'rgba(255,77,109,.2)'  },
  na:   { label: 'No data',  color: '#4a6080', bg: 'rgba(74,96,128,.06)',   border: 'rgba(74,96,128,.15)'  },
};

function PlantStatusBar({ latest, plant }) {
  if (!plant) return null;

  const sensors = [
    { icon: '🌿', label: 'Soil',  value: latest?.soil,  min: plant.soil_min,  max: plant.soil_max,  unit: '%'  },
    { icon: '🌡️', label: 'Temp',  value: latest?.temp,  min: plant.temp_min,  max: plant.temp_max,  unit: '°C' },
    { icon: '💦', label: 'Hum',   value: latest?.hum,   min: plant.hum_min,   max: plant.hum_max,   unit: '%'  },
    { icon: '☀️', label: 'Light', value: latest?.light, min: plant.light_min, max: plant.light_max, unit: '%'  },
  ];

  return (
    <div className="plant-status-bar">
      <div className="psb-header">
        <span className="psb-emoji">{plant.emoji}</span>
        <div>
          <div className="psb-name">{plant.name}</div>
          <div className="psb-sub">Active plant — comparing readings against ideal ranges</div>
        </div>
      </div>

      <div className="psb-sensors">
        {sensors.map(({ icon, label, value, min, max, unit }) => {
          const st  = sensorStatus(value, min, max);
          const m   = STATUS_META[st];
          const display = value !== null && value !== undefined
            ? `${typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(1) : value}${unit}`
            : '—';

          return (
            <div key={label} className="psb-sensor" style={{ background: m.bg, borderColor: m.border }}>
              <div className="psb-sensor-top">
                <span className="psb-sensor-icon">{icon}</span>
                <span className="psb-sensor-label">{label}</span>
                <span className="psb-sensor-badge" style={{ color: m.color }}>{m.label}</span>
              </div>
              <div className="psb-sensor-val" style={{ color: m.color }}>{display}</div>
              <div className="psb-sensor-ideal">Ideal: {min}–{max}{unit}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v ?? 0)).toString(16).padStart(2, '0')).join('');
}
function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function LedColorPicker({ r, g, b, onApplied }) {
  const [hex,     setHex]     = useState(rgbToHex(r, g, b));
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);

  useEffect(() => { setHex(rgbToHex(r, g, b)); }, [r, g, b]);

  const rgb = hexToRgb(hex);

  const handleApply = async () => {
    setSaving(true);
    try {
      await setLedColor(rgb.r, rgb.g, rgb.b);
      onApplied(rgb);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to set LED color:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="led-color-panel">
      <div className="led-color-header">
        <span className="led-color-icon">🎨</span>
        <div>
          <div className="led-color-title">LED Strip Color</div>
          <div className="led-color-sub">Choose the color of the grow light strip</div>
        </div>
      </div>
      <div className="led-color-body">
        <label className="led-swatch-wrap" title="Click to open color picker">
          <div className="led-swatch" style={{ background: hex, boxShadow: `0 0 24px ${hex}55` }} />
          <input type="color" className="led-color-input" value={hex} onChange={e => setHex(e.target.value)} />
        </label>

        <div className="led-rgb-values">
          {[['R', rgb.r, '#ff6b6b'], ['G', rgb.g, '#69db7c'], ['B', rgb.b, '#4dabf7']].map(([label, val, color]) => (
            <div key={label} className="led-rgb-row">
              <span className="led-rgb-label" style={{ color }}>{label}</span>
              <span className="led-rgb-val">{val}</span>
            </div>
          ))}
        </div>

        <div className="led-hex-display">{hex.toUpperCase()}</div>

        <button
          className={`led-apply-btn${saved ? ' led-saved' : ''}`}
          onClick={handleApply}
          disabled={saving}
        >
          {saving ? '…' : saved ? '✓ Saved' : 'Apply'}
        </button>
      </div>
    </div>
  );
}

export default function StatusView({ latest, state, plant, onStateChange, loading, mode, onModeChange }) {
  const [pumpDuration, setPumpDuration] = useState(10);
  // Pull sensor values directly from the latest log row
  const w = latest?.water ?? null;
  const s = latest?.soil  ?? null;
  const l = latest?.light ?? null;
  const t = latest?.temp  ?? null;
  const h = latest?.hum   ?? null;

  const autoControlled = mode !== 'manual';

  return (
    <div className="view-wrap">

      <HealthScore />

      <PlantStatusBar latest={latest} plant={plant} />

      <h2 className="section-title">Autopilot</h2>
      <ModeSelector mode={mode} onModeChange={onModeChange} />
      <AutopilotStatus mode={mode} />

      <h2 className="section-title">Sensor Intelligence</h2>
      <SensorFusionCard />

      <h2 className="section-title">Stress Forecast</h2>
      <PredictionCard />

      <div className="pump-dur-panel">
        <div className="pump-dur-header">
          <span>💧</span>
          <div>
            <div className="pump-dur-title">Pump Duration</div>
            <div className="pump-dur-sub">How long the pump runs each time it's activated manually or by autopilot</div>
          </div>
          <div className="pump-dur-value">{pumpDuration}s</div>
        </div>
        <input
          type="range" min={1} max={30} value={pumpDuration}
          className="pump-dur-slider"
          onChange={e => setPumpDuration(Number(e.target.value))}
        />
        <div className="pump-dur-labels">
          <span>1s</span><span>10s</span><span>20s</span><span>30s</span>
        </div>
      </div>

      <LedColorPicker
        r={state.led_r ?? 255} g={state.led_g ?? 255} b={state.led_b ?? 0}
        onApplied={rgb => onStateChange(s => ({ ...s, led_r: rgb.r, led_g: rgb.g, led_b: rgb.b }))}
      />

      <h2 className="section-title">Sensors</h2>
      <div className="sensor-grid">
        <GaugeCard
          icon="💧" label="Water Level"
          displayValue={w !== null ? String(w) : null}
          pct={waterInfo(w).pct}
          info={waterInfo(w)}
        />
        <GaugeCard
          icon="🌿" label="Soil Moisture"
          displayValue={s !== null ? `${s}%` : null}
          pct={s}
          info={soilInfo(s)}
        />
        <GaugeCard
          icon="☀️" label="Light"
          displayValue={l !== null ? `${l}%` : null}
          pct={l}
          info={lightInfo(l)}
        />
        <BigCard icon="🌡️" label="Temperature" value={t} unit="°C" info={tempInfo(t)} />
        <BigCard icon="💦" label="Humidity"     value={h} unit="%" info={humInfo(h)}  />
      </div>

      <h2 className="section-title">Controls</h2>
      {autoControlled && (
        <div className="ctrl-autopilot-note">
          {mode === 'ai' ? '🤖 AI Pilot' : '⚙️ Rules Engine'} is managing the controls — manual toggles still work as overrides
        </div>
      )}
      <div className="ctrl-grid">
        <ControlCard
          id="light"  icon="💡" label="Grow Light"
          hint="Pin D9 — applied on next POST cycle"
          isOn={state.light}
          onStateChange={onStateChange}
        />
        <ControlCard
          id="pump" icon="💧" label="Water Pump"
          hint={`Runs for ${pumpDuration}s then auto-stops`}
          isOn={state.pump}
          onStateChange={onStateChange}
          extraData={{ duration: pumpDuration }}
        />
        <ControlCard
          id="buzzer" icon="🔔" label="Buzzer"
          hint="Pin D6 — applied on next POST cycle"
          isOn={state.buzzer}
          onStateChange={onStateChange}
        />
        <ControlCard
          id="fan" icon="🌀" label="Fan"
          hint="Relay — on/off only, no speed control"
          isOn={state.fan}
          onStateChange={onStateChange}
        />
      </div>

    </div>
  );
}
