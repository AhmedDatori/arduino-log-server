import React, { useState } from 'react';
import { postControl } from '../api';
import './ControlCard.css';

export default function ControlCard({ id, icon, label, hint, isOn, onStateChange, extraData = {} }) {
  const [loading, setLoading] = useState(false);

  const toggle = async (e) => {
    // Allow keyboard activation but don't double-fire on button clicks inside
    if (loading) return;
    setLoading(true);
    try {
      const res = await postControl(id, isOn ? 0 : 1, extraData);
      if (res.state) onStateChange(res.state);
    } catch (err) {
      console.error(`Control ${id} failed:`, err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`ctrl-card ${isOn ? 'is-on' : ''} ${loading ? 'is-loading' : ''}`}
      onClick={toggle}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && toggle()}
      role="switch"
      aria-checked={isOn}
      tabIndex={0}
    >
      <div className="ctrl-icon">{icon}</div>
      <div className="ctrl-label">{label}</div>

      <div className="ctrl-toggle-row">
        <div className="toggle-track">
          <div className="toggle-thumb" />
        </div>
        <span className="ctrl-state-text">{loading ? '…' : (isOn ? 'ON' : 'OFF')}</span>
      </div>

      <div className="ctrl-hint">{hint}</div>
    </div>
  );
}
