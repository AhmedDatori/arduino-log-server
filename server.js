'use strict';

const express = require('express');
const app  = express();
const PORT = process.env.PORT || 3000;
const logs = [];
let   nextId = 1;

// ── Actuator state (set by dashboard, read by Arduino via POST /log response) ──
const state = { light: false, pump: false };

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── POST /log  ← Arduino sends sensor data here ────────────────────
app.post('/log', (req, res) => {
  const entry = {
    id:      nextId++,
    message: String(req.body.message || '(no message)'),
    device:  String(req.body.device  || 'ESP-01'),
    ip:      String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''),
    time:    new Date().toISOString()
  };
  logs.unshift(entry);
  if (logs.length > 200) logs.pop();
  console.log('[LOG]', entry.device, '->', entry.message);
  // Piggyback current actuator state onto the response — Arduino reads this!
  res.json({ success: true, id: entry.id, light: state.light ? 1 : 0, pump: state.pump ? 1 : 0 });
});

// ── GET /api/logs  ← dashboard polls ───────────────────────────────
app.get('/api/logs', (req, res) => { res.json(logs.slice(0, 100)); });

// ── DELETE /api/logs  ← clear button ───────────────────────────────
app.delete('/api/logs', (req, res) => {
  logs.length = 0; nextId = 1;
  res.json({ success: true });
});

// ── POST /api/control  ← dashboard sends commands ──────────────────
app.post('/api/control', (req, res) => {
  const { device, value } = req.body;
  const on = value === '1' || value === 1 || value === true || value === 'true';
  if (device === 'light') state.light = on;
  if (device === 'pump')  state.pump  = on;
  console.log('[CTRL]', device.toUpperCase(), '->', on ? 'ON' : 'OFF');
  res.json({ success: true, state });
});

// ── GET /api/state  ← dashboard reads current state ────────────────
app.get('/api/state', (req, res) => { res.json(state); });

