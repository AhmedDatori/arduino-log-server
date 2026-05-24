import React, { useState } from 'react';
import { postControl } from '../api';

export default function ControlCard({ id, icon, label, hint, isOn, onStateChange }) {
  const [loading, setLoading] = useState(false);

  const toggle = async (value) => {
    setLoading(true);
    try {
      const res = await postControl(id, value);
      if (res.state) onStateChange(res.state);
    } catch (err) {
      console.error(`Control ${id} failed:`, err.message);
    } finally {
      setLoading(false);
    }
  };

  const accent = isOn ? '#3dffa0' : '#4a6080';

  return (
    <div className="ctrl-card" style={{ '--accent': accent }}>
      <div className="card-icon">{icon}</div>
      <div className="card-label">{label}</div>
      <div className="ctrl-state" style={{ color: accent }}>
        {isOn !== undefined ? (isOn ? 'ON' : 'OFF') : '—'}
      </div>
      <div className="ctrl-btns">
        <button
          className={`btn-on ${isOn ? 'active' : ''}`}
          onClick={() => toggle(1)}
          disabled={loading}
        >
          ● ON
        </button>
        <button
          className={`btn-off ${!isOn ? 'active' : ''}`}
          onClick={() => toggle(0)}
          disabled={loading}
        >
          ○ OFF
        </button>
      </div>
      <div className="ctrl-hint">{hint}</div>
    </div>
  );
}
