'use strict';


// ─── Trend helper (linear regression slope) ───────────────────────
// Returns change-per-reading (negative = falling, positive = rising)
function computeTrend(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  values.forEach((y, x) => { num += (x - xMean) * (y - yMean); den += (x - xMean) ** 2; });
  return den === 0 ? 0 : num / den;
}

module.exports = { computeTrend };
