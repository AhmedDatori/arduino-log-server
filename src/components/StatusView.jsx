import React from 'react';
import { GaugeCard, BigCard } from './SensorCard';
import ControlCard from './ControlCard';
import HealthScore from './HealthScore';
import { waterInfo, soilInfo, lightInfo, tempInfo, humInfo } from '../utils';

export default function StatusView({ latest, state, onStateChange, loading }) {
  // Pull sensor values directly from the latest log row
  const w = latest?.water ?? null;
  const s = latest?.soil  ?? null;
  const l = latest?.light ?? null;
  const t = latest?.temp  ?? null;
  const h = latest?.hum   ?? null;

  return (
    <div className="view-wrap">

      <HealthScore />

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
