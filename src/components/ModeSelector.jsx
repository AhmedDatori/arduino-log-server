import React, { useState } from 'react';
import { setMode as apiSetMode } from '../api';
import './ModeSelector.css';

const MODES = [
  {
    id:   'manual',
    icon: '🖐️',
    label: 'Manual',
    desc:  'You control everything',
  },
  {
    id:   'rules',
    icon: '⚙️',
    label: 'Rules',
    desc:  'Arduino threshold rules',
  },
  {
    id:   'ai',
    icon: '🤖',
    label: 'AI Pilot',
    desc:  'Gemini AI decides',
  },
];

export default function ModeSelector({ mode, onModeChange }) {
  const [loading, setLoading] = useState(false);

  const handleSelect = async (newMode) => {
    if (newMode === mode || loading) return;
    setLoading(true);
    try {
      await apiSetMode(newMode);
      onModeChange(newMode);
    } catch (err) {
      console.error('[ModeSelector]', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mode-selector">
      <div className="mode-selector-row">
        {MODES.map(m => (
          <button
            key={m.id}
            className={`mode-btn ${mode === m.id ? 'active' : ''}`}
            onClick={() => handleSelect(m.id)}
            disabled={loading}
            title={m.desc}
          >
            <span className="mode-btn-icon">{m.icon}</span>
            <span className="mode-btn-label">{m.label}</span>
            <span className="mode-btn-desc">{m.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
