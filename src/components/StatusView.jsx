import React from 'react';
import { GaugeCard, BigCard } from './SensorCard';
import ControlCard from './ControlCard';
import HealthScore from './HealthScore';
import ModeSelector from './ModeSelector';
import AutopilotStatus from './AutopilotStatus';
import { waterInfo, soilInfo, lightInfo, tempInfo, humInfo } from '../utils';

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

export default function StatusView({ latest, state, plant, onStateChange, loading, mode, onModeChange }) {
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
          id="pump"   icon="💧" label="Water Pump"
          hint="Pin D10 — applied on next POST cycle"
          isOn={state.pump}
          onStateChange={onStateChange}
        />
        <ControlCard
          id="buzzer" icon="🔔" label="Buzzer"
          hint="Pin D6 — applied on next POST cycle"
          isOn={state.buzzer}
          onStateChange={onStateChange}
        />
      </div>

    </div>
  );
}