// ── Dashboard HTML ─────────────────────────────────────────────────
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Plant Monitor</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@500;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow-x:hidden}
body{
  background:#060b11;color:#cdd9e8;
  font-family:'DM Sans',sans-serif;font-size:14px;line-height:1.5;
}
body::before{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(ellipse 55% 45% at 10% 10%, rgba(61,255,160,0.05) 0%, transparent 65%),
    radial-gradient(ellipse 45% 40% at 90% 90%, rgba(56,178,248,0.04) 0%, transparent 65%);
}
/* ── Header ── */
header{
  position:sticky;top:0;z-index:100;height:62px;
  background:rgba(6,11,17,0.9);backdrop-filter:blur(14px);
  border-bottom:1px solid #1a2d42;
}
.hinner{
  max-width:1120px;margin:0 auto;height:100%;
  padding:0 1.5rem;display:flex;align-items:center;gap:1.25rem;
}
.logo{
  font-family:'Syne',sans-serif;font-weight:800;font-size:1.05rem;
  color:#cdd9e8;letter-spacing:-.02em;white-space:nowrap;
  display:flex;align-items:center;gap:9px;
}
.logo-icon{width:26px;height:26px;flex-shrink:0}
.logo em{color:#3dffa0;font-style:normal}
.tabs{display:flex;position:relative;gap:0}
.tab{
  background:none;border:none;cursor:pointer;
  font-family:'DM Sans',sans-serif;font-size:11px;font-weight:600;
  letter-spacing:.09em;text-transform:uppercase;
  color:#4a6080;padding:8px 20px;transition:color .2s;
}
.tab.active{color:#3dffa0}
.tab-bar{
  position:absolute;bottom:-1px;height:2px;left:0;width:0;
  background:#3dffa0;border-radius:2px 2px 0 0;
  box-shadow:0 0 10px rgba(61,255,160,.7);
  transition:transform .32s cubic-bezier(.4,0,.2,1),width .32s cubic-bezier(.4,0,.2,1);
}
.h-right{margin-left:auto;display:flex;align-items:center;gap:10px}
.live{
  display:inline-flex;align-items:center;gap:6px;
  font-size:10px;font-weight:700;letter-spacing:.1em;color:#3dffa0;
  padding:4px 11px;border-radius:20px;
  border:1px solid rgba(61,255,160,.28);background:rgba(61,255,160,.07);
}
.pulse{
  width:6px;height:6px;border-radius:50%;background:#3dffa0;
  box-shadow:0 0 6px #3dffa0;animation:blink 1.8s ease-in-out infinite;
}
@keyframes blink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.7)}}
.icon-btn{
  background:none;border:1px solid #1a2d42;border-radius:8px;
  color:#7a94b0;padding:6px 11px;cursor:pointer;font-size:15px;
  transition:all .2s;
}
.icon-btn:hover{border-color:#3dffa0;color:#3dffa0}
/* ── Views ── */
.view{display:none}.view.active{display:block;animation:fadeUp .3s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.wrap{max-width:1120px;margin:0 auto;padding:1.5rem;position:relative;z-index:1}
/* ── Stats strip ── */
.stats-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:1.5rem}
.stat-chip{
  background:#0f1a28;border:1px solid #1a2d42;border-radius:14px;padding:16px 20px;
}
.stat-chip-label{
  font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:#4a6080;margin-bottom:8px;
}
.stat-chip-val{
  font-family:'JetBrains Mono',monospace;font-size:1.65rem;font-weight:700;
  color:#3dffa0;line-height:1;
}
.stat-chip-val.sm{font-size:.95rem;color:#cdd9e8;padding-top:3px}
/* ── Sensor grid ── */
.sensor-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(185px,1fr));
  gap:14px;
}
/* ── Sensor card ── */
.scard{
  background:#0f1a28;border:1px solid #1a2d42;border-radius:18px;
  padding:20px 14px 18px;
  display:flex;flex-direction:column;align-items:center;gap:10px;
  position:relative;overflow:hidden;
  transition:transform .22s,box-shadow .22s,border-color .3s;
  opacity:0;animation:cardIn .4s ease forwards;
}
.scard::before{
  content:'';position:absolute;top:0;left:0;right:0;height:2.5px;
  background:var(--c,#4a6080);border-radius:18px 18px 0 0;opacity:.75;
}
.scard:hover{transform:translateY(-4px);box-shadow:0 14px 40px rgba(0,0,0,.45)}
.scard:nth-child(1){animation-delay:.05s}.scard:nth-child(2){animation-delay:.10s}
.scard:nth-child(3){animation-delay:.15s}.scard:nth-child(4){animation-delay:.20s}
.scard:nth-child(5){animation-delay:.25s}
@keyframes cardIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
.scard-icon{font-size:1.4rem;line-height:1;margin-bottom:-2px}
.scard-label{
  font-size:10px;font-weight:600;letter-spacing:.11em;text-transform:uppercase;
  color:#4a6080;text-align:center;
}
/* Gauge */
.gauge-wrap{position:relative;width:112px;height:112px}
.gauge-wrap svg{width:112px;height:112px;display:block}
.gauge-arc{transition:stroke-dasharray .85s cubic-bezier(.4,0,.2,1)}
.gauge-center{
  position:absolute;inset:0;
  display:flex;align-items:center;justify-content:center;
}
.gauge-val{
  font-family:'JetBrains Mono',monospace;font-size:1.3rem;font-weight:700;
  color:#cdd9e8;line-height:1;
}
/* Big number (temp/hum) */
.bignum-wrap{
  flex:1;display:flex;align-items:center;justify-content:center;padding:16px 0;
}
.num-val{
  font-family:'JetBrains Mono',monospace;font-size:2.6rem;font-weight:700;
  color:#cdd9e8;line-height:1;
}
.num-unit{font-size:1.1rem;color:#7a94b0;margin-left:3px}
.num-na{font-family:'JetBrains Mono',monospace;font-size:1.6rem;color:#4a6080}
.status-badge{
  font-size:10px;font-weight:700;letter-spacing:.1em;
  padding:4px 12px;border-radius:20px;border:1px solid;
  transition:all .4s;
}
.no-data{grid-column:1/-1;text-align:center;padding:5rem 0;color:#4a6080}
.no-data-icon{font-size:3rem;margin-bottom:1rem;opacity:.3}
/* ── Section divider ── */
.section-hdr{
  display:flex;align-items:center;gap:12px;
  font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;
  color:#4a6080;margin:1.75rem 0 1rem;
}
.section-hdr::after{content:'';flex:1;height:1px;background:#1a2d42}
/* ── Control cards ── */
.ctrl-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill,minmax(220px,1fr));
  gap:14px;
}
.ctrl-card{
  background:#0f1a28;border:1px solid #1a2d42;border-radius:18px;
  padding:22px 18px 20px;
  display:flex;flex-direction:column;align-items:center;gap:14px;
  position:relative;overflow:hidden;
  transition:border-color .3s,box-shadow .3s;
}
.ctrl-card::before{
  content:'';position:absolute;top:0;left:0;right:0;height:2.5px;
  background:var(--c,#4a6080);border-radius:18px 18px 0 0;
  transition:background .4s;
}
.ctrl-card:hover{box-shadow:0 10px 32px rgba(0,0,0,.4)}
.ctrl-icon{font-size:2rem;line-height:1}
.ctrl-name{
  font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
  color:#7a94b0;
}
.ctrl-state-val{
  font-family:'JetBrains Mono',monospace;font-size:1.7rem;font-weight:700;
  color:var(--c,#4a6080);letter-spacing:.06em;transition:color .4s;
  line-height:1;
}
.ctrl-btns{display:flex;gap:10px;width:100%}
.cbon,.cboff{
  flex:1;padding:11px 0;border-radius:11px;border:1px solid;
  font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;
  cursor:pointer;letter-spacing:.06em;
  transition:background .2s,color .2s,border-color .2s,transform .1s;
}
.cbon:active,.cboff:active{transform:scale(.97)}
.cbon{color:#3dffa0;border-color:rgba(61,255,160,.3);background:rgba(61,255,160,.07)}
.cboff{color:#ff4d6d;border-color:rgba(255,77,109,.3);background:rgba(255,77,109,.07)}
.ctrl-hint{font-size:10px;color:#2a3f58;text-align:center;line-height:1.4}
/* ── History ── */
.hist-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
.hist-title{font-family:'Syne',sans-serif;font-size:1.1rem;font-weight:700;color:#cdd9e8}
.btn-clear{
  background:none;border:1px solid rgba(255,77,109,.3);
  color:#ff4d6d;border-radius:8px;padding:6px 16px;
  font-family:'DM Sans',sans-serif;font-size:12px;font-weight:600;
  cursor:pointer;transition:all .2s;
}
.btn-clear:hover{background:rgba(255,77,109,.1);border-color:#ff4d6d}
.table-wrap{overflow-x:auto;border-radius:14px;border:1px solid #1a2d42}
table{width:100%;border-collapse:collapse;font-size:12px}
thead{background:#0d1620;border-bottom:1px solid #1a2d42}
th{
  padding:11px 14px;text-align:left;font-size:10px;font-weight:600;
  letter-spacing:.1em;text-transform:uppercase;color:#4a6080;white-space:nowrap;
}
td{
  padding:10px 14px;border-bottom:1px solid rgba(26,45,66,.5);
  font-family:'JetBrains Mono',monospace;
}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(255,255,255,.02)}
.td-num{color:#2a3f58;font-size:11px}
.td-time{color:#7a94b0;font-size:11px;white-space:nowrap}
.td-ago{color:#4a6080;font-size:10px;display:block}
.td-dev{color:#38b2f8}
.cv-g{color:#3dffa0}.cv-a{color:#f5a524}.cv-r{color:#ff4d6d}
.cv-b{color:#38b2f8}.cv-m{color:#4a6080}
.empty-row td{text-align:center;padding:3rem;color:#4a6080}
/* ── Responsive ── */
@media(max-width:640px){
  .hinner{padding:0 1rem;gap:.75rem}
  .logo span:last-child{display:none}
  .stats-strip{grid-template-columns:1fr 1fr}
  .stats-strip .stat-chip:last-child{grid-column:span 2}
  .sensor-grid,.ctrl-grid{grid-template-columns:1fr 1fr}
  .wrap{padding:1rem}
  .tab{padding:8px 14px}
}
@media(max-width:400px){
  .sensor-grid,.ctrl-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>

<header>
  <div class="hinner">
    <div class="logo">
      <svg class="logo-icon" viewBox="0 0 24 24" fill="none">
        <path d="M12 22C12 22 4 16 4 9a7 7 0 0 1 10.9-5.8" stroke="#3dffa0" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M12 22C12 22 20 16 20 9a7 7 0 0 0-3-5.8" stroke="#3dffa0" stroke-width="1.6" stroke-linecap="round"/>
        <path d="M12 22V11" stroke="#3dffa0" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>PLANT<em>.</em>MONITOR</span>
    </div>
    <nav class="tabs">
      <button class="tab active" data-tab="status"  onclick="switchTab('status')">Status</button>
      <button class="tab"        data-tab="history" onclick="switchTab('history')">History</button>
      <div class="tab-bar" id="tab-bar"></div>
    </nav>
    <div class="h-right">
      <div class="live"><span class="pulse"></span>LIVE</div>
      <button class="icon-btn" onclick="forceRefresh()" title="Refresh">&#8635;</button>
    </div>
  </div>
</header>

<!-- STATUS VIEW -->
<div class="view active" id="view-status">
  <div class="wrap">
    <div class="stats-strip">
      <div class="stat-chip">
        <div class="stat-chip-label">Total Logs</div>
        <div class="stat-chip-val" id="s-total">—</div>
      </div>
      <div class="stat-chip">
        <div class="stat-chip-label">Last Seen</div>
        <div class="stat-chip-val sm" id="s-last">—</div>
      </div>
      <div class="stat-chip">
        <div class="stat-chip-label">Device</div>
        <div class="stat-chip-val sm" id="s-device">—</div>
      </div>
    </div>

    <!-- Sensor cards -->
    <div class="sensor-grid" id="sensor-grid">
      <div class="no-data">
        <div class="no-data-icon">&#127807;</div>
        <div>Waiting for Arduino&#8230;</div>
      </div>
    </div>

    <!-- Controls -->
    <div class="section-hdr">Controls</div>
    <div class="ctrl-grid">

      <div class="ctrl-card" id="ctrl-light" style="--c:#4a6080">
        <div class="ctrl-icon">&#128161;</div>
        <div class="ctrl-name">Grow Light</div>
        <div class="ctrl-state-val" id="cst-light">—</div>
        <div class="ctrl-btns">
          <button class="cbon"  onclick="control('light',1)">&#9679; ON</button>
          <button class="cboff" onclick="control('light',0)">&#9675; OFF</button>
        </div>
        <div class="ctrl-hint">Pin D9 &mdash; applied on next Arduino POST</div>
      </div>

      <div class="ctrl-card" id="ctrl-pump" style="--c:#4a6080">
        <div class="ctrl-icon">&#128167;</div>
        <div class="ctrl-name">Water Pump</div>
        <div class="ctrl-state-val" id="cst-pump">—</div>
        <div class="ctrl-btns">
          <button class="cbon"  onclick="control('pump',1)">&#9679; ON</button>
          <button class="cboff" onclick="control('pump',0)">&#9675; OFF</button>
        </div>
        <div class="ctrl-hint">Pin D10 &mdash; applied on next Arduino POST</div>
      </div>

    </div>
  </div>
</div>

<!-- HISTORY VIEW -->
<div class="view" id="view-history">
  <div class="wrap">
    <div class="hist-header">
      <div class="hist-title">Log History</div>
      <button class="btn-clear" onclick="clearLogs()">&#128465; Clear All</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Time</th><th>Device</th>
            <th>Water</th><th>Soil</th><th>Light</th>
            <th>Temp</th><th>Hum</th>
          </tr>
        </thead>
        <tbody id="hist-body"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
// ── Tab ──────────────────────────────────────────────────────────
var currentTab = 'status';
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  document.querySelector('.tab[data-tab="' + tab + '"]').classList.add('active');
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('active'); });
  document.getElementById('view-' + tab).classList.add('active');
  positionBar();
}
function positionBar() {
  var active = document.querySelector('.tab.active');
  var bar    = document.getElementById('tab-bar');
  var nav    = document.querySelector('.tabs');
  if (!active || !bar || !nav) return;
  var nr = nav.getBoundingClientRect(), ar = active.getBoundingClientRect();
  bar.style.width     = ar.width + 'px';
  bar.style.transform = 'translateX(' + (ar.left - nr.left) + 'px)';
}

// ── Sensor parsing ───────────────────────────────────────────────
function parseSensor(msg) {
  var kv = {};
  (msg || '').split(',').forEach(function(p) {
    var i = p.indexOf(':');
    if (i > 0) kv[p.slice(0,i).trim()] = p.slice(i+1).trim();
  });
  function num(k) {
    return (kv[k] !== undefined && kv[k] !== 'N/A') ? parseFloat(kv[k]) : null;
  }
  return { water:num('water'), soil:num('soil'), light:num('light'), temp:num('temp'), hum:num('hum') };
}
function ago(iso) {
  var s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60)   return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  return Math.floor(s/3600) + 'h ago';
}

// ── Color constants ──────────────────────────────────────────────
var G='#3dffa0', A='#f5a524', R='#ff4d6d', B='#38b2f8', M='#4a6080';
var GB='rgba(61,255,160,.12)', AB='rgba(245,165,36,.12)';
var RB='rgba(255,77,109,.12)', BB='rgba(56,178,248,.12)', MB='rgba(74,96,128,.12)';

// ── Status helpers ───────────────────────────────────────────────
function waterInfo(v) {
  if (v===null) return {label:'N/A',   color:M, bg:MB, pct:0};
  var p=Math.round(v/1023*100);
  if (v<200)  return {label:'EMPTY',  color:R, bg:RB, pct:p};
  if (v<500)  return {label:'LOW',    color:A, bg:AB, pct:p};
  if (v<800)  return {label:'MEDIUM', color:A, bg:AB, pct:p};
  return             {label:'FULL',   color:G, bg:GB, pct:p};
}
function soilInfo(v) {
  if (v===null) return {label:'N/A',color:M,bg:MB};
  if (v<30)    return {label:'DRY', color:R,bg:RB};
  if (v<60)    return {label:'OK',  color:A,bg:AB};
  return              {label:'WET', color:G,bg:GB};
}
function lightInfo(v) {
  if (v===null) return {label:'N/A',   color:M,bg:MB};
  if (v<20)    return {label:'DARK',  color:M,bg:MB};
  if (v<60)    return {label:'DIM',   color:A,bg:AB};
  return              {label:'BRIGHT',color:G,bg:GB};
}
function tempInfo(v) {
  if (v===null) return {label:'N/A',   color:M,bg:MB};
  if (v<10)    return {label:'COLD',  color:B,bg:BB};
  if (v>35)    return {label:'HOT',   color:R,bg:RB};
  return              {label:'NORMAL',color:G,bg:GB};
}
function humInfo(v) {
  if (v===null) return {label:'N/A',  color:M,bg:MB};
  if (v<30)    return {label:'DRY',  color:R,bg:RB};
  if (v>70)    return {label:'HUMID',color:B,bg:BB};
  return              {label:'GOOD', color:G,bg:GB};
}
function colorCls(c) {
  return c===G?'cv-g':c===A?'cv-a':c===R?'cv-r':c===B?'cv-b':'cv-m';
}

// ── Gauge SVG ────────────────────────────────────────────────────
var CIRC=263.9, MAXARC=197.9;
function gauge(pct, color) {
  var p = Math.min(100, Math.max(0, isNaN(pct)?0:pct));
  var arc = (MAXARC * p / 100).toFixed(1);
  var gap = (CIRC - parseFloat(arc)).toFixed(1);
  return '<svg viewBox="0 0 120 120">'
    + '<circle r="42" cx="60" cy="60" fill="none" stroke="#162234" stroke-width="9"'
    + ' stroke-dasharray="197.9 66.0" transform="rotate(135 60 60)" stroke-linecap="round"/>'
    + '<circle r="42" cx="60" cy="60" fill="none" stroke="' + color + '" stroke-width="9"'
    + ' stroke-dasharray="' + arc + ' ' + gap + '" transform="rotate(135 60 60)"'
    + ' stroke-linecap="round" class="gauge-arc"/>'
    + '</svg>';
}

// ── Render sensor cards ──────────────────────────────────────────
function badge(info) {
  return '<div class="status-badge" style="color:' + info.color + ';background:' + info.bg + ';border-color:' + info.color + '">' + info.label + '</div>';
}
function gaugeCard(icon, label, valStr, pct, info) {
  return '<div class="scard" style="--c:' + info.color + '">'
    + '<div class="scard-icon">' + icon + '</div>'
    + '<div class="scard-label">' + label + '</div>'
    + '<div class="gauge-wrap">' + gauge(pct, info.color)
    + '<div class="gauge-center"><div class="gauge-val">' + valStr + '</div></div></div>'
    + badge(info) + '</div>';
}
function bigCard(icon, label, val, unit, info) {
  var inner = val===null
    ? '<span class="num-na">N/A</span>'
    : '<span class="num-val">' + val.toFixed(1) + '</span><span class="num-unit">' + unit + '</span>';
  return '<div class="scard" style="--c:' + info.color + '">'
    + '<div class="scard-icon">' + icon + '</div>'
    + '<div class="scard-label">' + label + '</div>'
    + '<div class="bignum-wrap">' + inner + '</div>'
    + badge(info) + '</div>';
}
function renderCards(s) {
  var wi=waterInfo(s.water), si=soilInfo(s.soil), li=lightInfo(s.light);
  var ti=tempInfo(s.temp), hi=humInfo(s.hum);
  return gaugeCard('&#128167;','Water Level',   s.water!==null?String(s.water):'—', wi.pct,  wi)
       + gaugeCard('&#127807;','Soil Moisture', s.soil!==null?s.soil+'%':'—',       s.soil,  si)
       + gaugeCard('&#9728;',  'Light',         s.light!==null?s.light+'%':'—',     s.light, li)
       + bigCard('&#127777;',  'Temperature', s.temp, '&#176;C', ti)
       + bigCard('&#128166;',  'Humidity',    s.hum,  '%',       hi);
}

// ── Render history ───────────────────────────────────────────────
function cvCell(val, infoFn, display) {
  if (val===null) return '<span class="cv-m">—</span>';
  var i=infoFn(val);
  return '<span class="' + colorCls(i.color) + '">' + display + '</span>';
}
function wLabel(v) {
  if (v===null) return '—';
  if (v<200) return 'EMPTY'; if (v<500) return 'LOW';
  if (v<800) return 'MEDIUM'; return 'FULL';
}
function renderHistory(data) {
  if (!data.length) return '<tr class="empty-row"><td colspan="8">No logs yet</td></tr>';
  return data.map(function(l,i) {
    var s=parseSensor(l.message), wi=waterInfo(s.water);
    var t=new Date(l.time);
    var ts=t.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    return '<tr>'
      + '<td class="td-num">' + (i+1) + '</td>'
      + '<td class="td-time">' + ts + '<span class="td-ago">' + ago(l.time) + '</span></td>'
      + '<td class="td-dev">'  + l.device + '</td>'
      + '<td><span class="' + colorCls(wi.color) + '">' + wLabel(s.water) + '</span></td>'
      + '<td>' + cvCell(s.soil,  soilInfo,  s.soil!==null?s.soil+'%':'')         + '</td>'
      + '<td>' + cvCell(s.light, lightInfo, s.light!==null?s.light+'%':'')       + '</td>'
      + '<td>' + cvCell(s.temp,  tempInfo,  s.temp!==null?s.temp.toFixed(1)+'\xb0':'') + '</td>'
      + '<td>' + cvCell(s.hum,   humInfo,   s.hum!==null?s.hum.toFixed(1)+'%':'')     + '</td>'
      + '</tr>';
  }).join('');
}

// ── Control cards ────────────────────────────────────────────────
function setCtrlState(device, on) {
  var card = document.getElementById('ctrl-' + device);
  var stEl = document.getElementById('cst-' + device);
  if (!card || !stEl) return;
  card.style.setProperty('--c', on ? G : M);
  stEl.textContent = on ? 'ON' : 'OFF';
  var onBtn  = card.querySelector('.cbon');
  var offBtn = card.querySelector('.cboff');
  if (onBtn) {
    onBtn.style.background  = on ? G : 'rgba(61,255,160,.07)';
    onBtn.style.color       = on ? '#060b11' : G;
    onBtn.style.borderColor = on ? G : 'rgba(61,255,160,.3)';
    onBtn.style.fontWeight  = on ? '700' : '600';
  }
  if (offBtn) {
    offBtn.style.background  = !on ? R : 'rgba(255,77,109,.07)';
    offBtn.style.color       = !on ? '#fff' : R;
    offBtn.style.borderColor = !on ? R : 'rgba(255,77,109,.3)';
    offBtn.style.fontWeight  = !on ? '700' : '600';
  }
}

async function control(device, val) {
  var on = val === 1;
  setCtrlState(device, on);  // optimistic UI update
  try {
    var f = new URLSearchParams();
    f.append('device', device);
    f.append('value', String(val));
    var resp = await fetch('/api/control', { method:'POST', body:f }).then(function(r){ return r.json(); });
    if (resp && resp.state) {
      setCtrlState('light', resp.state.light);
      setCtrlState('pump',  resp.state.pump);
    }
  } catch(e) { /* silent */ }
}

// ── Main data load ───────────────────────────────────────────────
var lastCount = -1, lastMsg = '';

async function load() {
  try {
    var logs   = await fetch('/api/logs').then(function(r){ return r.json(); });
    var stResp = await fetch('/api/state').then(function(r){ return r.json(); });

    document.getElementById('s-total').textContent  = logs.length || '0';
    document.getElementById('s-last').textContent   = logs[0] ? ago(logs[0].time) : '—';
    document.getElementById('s-device').textContent = logs[0] ? logs[0].device   : '—';

    var grid = document.getElementById('sensor-grid');
    if (!logs.length) {
      grid.innerHTML = '<div class="no-data"><div class="no-data-icon">&#127807;</div><div>Waiting for Arduino&#8230;</div></div>';
    } else {
      var msg = logs[0].message;
      if (msg !== lastMsg || logs.length !== lastCount) {
        grid.innerHTML = renderCards(parseSensor(msg));
        lastMsg = msg;
      }
    }
    lastCount = logs.length;

    document.getElementById('hist-body').innerHTML = renderHistory(logs);
    setCtrlState('light', stResp.light);
    setCtrlState('pump',  stResp.pump);
  } catch(e) { /* silent */ }
}

async function clearLogs() {
  if (!confirm('Delete all logs?')) return;
  await fetch('/api/logs', { method:'DELETE' });
  lastCount = -1; lastMsg = '';
  load();
}
function forceRefresh() { lastCount = -1; lastMsg = ''; load(); }

window.addEventListener('load', function() {
  positionBar();
  load();
  setInterval(load, 5000);
});
window.addEventListener('resize', positionBar);
</script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end(HTML);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server started on port', PORT);
  console.log('POST /log         <- Arduino (sensor data)');
  console.log('POST /api/control <- Dashboard (light/pump commands)');
  console.log('GET  /api/state   <- Current actuator state');
  console.log('GET  /api/logs    <- Log history');
  console.log('GET  /            <- Dashboard UI');
});
