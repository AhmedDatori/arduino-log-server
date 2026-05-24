import React, { useState, useEffect, useCallback } from 'react';
import { fetchPlants, selectPlant, createPlant, updatePlant, deletePlant } from '../api';

const RANGES = [
  { key: 'soil',  icon: '🌿', label: 'Soil',  unit: '%',  minK: 'soil_min',  maxK: 'soil_max',  step: 1,   lo: 0,  hi: 100 },
  { key: 'temp',  icon: '🌡️', label: 'Temp',  unit: '°C', minK: 'temp_min',  maxK: 'temp_max',  step: 0.5, lo: -5, hi: 60  },
  { key: 'hum',   icon: '💦', label: 'Hum',   unit: '%',  minK: 'hum_min',   maxK: 'hum_max',   step: 1,   lo: 0,  hi: 100 },
  { key: 'light', icon: '☀️', label: 'Light', unit: '%',  minK: 'light_min', maxK: 'light_max', step: 1,   lo: 0,  hi: 100 },
];

const BLANK_FORM = {
  name: '', emoji: '🌱',
  soil_min: 40, soil_max: 70,
  temp_min: 18, temp_max: 28,
  hum_min:  40, hum_max:  70,
  light_min: 40, light_max: 80,
  notes: '',
};

function PlantCard({ plant, onSelect, onEdit, onDelete, isActive }) {
  return (
    <div
      className={`plant-card ${isActive ? 'is-active' : ''}`}
      onClick={() => !isActive && onSelect(plant.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && !isActive && onSelect(plant.id)}
      title={isActive ? 'Currently active' : `Switch to ${plant.name}`}
    >
      {isActive && <div className="plant-active-ribbon">✓ Active</div>}

      <div className="plant-emoji">{plant.emoji}</div>
      <div className="plant-name">{plant.name}</div>

      <div className="plant-ranges">
        {RANGES.map(r => (
          <div key={r.key} className="plant-range-row">
            <span className="plant-range-icon">{r.icon}</span>
            <span className="plant-range-label">{r.label}</span>
            <span className="plant-range-val">
              {plant[r.minK]}–{plant[r.maxK]}{r.unit}
            </span>
          </div>
        ))}
      </div>

      {plant.notes && (
        <p className="plant-notes">{plant.notes}</p>
      )}

      {!plant.is_preset && (
        <div className="plant-actions" onClick={e => e.stopPropagation()}>
          <button className="plant-btn-edit"   onClick={() => onEdit(plant)}>✏️ Edit</button>
          <button className="plant-btn-delete" onClick={() => onDelete(plant)}>🗑</button>
        </div>
      )}
    </div>
  );
}

function PlantForm({ initial, onSave, onCancel }) {
  const [form,  setForm]  = useState({ ...BLANK_FORM, ...initial });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Plant name is required'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="plant-form" onSubmit={handleSubmit}>
      <div className="plant-form-title">
        {initial?.id ? '✏️ Edit Plant' : '🌱 Add Custom Plant'}
      </div>

      {error && <div className="plant-form-error">{error}</div>}

      {/* Name + Emoji */}
      <div className="pf-row">
        <div className="pf-field" style={{ flex: 1 }}>
          <label>Plant Name</label>
          <input
            type="text"
            className="pf-input"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            placeholder="e.g. My Tomato"
            maxLength={40}
          />
        </div>
        <div className="pf-field" style={{ width: '80px' }}>
          <label>Emoji</label>
          <input
            type="text"
            className="pf-input"
            value={form.emoji}
            onChange={e => set('emoji', e.target.value)}
            maxLength={4}
            style={{ textAlign: 'center', fontSize: '1.3rem' }}
          />
        </div>
      </div>

      {/* Range fields */}
      {RANGES.map(r => (
        <div key={r.key} className="pf-range-row">
          <span className="pf-range-icon">{r.icon} {r.label}</span>
          <div className="pf-range-inputs">
            <input
              type="number"
              className="pf-input pf-num"
              value={form[r.minK]}
              onChange={e => set(r.minK, e.target.value)}
              min={r.lo} max={r.hi} step={r.step}
            />
            <span className="pf-dash">–</span>
            <input
              type="number"
              className="pf-input pf-num"
              value={form[r.maxK]}
              onChange={e => set(r.maxK, e.target.value)}
              min={r.lo} max={r.hi} step={r.step}
            />
            <span className="pf-unit">{r.unit}</span>
          </div>
        </div>
      ))}

      {/* Notes */}
      <div className="pf-field">
        <label>Notes <span style={{ color: '#2a3f58' }}>(optional)</span></label>
        <input
          type="text"
          className="pf-input"
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="e.g. Sensitive to frost"
          maxLength={120}
        />
      </div>

      <div className="pf-footer">
        <button type="button" className="btn-danger" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-generate" disabled={saving}>
          {saving ? '⏳ Saving…' : '💾 Save Plant'}
        </button>
      </div>
    </form>
  );
}

