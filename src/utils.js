// ─── Time ──────────────────────────────────────────────────────────
export function ago(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 5)    return 'just now';
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ─── Sensor status info ────────────────────────────────────────────
// Each function returns { label, color } where color is a CSS hex value.

export function waterInfo(v) {
  if (v === null || v === undefined) return { label: 'N/A',   color: '#4a6080', pct: 0 };
  const pct = Math.round(v / 1023 * 100);
  if (v < 200) return { label: 'EMPTY', color: '#ff4d6d', pct };
  if (v < 500) return { label: 'LOW',   color: '#f5a524', pct };
  if (v < 800) return { label: 'MED',   color: '#f5a524', pct };
  return             { label: 'FULL',  color: '#3dffa0', pct };
}

export function soilInfo(v) {
  if (v === null || v === undefined) return { label: 'N/A', color: '#4a6080' };
  if (v < 30) return { label: 'DRY', color: '#ff4d6d' };
  if (v < 60) return { label: 'OK',  color: '#f5a524' };
  return             { label: 'WET', color: '#3dffa0' };
}

export function lightInfo(v) {
  if (v === null || v === undefined) return { label: 'N/A',    color: '#4a6080' };
  if (v < 20) return { label: 'DARK',   color: '#4a6080' };
  if (v < 60) return { label: 'DIM',    color: '#f5a524' };
  return             { label: 'BRIGHT', color: '#3dffa0' };
}

export function tempInfo(v) {
  if (v === null || v === undefined) return { label: 'N/A',    color: '#4a6080' };
  if (v < 10) return { label: 'COLD',   color: '#38b2f8' };
  if (v > 35) return { label: 'HOT',    color: '#ff4d6d' };
  return             { label: 'NORMAL', color: '#3dffa0' };
}

export function humInfo(v) {
  if (v === null || v === undefined) return { label: 'N/A',   color: '#4a6080' };
  if (v < 30) return { label: 'DRY',   color: '#ff4d6d' };
  if (v > 70) return { label: 'HUMID', color: '#38b2f8' };
  return             { label: 'GOOD',  color: '#3dffa0' };
}