export default function PlantsView() {
  const [plants,  setPlants]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // null | 'new' | plant object
  const [msg,     setMsg]     = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchPlants();
      setPlants(data);
    } catch (_) {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (text) => { setMsg(text); setTimeout(() => setMsg(''), 3000); };

  const handleSelect = async (id) => {
    try {
      const updated = await selectPlant(id);
      setPlants(ps => ps.map(p => ({ ...p, is_active: p.id === updated.id })));
      flash(`✅ Now monitoring ${updated.emoji} ${updated.name}`);
    } catch (_) { flash('Failed to switch plant'); }
  };

  const handleSave = async (form) => {
    if (editing?.id) {
      const updated = await updatePlant(editing.id, form);
      setPlants(ps => ps.map(p => p.id === updated.id ? updated : p));
      flash('✅ Plant updated');
    } else {
      const created = await createPlant(form);
      setPlants(ps => [...ps, created]);
      flash(`✅ ${created.emoji} ${created.name} added`);
    }
    setEditing(null);
  };

  const handleDelete = async (plant) => {
    if (!confirm(`Delete "${plant.name}"? This cannot be undone.`)) return;
    try {
      await deletePlant(plant.id);
      setPlants(ps => ps.filter(p => p.id !== plant.id));
      flash('🗑 Plant deleted');
    } catch (_) { flash('Failed to delete plant'); }
  };

  const presets = plants.filter(p => p.is_preset);
  const custom  = plants.filter(p => !p.is_preset);
  const active  = plants.find(p => p.is_active);

  return (
    <div className="view-wrap">

      <div className="view-header">
        <h2 className="section-title" style={{ margin: 0 }}>🌿 Plant Profiles</h2>
        {editing ? (
          <button className="btn-danger" onClick={() => setEditing(null)}>✕ Cancel</button>
        ) : (
          <button className="btn-generate" onClick={() => setEditing('new')}>
            + Add Custom Plant
          </button>
        )}
      </div>

      {msg && <div className="plant-flash">{msg}</div>}

      <p className="reports-info">
        Select your plant type so the AI can give accurate, species-specific advice.
        {active && <> Currently monitoring: <strong style={{ color: '#3dffa0' }}>{active.emoji} {active.name}</strong>.</>}
      </p>

      {/* Add / Edit form */}
      {editing && (
        <PlantForm
          initial={editing === 'new' ? null : editing}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {loading ? (
        <div className="reports-empty"><span>⏳</span><p>Loading plants…</p></div>
      ) : (
        <>
          {/* Preset plants */}
          <h3 className="plants-section-label">🌍 Common Plants</h3>
          <div className="plants-grid">
            {presets.map(p => (
              <PlantCard
                key={p.id} plant={p}
                isActive={p.is_active}
                onSelect={handleSelect}
                onEdit={setEditing}
                onDelete={handleDelete}
              />
            ))}
          </div>

          {/* Custom plants */}
          <h3 className="plants-section-label" style={{ marginTop: '2rem' }}>
            ✏️ My Custom Plants
            {custom.length === 0 && <span style={{ color: '#2a3f58', fontWeight: 400, fontSize: '11px', marginLeft: '.5rem' }}>— none yet</span>}
          </h3>
          {custom.length > 0 && (
            <div className="plants-grid">
              {custom.map(p => (
                <PlantCard
                  key={p.id} plant={p}
                  isActive={p.is_active}
                  onSelect={handleSelect}
                  onEdit={setEditing}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
