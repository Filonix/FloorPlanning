/* ============================================================
 * Floor Planner — Editor core (vanilla JS, no deps)
 * Coordinate system: world units = CENTIMETERS.
 * Transform: screen = (world - pan) * zoom + center
 * Layers: rooms -> walls -> openings -> furniture -> text -> grid overlay
 * ============================================================ */
(function () {
'use strict';

const $ = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const uid = () => Math.random().toString(36).slice(2, 10);
const now = () => Date.now();

/* ---------- State ---------- */
const S = {
  canvas: null, ctx: null,
  dpr: 1,
  W: 0, H: 0,             // css pixels
  zoom: 1,                // zoom factor
  pxPerMeter: 50,         // base: 1m = 50px at zoom 1
  pan: { x: 0, y: 0 },    // world cm at screen center
  gridCm: 20,
  snap: true,
  showGrid: true,
  wallThickness: 15,      // cm
  ceilingHeight: 270,

  tool: 'select',
  prevTool: 'select',
  spacePan: false,

  // data
  walls: [],
  openings: [],
  rooms: [],
  furniture: [],
  texts: [],
  measures: [],
  symbols: [],          // electrical outlets, switches, lights, notes
  layers: { grid: true, rooms: true, walls: true, openings: true, furniture: true, text: true, symbols: true },

  // interaction
  mouse: { x: 0, y: 0, wx: 0, wy: 0, down: false, button: 0 },
  dragStart: null,
  drafting: null,         // {type, points:[], ...}
  selection: null,        // {type, id}
  hover: null,
  marquee: null,
  furniturePreview: null, // {item, x, y}
  viewMode: '2d',         // '2d' | '3d'

  // history
  history: [],
  histIdx: -1,
  planId: null,
  planName: 'Без названия',
  dirty: false,
};

/* ---------- Persistence shape ---------- */
function snapshot() {
  return JSON.parse(JSON.stringify({
    walls: S.walls, openings: S.openings, rooms: S.rooms,
    furniture: S.furniture, texts: S.texts, measures: S.measures,
    symbols: S.symbols,
    layers: S.layers, pxPerMeter: S.pxPerMeter, gridCm: S.gridCm,
    wallThickness: S.wallThickness, ceilingHeight: S.ceilingHeight,
  }));
}
function restore(snap) {
  const s = JSON.parse(JSON.stringify(snap));
  S.walls = s.walls || []; S.openings = s.openings || []; S.rooms = s.rooms || [];
  S.furniture = s.furniture || []; S.texts = s.texts || []; S.measures = s.measures || [];
  S.symbols = s.symbols || [];
  S.layers = s.layers || S.layers; S.pxPerMeter = s.pxPerMeter || 50;
  S.gridCm = s.gridCm || 20; S.wallThickness = s.wallThickness || 15;
  S.ceilingHeight = s.ceilingHeight || 270;
  syncInputs();
}

function pushHistory() {
  // truncate redo
  S.history = S.history.slice(0, S.histIdx + 1);
  S.history.push(snapshot());
  if (S.history.length > 80) S.history.shift();
  S.histIdx = S.history.length - 1;
  updateUndoRedo();
  markDirty();
}
function undo() {
  if (S.histIdx <= 0) return;
  S.histIdx--; restore(S.history[S.histIdx]); updateUndoRedo(); render(); refreshPanel(); markDirty();
}
function redo() {
  if (S.histIdx >= S.history.length - 1) return;
  S.histIdx++; restore(S.history[S.histIdx]); updateUndoRedo(); render(); refreshPanel(); markDirty();
}
function updateUndoRedo() {
  $('#btnUndo').disabled = S.histIdx <= 0;
  $('#btnRedo').disabled = S.histIdx >= S.history.length - 1;
}
function markDirty() { S.dirty = true; $('#saveStatus').textContent = 'не сохранено'; $('#saveStatus').classList.remove('saved'); }

/* ---------- Coordinate transforms ---------- */
function pxPerCm() { return (S.pxPerMeter / 100) * S.zoom; }
function cmPerPx() { return 1 / pxPerCm(); }
function w2s(wx, wy) {
  const sc = pxPerCm();
  return [S.W / 2 + (wx - S.pan.x) * sc, S.H / 2 + (wy - S.pan.y) * sc];
}
function s2w(sx, sy) {
  const sc = pxPerCm();
  return [(sx - S.W / 2) / sc + S.pan.x, (sy - S.H / 2) / sc + S.pan.y];
}

/* ---------- Snapping ---------- */
function snapPoint(wx, wy, ignoreId) {
  if (!S.snap) return [wx, wy];
  // grid snap
  const g = S.gridCm;
  let gx = Math.round(wx / g) * g;
  let gy = Math.round(wy / g) * g;
  let best = { d: dist(wx, wy, gx, gy), x: gx, y: gy };
  // wall endpoints
  for (const w of S.walls) {
    if (w.id === ignoreId) continue;
    for (const p of [w.a, w.b]) {
      const d = dist(wx, wy, p.x, p.y);
      if (d < best.d) best = { d, x: p.x, y: p.y };
    }
  }
  // midpoints
  for (const w of S.walls) {
    if (w.id === ignoreId) continue;
    const m = { x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 };
    const d = dist(wx, wy, m.x, m.y);
    if (d < best.d) best = { d, x: m.x, y: m.y };
  }
  const threshold = 8 * cmPerPx(); // 8px
  return best.d <= threshold ? [best.x, best.y] : [wx, wy];
}
function snapToWall(wx, wy, ignoreId) {
  if (!S.snap) return null;
  const threshold = 10 * cmPerPx();
  let best = null;
  for (const w of S.walls) {
    if (w.id === ignoreId) continue;
    const t = pointOnSegmentT(wx, wy, w.a.x, w.a.y, w.b.x, w.b.y);
    if (t < 0 || t > 1) continue;
    const px = w.a.x + (w.b.x - w.a.x) * t;
    const py = w.a.y + (w.b.y - w.a.y) * t;
    const d = dist(wx, wy, px, py);
    if (d < threshold && (!best || d < best.d)) best = { wall: w, t, x: px, y: py, d };
  }
  return best;
}
function pointOnSegmentT(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return 0;
  return clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
}

/* ---------- Geometry helpers ---------- */
function wallLength(w) { return dist(w.a.x, w.a.y, w.b.x, w.b.y); }
function angleDeg(w) { return Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180 / Math.PI; }
function rotatePt(p, deg, cx = 0, cy = 0) {
  const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const x = p.x - cx, y = p.y - cy;
  return { x: cx + x * c - y * s, y: cy + x * s + y * c };
}
function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ---------- Init ---------- */
function init() {
  S.canvas = $('#editor');
  S.ctx = S.canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);

  // center origin initially
  S.pan = { x: 0, y: 0 };

  bindTools();
  bindCanvas();
  bindTopbar();
  bindPanels();
  bindKeyboard();
  bindModals();
  buildFurniturePanel();

  // empty history
  pushHistory();
  render();
  refreshPanel();
  toast('Готово к работе. Инструмент: Выбрать', 'success');
}

function resize() {
  const rect = S.canvas.parentElement.getBoundingClientRect();
  S.dpr = window.devicePixelRatio || 1;
  S.W = rect.width; S.H = rect.height;
  S.canvas.width = Math.floor(rect.width * S.dpr);
  S.canvas.height = Math.floor(rect.height * S.dpr);
  S.canvas.style.width = rect.width + 'px';
  S.canvas.style.height = rect.height + 'px';
  S.ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  render();
}

/* ============================================================
 * RENDERING
 * ============================================================ */
function render() {
  const c = S.ctx;
  c.clearRect(0, 0, S.W, S.H);
  // paper bg
  c.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim() || '#f4f1ea';
  c.fillRect(0, 0, S.W, S.H);

  if (S.viewMode === '3d') { draw3D(); drawDrafting(); drawSelectionOverlay(); updateHud(); updateStats(); return; }

  if (S.showGrid && S.layers.grid) drawGrid();
  if (S.layers.rooms) drawRooms();
  if (S.layers.walls) drawWalls();
  if (S.layers.openings) drawOpenings();
  if (S.layers.furniture) drawFurniture();
  if (S.layers.symbols) drawSymbols();
  if (S.layers.text) { drawMeasures(); drawTexts(); }

  drawDrafting();
  drawSelectionOverlay();
  drawHover();
  updateHud();
  updateStats();
}

/* ---------- Symbol drawing (outlets, switches, lights, notes) ---------- */
function drawSymbols() {
  const c = S.ctx;
  const sc = pxPerCm();
  for (const s of S.symbols) {
    const [sx, sy] = w2s(s.x, s.y);
    c.save();
    c.translate(sx, sy);
    c.rotate((s.rot || 0) * Math.PI / 180);
    if (s.kind === 'outlet') {
      // outlet: circle with two dots
      c.strokeStyle = '#7c3aed'; c.fillStyle = '#fff'; c.lineWidth = 1.4;
      c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill(); c.stroke();
      c.fillStyle = '#7c3aed';
      c.beginPath(); c.arc(-3.5, -1, 1.6, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(3.5, -1, 1.6, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#7c3aed'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-3, 3.5); c.lineTo(3, 3.5); c.stroke();
    } else if (s.kind === 'light') {
      // ceiling light: circle with X
      c.strokeStyle = '#ca8a04'; c.fillStyle = '#fef9c3'; c.lineWidth = 1.4;
      c.beginPath(); c.arc(0, 0, 11, 0, Math.PI * 2); c.fill(); c.stroke();
      c.strokeStyle = '#ca8a04'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(-6, -6); c.lineTo(6, 6); c.moveTo(6, -6); c.lineTo(-6, 6); c.stroke();
    } else if (s.kind === 'note') {
      // note: small sticky
      c.fillStyle = '#fef08a'; c.strokeStyle = '#ca8a04'; c.lineWidth = 1;
      c.beginPath(); c.rect(-14, -10, 28, 20); c.fill(); c.stroke();
      c.fillStyle = '#713f12'; c.font = '600 9px Inter'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText((s.text || 'Заметка').slice(0, 12), 0, 0);
    }
    c.restore();
  }
}

/* ---------- 3D pseudo-isometric view ---------- */
function draw3D() {
  const c = S.ctx;
  c.clearRect(0, 0, S.W, S.H);
  c.fillStyle = '#e8e4d8'; c.fillRect(0, 0, S.W, S.H);
  // gradient sky
  const grad = c.createLinearGradient(0, 0, 0, S.H * 0.5);
  grad.addColorStop(0, '#cfe0ee'); grad.addColorStop(1, '#e8e4d8');
  c.fillStyle = grad; c.fillRect(0, 0, S.W, S.H * 0.5);

  const sc = pxPerCm() * 0.6;
  const wallH = (S.ceilingHeight || 270) * sc;
  // isometric projection: x' = (x - y) * cos30, y' = (x + y) * sin30 - z
  const cos30 = Math.cos(Math.PI / 6), sin30 = Math.sin(Math.PI / 6);
  const proj = (x, y, z) => {
    const px = S.W / 2 + ((x - S.pan.x) - (y - S.pan.y)) * sc * cos30;
    const py = S.H / 2 + ((x - S.pan.x) + (y - S.pan.y)) * sc * sin30 - (z || 0) * sc;
    return [px, py];
  };

  // draw rooms (floor)
  if (S.layers.rooms) {
    for (const r of S.rooms) {
      if (r.points.length < 3) continue;
      c.beginPath();
      const [fx, fy] = proj(r.points[0].x, r.points[0].y, 0);
      c.moveTo(fx, fy);
      for (let i = 1; i < r.points.length; i++) { const [px, py] = proj(r.points[i].x, r.points[i].y, 0); c.lineTo(px, py); }
      c.closePath();
      c.fillStyle = r.color || 'rgba(245,158,11,0.25)'; c.fill();
      c.strokeStyle = 'rgba(120,110,90,.4)'; c.lineWidth = 1; c.stroke();
    }
  }
  // draw walls as 3D extruded boxes (front faces only, simple)
  if (S.layers.walls) {
    // sort walls by depth (further first): approx by (x+y)
    const sorted = [...S.walls].sort((a, b) => ((a.a.x + a.a.y) + (a.b.x + b.b.y)) - ((b.a.x + b.a.y) + (b.b.x + b.b.y)));
    for (const w of sorted) {
      const t = (w.thickness || S.wallThickness) * sc * 0.5;
      const [ax, ay] = proj(w.a.x, w.a.y, 0);
      const [bx, by] = proj(w.b.x, w.b.y, 0);
      const [axt, ayt] = proj(w.a.x, w.a.y, S.ceilingHeight);
      const [bxt, byt] = proj(w.b.x, w.b.y, S.ceilingHeight);
      // wall face (front)
      c.fillStyle = '#d6cdb8';
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(bxt, byt); c.lineTo(axt, ayt); c.closePath(); c.fill();
      c.strokeStyle = '#9a8f73'; c.lineWidth = 1; c.stroke();
      // top edge
      c.strokeStyle = '#7a6f55'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(axt, ayt); c.lineTo(bxt, byt); c.stroke();
      // bottom
      c.strokeStyle = '#9a8f73'; c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    }
  }
  // furniture as simple extruded boxes
  if (S.layers.furniture) {
    for (const f of S.furniture) {
      const item = window.FURNITURE.items.find(i => i.id === f.itemId); if (!item) continue;
      const [cx, cy] = proj(f.x, f.y, 0);
      const bw = f.w * sc * 0.5, bh = f.h * sc * 0.5;
      const fh = (item.h3d || 45) * sc;
      c.save(); c.translate(cx, cy); c.rotate((f.rot || 0) * Math.PI / 180);
      // box
      c.fillStyle = (f.color || '#9a8f73') + 'cc';
      c.fillRect(-bw, -bh - fh, bw * 2, fh);
      c.fillStyle = (f.color || '#9a8f73');
      c.fillRect(-bw, -bh, bw * 2, bh);
      c.strokeStyle = '#5a4a2a'; c.lineWidth = 1; c.strokeRect(-bw, -bh, bw * 2, bh);
      c.strokeRect(-bw, -bh - fh, bw * 2, fh);
      c.beginPath(); c.moveTo(-bw, -bh); c.lineTo(-bw, -bh - fh); c.moveTo(bw, -bh); c.lineTo(bw, -bh - fh); c.stroke();
      c.restore();
    }
  }
  // 3D badge
  c.fillStyle = 'rgba(245,158,11,.95)'; c.font = '700 12px Inter';
  c.textAlign = 'right'; c.textBaseline = 'top';
  c.fillText('3D ИЗОМЕТРИЯ · потолок ' + S.ceilingHeight + ' см', S.W - 16, 16);
}

function drawGrid() {
  const c = S.ctx;
  const sc = pxPerCm();
  const g = S.gridCm;
  const majorEvery = 5;
  // visible world bounds
  const [wx0, wy0] = s2w(0, 0);
  const [wx1, wy1] = s2w(S.W, S.H);
  const startX = Math.floor(wx0 / g) * g;
  const startY = Math.floor(wy0 / g) * g;

  c.lineWidth = 1;
  // minor
  c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--canvas-grid').trim() || '#d8d2c4';
  c.beginPath();
  for (let x = startX; x <= wx1; x += g) {
    const [sx] = w2s(x, 0); c.moveTo(sx + .5, 0); c.lineTo(sx + .5, S.H);
  }
  for (let y = startY; y <= wy1; y += g) {
    const [, sy] = w2s(0, y); c.moveTo(0, sy + .5); c.lineTo(S.W, sy + .5);
  }
  c.stroke();

  // major
  c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--canvas-grid-major').trim() || '#b9b29f';
  c.lineWidth = 1.2;
  c.beginPath();
  const mg = g * majorEvery;
  const mstartX = Math.floor(wx0 / mg) * mg;
  const mstartY = Math.floor(wy0 / mg) * mg;
  for (let x = mstartX; x <= wx1; x += mg) {
    const [sx] = w2s(x, 0); c.moveTo(sx + .5, 0); c.lineTo(sx + .5, S.H);
  }
  for (let y = mstartY; y <= wy1; y += mg) {
    const [, sy] = w2s(0, y); c.moveTo(0, sy + .5); c.lineTo(S.W, sy + .5);
  }
  c.stroke();

  // origin axes
  c.strokeStyle = 'rgba(245,158,11,.5)';
  c.lineWidth = 1.5;
  c.beginPath();
  const [ox, oy] = w2s(0, 0);
  c.moveTo(ox, 0); c.lineTo(ox, S.H);
  c.moveTo(0, oy); c.lineTo(S.W, oy);
  c.stroke();
}

function drawRooms() {
  const c = S.ctx;
  for (const r of S.rooms) {
    if (!r.points || r.points.length < 3) continue;
    c.beginPath();
    const [sx0, sy0] = w2s(r.points[0].x, r.points[0].y);
    c.moveTo(sx0, sy0);
    for (let i = 1; i < r.points.length; i++) {
      const [sx, sy] = w2s(r.points[i].x, r.points[i].y);
      c.lineTo(sx, sy);
    }
    c.closePath();
    c.fillStyle = r.color || 'rgba(245,158,11,0.08)';
    c.fill();
    c.strokeStyle = 'rgba(120,110,90,.35)';
    c.setLineDash([4, 4]); c.lineWidth = 1;
    c.stroke(); c.setLineDash([]);
    // area label
    const area = polygonArea(r.points) / 10000; // cm2 -> m2
    const cx = r.points.reduce((s, p) => s + p.x, 0) / r.points.length;
    const cy = r.points.reduce((s, p) => s + p.y, 0) / r.points.length;
    const [lsx, lsy] = w2s(cx, cy);
    c.fillStyle = '#6b5d3f';
    c.font = '600 13px Inter';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(r.name ? `${r.name}` : '', lsx, lsy - 8);
    c.font = '500 12px Inter';
    c.fillText(`${area.toFixed(1)} м²`, lsx, lsy + 8);
  }
}
function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  }
  return Math.abs(a / 2);
}

function drawWalls() {
  const c = S.ctx;
  const sc = pxPerCm();
  for (const w of S.walls) {
    const [ax, ay] = w2s(w.a.x, w.a.y);
    const [bx, by] = w2s(w.b.x, w.b.y);
    const t = (w.thickness || S.wallThickness) * sc;
    c.strokeStyle = w.color || '#3b3a38';
    c.lineWidth = Math.max(2, t);
    c.lineCap = 'round';
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    // inner highlight
    c.strokeStyle = 'rgba(255,255,255,.12)';
    c.lineWidth = Math.max(1, t * 0.25);
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    // dimension while drawing/selecting
    if (S.drafting && S.drafting.type === 'wall' && w === S.walls[S.walls.length - 1] && S.drafting.active) {
      drawDimLine(ax, ay, bx, by, (wallLength(w) / 100).toFixed(2) + ' м');
    }
  }
  c.lineCap = 'butt';
}

function drawOpenings() {
  const c = S.ctx;
  const sc = pxPerCm();
  for (const o of S.openings) {
    const w = S.walls.find(x => x.id === o.wallId);
    if (!w) continue;
    const len = wallLength(w);
    if (len < 1) continue;
    const t = clamp(o.t, 0, 1);
    const wsize = o.width || 80;
    const halfT = (w.thickness || S.wallThickness) / 2;
    const ang = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
    // center point
    const cx = w.a.x + (w.b.x - w.a.x) * t;
    const cy = w.a.y + (w.b.y - w.a.y) * t;
    const perp = ang + Math.PI / 2;
    const halfW = wsize / 2;
    // opening box corners (in world)
    const p1 = { x: cx + Math.cos(ang) * halfW, y: cy + Math.sin(ang) * halfW };
    const p2 = { x: cx - Math.cos(ang) * halfW, y: cy - Math.sin(ang) * halfW };
    const pa = { x: p1.x + Math.cos(perp) * halfT, y: p1.y + Math.sin(perp) * halfT };
    const pb = { x: p1.x - Math.cos(perp) * halfT, y: p1.y - Math.sin(perp) * halfT };
    const pc = { x: p2.x - Math.cos(perp) * halfT, y: p2.y - Math.sin(perp) * halfT };
    const pd = { x: p2.x + Math.cos(perp) * halfT, y: p2.y + Math.sin(perp) * halfT };

    // erase wall under opening (paper color)
    const [sax, say] = w2s(pa.x, pa.y);
    const [sbx, sby] = w2s(pb.x, pb.y);
    const [scx, scy] = w2s(pc.x, pc.y);
    const [sdx, sdy] = w2s(pd.x, pd.y);
    c.beginPath();
    c.moveTo(sax, say); c.lineTo(sbx, sby); c.lineTo(scx, scy); c.lineTo(sdx, sdy);
    c.closePath();
    c.fillStyle = getComputedStyle(document.body).getPropertyValue('--canvas-bg').trim() || '#f4f1ea';
    c.fill();

    if (o.kind === 'door') {
      // door: leaf + swing arc
      const hinge = o.flip ? p2 : p1;
      const [hx, hy] = w2s(hinge.x, hinge.y);
      const leafEnd = o.flip
        ? { x: p2.x - Math.cos(perp) * wsize, y: p2.y - Math.sin(perp) * wsize }
        : { x: p1.x + Math.cos(perp) * wsize, y: p1.y + Math.sin(perp) * wsize };
      const [lex, ley] = w2s(leafEnd.x, leafEnd.y);
      c.strokeStyle = '#5a4a2a'; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(hx, hy); c.lineTo(lex, ley); c.stroke();
      // swing arc
      c.beginPath();
      const startA = o.flip ? ang + Math.PI : ang;
      c.arc(hx, hy, wsize * sc, startA, startA + (o.flip ? -Math.PI / 2 : Math.PI / 2), o.flip);
      c.strokeStyle = 'rgba(90,74,42,.5)'; c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
      // frame marks
      c.strokeStyle = '#3b3a38'; c.lineWidth = 2;
      const [p1s] = w2s(p1.x, p1.y); const [p2s] = w2s(p2.x, p2.y);
      // small tick across wall thickness at frame
    } else if (o.kind === 'window') {
      // window: two parallel lines + glass hatch
      c.strokeStyle = '#2d6a9f'; c.lineWidth = 1.6;
      const [l1ax, l1ay] = w2s(p1.x + Math.cos(perp) * halfT * 0.4, p1.y + Math.sin(perp) * halfT * 0.4);
      const [l1bx, l1by] = w2s(p2.x + Math.cos(perp) * halfT * 0.4, p2.y + Math.sin(perp) * halfT * 0.4);
      const [l2ax, l2ay] = w2s(p1.x - Math.cos(perp) * halfT * 0.4, p1.y - Math.sin(perp) * halfT * 0.4);
      const [l2bx, l2by] = w2s(p2.x - Math.cos(perp) * halfT * 0.4, p2.y - Math.sin(perp) * halfT * 0.4);
      c.beginPath(); c.moveTo(l1ax, l1ay); c.lineTo(l1bx, l1by); c.stroke();
      c.beginPath(); c.moveTo(l2ax, l2ay); c.lineTo(l2bx, l2by); c.stroke();
      // center line
      const [cax, cay] = w2s((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
      c.strokeStyle = '#3b3a38'; c.lineWidth = 1;
    }
    // frame end caps
    c.strokeStyle = '#3b3a38'; c.lineWidth = 2;
    const cap1a = w2s(p1.x + Math.cos(perp) * halfT, p1.y + Math.sin(perp) * halfT);
    const cap1b = w2s(p1.x - Math.cos(perp) * halfT, p1.y - Math.sin(perp) * halfT);
    const cap2a = w2s(p2.x + Math.cos(perp) * halfT, p2.y + Math.sin(perp) * halfT);
    const cap2b = w2s(p2.x - Math.cos(perp) * halfT, p2.y - Math.sin(perp) * halfT);
    c.beginPath(); c.moveTo(...cap1a); c.lineTo(...cap1b); c.moveTo(...cap2a); c.lineTo(...cap2b); c.stroke();
  }
}

function drawFurniture() {
  const c = S.ctx;
  const sc = pxPerCm();
  for (const f of S.furniture) {
    const item = window.FURNITURE.items.find(i => i.id === f.itemId);
    if (!item) continue;
    const [sx, sy] = w2s(f.x, f.y);
    const wpw = f.w * sc, wph = f.h * sc;
    c.save();
    c.translate(sx, sy);
    c.rotate((f.rot || 0) * Math.PI / 180);
    c.strokeStyle = f.color || '#4a463f';
    c.fillStyle = (f.color || '#4a463f') + '22';
    c.lineWidth = 1.4;
    // optional fill rect (light)
    c.fillRect(-wpw / 2, -wph / 2, wpw, wph);
    c.strokeRect(-wpw / 2, -wph / 2, wpw, wph);
    item.draw(c, wpw, wph);
    // label
    if (f.label) {
      c.fillStyle = '#6b5d3f'; c.font = '500 10px Inter';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.save(); c.rotate(-(f.rot || 0) * Math.PI / 180);
      c.fillText(f.label, 0, 0);
      c.restore();
    }
    c.restore();
  }
}

function drawTexts() {
  const c = S.ctx;
  const sc = pxPerCm();
  for (const t of S.texts) {
    const [sx, sy] = w2s(t.x, t.y);
    c.fillStyle = t.color || '#3b3a38';
    c.font = `600 ${t.size || 16}px Inter`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(t.text, sx, sy);
  }
}

function drawMeasures() {
  const c = S.ctx;
  for (const m of S.measures) {
    const [ax, ay] = w2s(m.a.x, m.a.y);
    const [bx, by] = w2s(m.b.x, m.b.y);
    drawDimLine(ax, ay, bx, by, (dist(m.a.x, m.a.y, m.b.x, m.b.y) / 100).toFixed(2) + ' м');
  }
}

function drawDimLine(ax, ay, bx, by, label) {
  const c = S.ctx;
  const ang = Math.atan2(by - ay, bx - ax);
  const off = 18;
  const ox = Math.cos(ang - Math.PI / 2) * off;
  const oy = Math.sin(ang - Math.PI / 2) * off;
  c.strokeStyle = '#c2410c'; c.lineWidth = 1;
  c.beginPath();
  c.moveTo(ax + ox, ay + oy); c.lineTo(bx + ox, by + oy);
  // tick marks
  c.moveTo(ax + ox, ay + oy); c.lineTo(ax + ox - Math.cos(ang) * 4 + Math.sin(ang) * 4, ay + oy - Math.sin(ang) * 4 - Math.cos(ang) * 4);
  c.moveTo(ax + ox, ay + oy); c.lineTo(ax + ox - Math.cos(ang) * 4 - Math.sin(ang) * 4, ay + oy - Math.sin(ang) * 4 + Math.cos(ang) * 4);
  c.moveTo(bx + ox, by + oy); c.lineTo(bx + ox + Math.cos(ang) * 4 + Math.sin(ang) * 4, by + oy + Math.sin(ang) * 4 - Math.cos(ang) * 4);
  c.moveTo(bx + ox, by + oy); c.lineTo(bx + ox + Math.cos(ang) * 4 - Math.sin(ang) * 4, by + oy + Math.sin(ang) * 4 + Math.cos(ang) * 4);
  // ext lines
  c.moveTo(ax, ay); c.lineTo(ax + ox, ay + oy);
  c.moveTo(bx, by); c.lineTo(bx + ox, by + oy);
  c.stroke();
  // label bg
  const mx = (ax + bx) / 2 + ox, my = (ay + by) / 2 + oy;
  c.fillStyle = '#fff7ed';
  const w = c.measureText(label).width + 8;
  c.fillRect(mx - w / 2, my - 9, w, 18);
  c.strokeStyle = '#fdba74'; c.strokeRect(mx - w / 2, my - 9, w, 18);
  c.fillStyle = '#9a3412'; c.font = '600 11px Inter';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(label, mx, my);
}

function drawDrafting() {
  const c = S.ctx;
  if (!S.drafting) return;
  const d = S.drafting;
  if (d.type === 'wall') {
    if (d.points.length < 1) return;
    const [ax, ay] = w2s(d.points[0].x, d.points[0].y);
    const [bx, by] = w2s(S.mouse.wx, S.mouse.wy);
    c.strokeStyle = '#f59e0b'; c.lineWidth = Math.max(2, S.wallThickness * pxPerCm());
    c.setLineDash([6, 4]); c.lineCap = 'round';
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    c.setLineDash([]);
    // length label
    const L = dist(d.points[0].x, d.points[0].y, S.mouse.wx, S.mouse.wy);
    drawDimLine(ax, ay, bx, by, (L / 100).toFixed(2) + ' м');
  } else if (d.type === 'room') {
    if (d.points.length < 1) return;
    c.strokeStyle = '#f59e0b'; c.fillStyle = 'rgba(245,158,11,.1)';
    c.lineWidth = 1.5; c.setLineDash([5, 4]);
    c.beginPath();
    const [s0x, s0y] = w2s(d.points[0].x, d.points[0].y);
    c.moveTo(s0x, s0y);
    for (let i = 1; i < d.points.length; i++) {
      const [sx, sy] = w2s(d.points[i].x, d.points[i].y); c.lineTo(sx, sy);
    }
    c.lineTo(S.mouse.sx, S.mouse.sy);
    c.closePath(); c.fill(); c.stroke(); c.setLineDash([]);
  } else if (d.type === 'measure') {
    if (d.points.length < 1) return;
    const [ax, ay] = w2s(d.points[0].x, d.points[0].y);
    const [bx, by] = w2s(S.mouse.wx, S.mouse.wy);
    drawDimLine(ax, ay, bx, by, (dist(d.points[0].x, d.points[0].y, S.mouse.wx, S.mouse.wy) / 100).toFixed(2) + ' м');
  }
}

function drawSelectionOverlay() {
  const c = S.ctx;
  if (!S.selection) return;
  const sel = S.selection;
  c.strokeStyle = '#f59e0b'; c.lineWidth = 1.5; c.setLineDash([4, 3]);
  if (sel.type === 'wall') {
    const w = S.walls.find(x => x.id === sel.id); if (!w) { c.setLineDash([]); return; }
    const [ax, ay] = w2s(w.a.x, w.a.y); const [bx, by] = w2s(w.b.x, w.b.y);
    const t = (w.thickness || S.wallThickness) * pxPerCm() / 2 + 4;
    const ang = Math.atan2(by - ay, bx - ax);
    c.save(); c.translate((ax + bx) / 2, (ay + by) / 2); c.rotate(ang);
    const len = dist(ax, ay, bx, by);
    c.strokeRect(-len / 2, -t, len, t * 2);
    c.restore();
    // endpoints
    c.setLineDash([]);
    drawHandle(ax, ay); drawHandle(bx, by);
  } else if (sel.type === 'furniture') {
    const f = S.furniture.find(x => x.id === sel.id); if (!f) { c.setLineDash([]); return; }
    const [sx, sy] = w2s(f.x, f.y);
    const sc = pxPerCm();
    c.save(); c.translate(sx, sy); c.rotate((f.rot || 0) * Math.PI / 180);
    c.strokeRect(-f.w * sc / 2 - 4, -f.h * sc / 2 - 4, f.w * sc + 8, f.h * sc + 8);
    c.restore();
    // rotate handle
    const rh = rotatePt({ x: 0, y: -f.h * sc / 2 - 22 }, f.rot || 0, 0, 0);
    c.setLineDash([]);
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + rh.x, sy + rh.y); c.stroke();
    drawHandle(sx + rh.x, sy + rh.y, '#f59e0b');
  } else if (sel.type === 'opening') {
    const o = S.openings.find(x => x.id === sel.id); if (!o) { c.setLineDash([]); return; }
    const w = S.walls.find(x => x.id === o.wallId); if (!w) { c.setLineDash([]); return; }
    const cx = w.a.x + (w.b.x - w.a.x) * o.t, cy = w.a.y + (w.b.y - w.a.y) * o.t;
    const [sx, sy] = w2s(cx, cy);
    c.beginPath(); c.arc(sx, sy, 10, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
  } else if (sel.type === 'text') {
    const t = S.texts.find(x => x.id === sel.id); if (!t) { c.setLineDash([]); return; }
    const [sx, sy] = w2s(t.x, t.y);
    c.font = `600 ${t.size || 16}px Inter`;
    const w = c.measureText(t.text).width;
    c.strokeRect(sx - w / 2 - 4, sy - (t.size || 16) / 2 - 4, w + 8, (t.size || 16) + 8);
    c.setLineDash([]);
    drawHandle(sx, sy);
  } else if (sel.type === 'room') {
    const r = S.rooms.find(x => x.id === sel.id); if (!r) { c.setLineDash([]); return; }
    c.beginPath();
    const [s0x, s0y] = w2s(r.points[0].x, r.points[0].y);
    c.moveTo(s0x, s0y);
    for (let i = 1; i < r.points.length; i++) {
      const [sx, sy] = w2s(r.points[i].x, r.points[i].y); c.lineTo(sx, sy);
    }
    c.closePath(); c.stroke(); c.setLineDash([]);
    r.points.forEach(p => drawHandle(...w2s(p.x, p.y)));
  }
  c.setLineDash([]);
}

function drawHandle(sx, sy, color) {
  const c = S.ctx;
  c.fillStyle = color || '#fff';
  c.strokeStyle = '#f59e0b'; c.lineWidth = 1.5;
  c.beginPath(); c.rect(sx - 4, sy - 4, 8, 8); c.fill(); c.stroke();
}

function drawHover() {
  if (!S.hover || S.selection && S.selection.id === S.hover.id) return;
  const c = S.ctx;
  c.strokeStyle = 'rgba(245,158,11,.5)'; c.lineWidth = 2; c.setLineDash([3, 3]);
  const h = S.hover;
  if (h.type === 'wall') {
    const w = S.walls.find(x => x.id === h.id);
    if (w) { const [ax, ay] = w2s(w.a.x, w.a.y); const [bx, by] = w2s(w.b.x, w.b.y); c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke(); }
  } else if (h.type === 'furniture') {
    const f = S.furniture.find(x => x.id === h.id);
    if (f) {
      const [sx, sy] = w2s(f.x, f.y); const sc = pxPerCm();
      c.save(); c.translate(sx, sy); c.rotate((f.rot || 0) * Math.PI / 180);
      c.strokeRect(-f.w * sc / 2 - 3, -f.h * sc / 2 - 3, f.w * sc + 6, f.h * sc + 6);
      c.restore();
    }
  }
  c.setLineDash([]);
}

/* ============================================================
 * HIT TESTING
 * ============================================================ */
function hitTest(sx, sy) {
  const [wx, wy] = s2w(sx, sy);
  const sc = pxPerCm();
  // symbols (electrical/notes)
  if (S.layers.symbols) {
    for (let i = S.symbols.length - 1; i >= 0; i--) {
      const s = S.symbols[i];
      const [ssx, ssy] = w2s(s.x, s.y);
      if (dist(sx, sy, ssx, ssy) < 14) return { type: 'symbol', id: s.id };
    }
  }
  // text
  if (S.layers.text) {
    for (let i = S.texts.length - 1; i >= 0; i--) {
      const t = S.texts[i];
      S.ctx.font = `600 ${t.size || 16}px Inter`;
      const w = S.ctx.measureText(t.text).width;
      const [tsx, tsy] = w2s(t.x, t.y);
      if (sx >= tsx - w / 2 - 4 && sx <= tsx + w / 2 + 4 && sy >= tsy - (t.size || 16) / 2 - 4 && sy <= tsy + (t.size || 16) / 2 + 4)
        return { type: 'text', id: t.id };
    }
  }
  // furniture
  if (S.layers.furniture) {
    for (let i = S.furniture.length - 1; i >= 0; i--) {
      const f = S.furniture[i];
      // rotate point into furniture local
      const [fsx, fsy] = w2s(f.x, f.y);
      const dx = sx - fsx, dy = sy - fsy;
      const a = -(f.rot || 0) * Math.PI / 180;
      const lx = dx * Math.cos(a) - dy * Math.sin(a);
      const ly = dx * Math.sin(a) + dy * Math.cos(a);
      const hw = f.w * sc / 2, hh = f.h * sc / 2;
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return { type: 'furniture', id: f.id };
    }
  }
  // openings
  if (S.layers.openings) {
    for (let i = S.openings.length - 1; i >= 0; i--) {
      const o = S.openings[i];
      const w = S.walls.find(x => x.id === o.wallId); if (!w) continue;
      const cx = w.a.x + (w.b.x - w.a.x) * o.t, cy = w.a.y + (w.b.y - w.a.y) * o.t;
      const [csx, csy] = w2s(cx, cy);
      if (dist(sx, sy, csx, csy) < 12) return { type: 'opening', id: o.id };
    }
  }
  // walls
  if (S.layers.walls) {
    for (let i = S.walls.length - 1; i >= 0; i--) {
      const w = S.walls[i];
      const [ax, ay] = w2s(w.a.x, w.a.y); const [bx, by] = w2s(w.b.x, w.b.y);
      const t = (w.thickness || S.wallThickness) * sc / 2 + 5;
      if (distToSegment(sx, sy, ax, ay, bx, by) <= t) return { type: 'wall', id: w.id };
    }
  }
  // rooms
  if (S.layers.rooms) {
    for (let i = S.rooms.length - 1; i >= 0; i--) {
      const r = S.rooms[i];
      if (pointInPolygon(wx, wy, r.points)) return { type: 'room', id: r.id };
    }
  }
  return null;
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist(px, py, ax, ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return dist(px, py, ax + dx * t, ay + dy * t);
}

/* ============================================================
 * MOUSE / TOUCH HANDLING
 * ============================================================ */
function bindCanvas() {
  const cv = S.canvas;
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', onPointerUp);
  cv.addEventListener('pointerleave', () => { S.hover = null; render(); });
  cv.addEventListener('wheel', onWheel, { passive: false });
  cv.addEventListener('dblclick', onDblClick);
  cv.addEventListener('contextmenu', e => { e.preventDefault(); });
}

function getPointer(e) {
  const rect = S.canvas.getBoundingClientRect();
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}

function onPointerDown(e) {
  S.canvas.setPointerCapture(e.pointerId);
  const { sx, sy } = getPointer(e);
  S.mouse.sx = sx; S.mouse.sy = sy; S.mouse.down = true; S.mouse.button = e.button;
  const [wx, wy] = s2w(sx, sy);
  S.mouse.wx = wx; S.mouse.wy = wy;

  // pan with space or middle button or pan tool
  if (S.spacePan || e.button === 1 || S.tool === 'pan') {
    S.dragStart = { mode: 'pan', sx, sy, panX: S.pan.x, panY: S.pan.y };
    $('.canvas-area').classList.add('panning');
    return;
  }

  // furniture placement from panel — must be checked BEFORE 'select'
  if (S.furniturePreview) {
    const [px, py] = snapPoint(wx, wy);
    const it = S.furniturePreview.item;
    S.furniture.push({ id: uid(), itemId: it.id, x: px, y: py, w: it.w, h: it.h, rot: 0, color: '#4a463f', label: '' });
    S.selection = { type: 'furniture', id: S.furniture[S.furniture.length - 1].id };
    S.furniturePreview = null;
    S.canvas.style.cursor = '';
    pushHistory(); render(); refreshPanel();
    setHint('');
    return;
  }

  if (S.tool === 'select') {
    const hit = hitTest(sx, sy);
    if (hit) {
      S.selection = hit;
      // begin move
      const obj = getObj(hit);
      S.dragStart = { mode: 'move', sx, sy, wx, wy, orig: JSON.parse(JSON.stringify(obj)), hit };
      // furniture rotate handle?
      if (hit.type === 'furniture') {
        const f = S.furniture.find(x => x.id === hit.id);
        const [fsx, fsy] = w2s(f.x, f.y);
        const rh = rotatePt({ x: 0, y: -f.h * pxPerCm() / 2 - 22 }, f.rot || 0, 0, 0);
        if (dist(sx, sy, fsx + rh.x, fsy + rh.y) < 10) {
          S.dragStart = { mode: 'rotate', sx, sy, fsx, fsy, origRot: f.rot || 0 };
        }
      }
    } else {
      S.selection = null;
      S.dragStart = { mode: 'marquee', sx, sy, ex: sx, ey: sy };
    }
    refreshPanel(); render();
    return;
  }

  if (S.tool === 'wall') {
    const [px, py] = snapPoint(wx, wy);
    if (!S.drafting || !S.drafting.active) {
      S.drafting = { type: 'wall', points: [{ x: px, y: py }], active: true };
      setHint('Стена: укажите конечную точку (Enter — завершить, Esc — отмена)');
    } else {
      // finish segment, start next from this point
      const a = S.drafting.points[S.drafting.points.length - 1];
      S.walls.push({ id: uid(), a: { x: a.x, y: a.y }, b: { x: px, y: py }, thickness: S.wallThickness, color: '#3b3a38' });
      S.drafting.points = [{ x: px, y: py }];
      pushHistory(); render();
    }
    return;
  }

  if (S.tool === 'room') {
    const [px, py] = snapPoint(wx, wy);
    if (!S.drafting) {
      S.drafting = { type: 'room', points: [{ x: px, y: py }] };
      setHint('Комната: добавляйте углы, двойной клик — замкнуть');
    } else {
      S.drafting.points.push({ x: px, y: py });
    }
    render();
    return;
  }

  if (S.tool === 'door' || S.tool === 'window') {
    const snap = snapToWall(wx, wy);
    if (!snap) { toast('Укажите точку на стене', 'error'); return; }
    const kind = S.tool === 'door' ? 'door' : 'window';
    const defW = kind === 'door' ? 80 : 100;
    S.openings.push({ id: uid(), wallId: snap.wall.id, t: snap.t, kind, width: defW, flip: false });
    S.selection = { type: 'opening', id: S.openings[S.openings.length - 1].id };
    pushHistory(); render(); refreshPanel();
    return;
  }

  if (S.tool === 'text') {
    S._pendingTextPos = { x: wx, y: wy };
    openTextModal(null);
    return;
  }

  if (S.tool === 'measure') {
    const [px, py] = snapPoint(wx, wy);
    if (!S.drafting) {
      S.drafting = { type: 'measure', points: [{ x: px, y: py }] };
      setHint('Размер: укажите вторую точку');
    } else {
      const a = S.drafting.points[0];
      S.measures.push({ id: uid(), a: { x: a.x, y: a.y }, b: { x: px, y: py } });
      S.drafting = null;
      pushHistory(); render();
    }
    return;
  }

  if (S.tool === 'eraser') {
    const hit = hitTest(sx, sy);
    if (hit) { deleteObj(hit); pushHistory(); render(); refreshPanel(); }
    return;
  }

  // Split wall into two at clicked point
  if (S.tool === 'split') {
    const snap = snapToWall(wx, wy);
    if (!snap) { toast('Укажите точку на стене', 'error'); return; }
    const w = snap.wall;
    const cx = w.a.x + (w.b.x - w.a.x) * snap.t;
    const cy = w.a.y + (w.b.y - w.a.y) * snap.t;
    const newId = uid();
    S.walls.push({ id: newId, a: { x: cx, y: cy }, b: { x: w.b.x, y: w.b.y }, thickness: w.thickness, color: w.color });
    w.b = { x: cx, y: cy };
    toast('Стена разделена', 'success');
    pushHistory(); render();
    return;
  }

  // Electrical / lighting symbols
  if (S.tool === 'outlet' || S.tool === 'light' || S.tool === 'note') {
    const [px, py] = snapPoint(wx, wy);
    const kind = S.tool;
    const sym = { id: uid(), kind, x: px, y: py, rot: 0 };
    if (kind === 'outlet') { sym.subtype = 'outlet'; sym.label = 'Розетка'; }
    else if (kind === 'light') { sym.subtype = 'ceiling'; sym.label = 'Светильник'; }
    else { sym.text = 'Заметка'; }
    S.symbols.push(sym);
    S.selection = { type: 'symbol', id: sym.id };
    pushHistory(); render(); refreshPanel();
    return;
  }

  // furniture placement from panel
  if (S.furniturePreview) {
    const [px, py] = snapPoint(wx, wy);
    const it = S.furniturePreview.item;
    S.furniture.push({ id: uid(), itemId: it.id, x: px, y: py, w: it.w, h: it.h, rot: 0, color: '#4a463f', label: '' });
    S.selection = { type: 'furniture', id: S.furniture[S.furniture.length - 1].id };
    S.furniturePreview = null;
    S.canvas.style.cursor = '';
    pushHistory(); render(); refreshPanel();
    setTool('select');
    return;
  }
}

function onPointerMove(e) {
  const { sx, sy } = getPointer(e);
  S.mouse.sx = sx; S.mouse.sy = sy;
  const [wx, wy] = s2w(sx, sy);
  S.mouse.wx = wx; S.mouse.wy = wy;

  if (S.dragStart) {
    if (S.dragStart.mode === 'pan') {
      const dx = (sx - S.dragStart.sx) * cmPerPx();
      const dy = (sy - S.dragStart.sy) * cmPerPx();
      S.pan.x = S.dragStart.panX - dx;
      S.pan.y = S.dragStart.panY - dy;
      render(); return;
    }
    if (S.dragStart.mode === 'move') {
      const obj = getObj(S.dragStart.hit);
      if (!obj) return;
      const dx = wx - S.dragStart.wx, dy = wy - S.dragStart.wy;
      if (S.dragStart.hit.type === 'wall') {
        obj.a = { x: S.dragStart.orig.a.x + dx, y: S.dragStart.orig.a.y + dy };
        obj.b = { x: S.dragStart.orig.b.x + dx, y: S.dragStart.orig.b.y + dy };
      } else if (S.dragStart.hit.type === 'furniture' || S.dragStart.hit.type === 'text') {
        const [px, py] = snapPoint(wx - S.dragStart.wx + S.dragStart.orig.x, wy - S.dragStart.wy + S.dragStart.orig.y);
        obj.x = px; obj.y = py;
      } else if (S.dragStart.hit.type === 'room') {
        obj.points = S.dragStart.orig.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
      }
      render(); refreshPanel(true); return;
    }
    if (S.dragStart.mode === 'rotate') {
      const f = S.furniture.find(x => x.id === S.dragStart.hit.id);
      if (!f) return;
      const a = Math.atan2(sy - S.dragStart.fsy, sx - S.dragStart.fsx) * 180 / Math.PI + 90;
      f.rot = Math.round((S.dragStart.origRot + a) / 5) * 5;
      render(); refreshPanel(true); return;
    }
    if (S.dragStart.mode === 'marquee') {
      S.dragStart.ex = sx; S.dragStart.ey = sy;
      render(); return;
    }
    if (S.dragStart.mode === 'endpoint') {
      const [px, py] = snapPoint(wx, wy, S.dragStart.wallId);
      const w = S.walls.find(x => x.id === S.dragStart.wallId);
      if (w) { w[S.dragStart.end].x = px; w[S.dragStart.end].y = py; render(); refreshPanel(true); }
      return;
    }
    if (S.dragStart.mode === 'roompoint') {
      const [px, py] = snapPoint(wx, wy);
      const r = S.rooms.find(x => x.id === S.dragStart.roomId);
      if (r) { r.points[S.dragStart.idx].x = px; r.points[S.dragStart.idx].y = py; render(); refreshPanel(true); }
      return;
    }
  }

  // hover
  if (S.tool === 'select') {
    const hit = hitTest(sx, sy);
    if (JSON.stringify(hit) !== JSON.stringify(S.hover)) { S.hover = hit; render(); }
  }
  // snap indicator for drafting
  if (S.drafting || S.tool === 'wall' || S.tool === 'room' || S.tool === 'measure' || S.tool === 'door' || S.tool === 'window') {
    render();
  }
  if (S.furniturePreview) { S.furniturePreview.x = wx; S.furniturePreview.y = wy; render(); }
}

function onPointerUp(e) {
  S.mouse.down = false;
  if (S.dragStart) {
    if (S.dragStart.mode === 'pan') { $('.canvas-area').classList.remove('panning'); }
    if (S.dragStart.mode === 'move' || S.dragStart.mode === 'rotate' || S.dragStart.mode === 'endpoint' || S.dragStart.mode === 'roompoint') {
      pushHistory();
    }
    if (S.dragStart.mode === 'marquee') {
      // select walls inside? simple: ignore, just clear
    }
    S.dragStart = null;
    refreshPanel();
  }
}

function onWheel(e) {
  e.preventDefault();
  const { sx, sy } = getPointer(e);
  const [wxBefore, wyBefore] = s2w(sx, sy);
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  S.zoom = clamp(S.zoom * factor, 0.1, 8);
  // keep cursor world point stable
  const [wxAfter, wyAfter] = s2w(sx, sy);
  S.pan.x += wxBefore - wxAfter;
  S.pan.y += wyBefore - wyAfter;
  updateZoomLabel();
  render();
}

function onDblClick(e) {
  const { sx, sy } = getPointer(e);
  if (S.tool === 'room' && S.drafting && S.drafting.points.length >= 3) {
    S.rooms.push({ id: uid(), points: S.drafting.points.slice(), name: 'Комната', color: 'rgba(245,158,11,0.08)' });
    S.drafting = null;
    pushHistory(); render(); refreshPanel();
    setHint('');
    return;
  }
  if (S.tool === 'wall' && S.drafting) {
    S.drafting = null; render(); setHint(''); return;
  }
  if (S.tool === 'measure' && S.drafting) {
    S.drafting = null; render(); setHint(''); return;
  }
  // double click on wall endpoint to edit length? keep simple.
  if (S.tool === 'select') {
    const hit = hitTest(sx, sy);
    if (hit && hit.type === 'text') {
      const t = S.texts.find(x => x.id === hit.id);
      S._pendingTextPos = { x: t.x, y: t.y, id: t.id };
      openTextModal(t);
    }
  }
}

/* ============================================================
 * TOOLS & TOPBAR
 * ============================================================ */
function setTool(t) {
  S.tool = t;
  S.drafting = null;
  $$('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  const area = $('.canvas-area');
  area.classList.remove('tool-select','tool-wall','tool-door','tool-window','tool-room','tool-text','tool-measure','tool-eraser','tool-pan');
  area.classList.add('tool-' + t);
  const hints = {
    select: 'Выберите элемент на чертеже',
    wall: 'Стена: клик = начало, клик = конец. Enter/двойной клик — завершить',
    door: 'Дверь: кликните на стене',
    window: 'Окно: кликните на стене',
    room: 'Комната: расставьте углы, двойной клик — замкнуть',
    text: 'Текст: кликните место для подписи',
    measure: 'Размер: две точки',
    eraser: 'Ластик: кликните элемент для удаления',
    pan: 'Перемещение: тащите холст',
  };
  setHint(hints[t] || '');
  render();
}
function bindTools() {
  $$('.tool-btn[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
}

function setHint(t) {
  const el = $('#hintText');
  el.textContent = t || '';
  $('#canvasHint').classList.toggle('hidden', !t);
}

function bindTopbar() {
  $('#btnUndo').addEventListener('click', undo);
  $('#btnRedo').addEventListener('click', redo);
  $('#btnZoomIn').addEventListener('click', () => { S.zoom = clamp(S.zoom * 1.2, 0.1, 8); updateZoomLabel(); render(); });
  $('#btnZoomOut').addEventListener('click', () => { S.zoom = clamp(S.zoom / 1.2, 0.1, 8); updateZoomLabel(); render(); });
  $('#btnZoomFit').addEventListener('click', zoomFit);
  $('#btnGrid').addEventListener('click', () => { S.showGrid = !S.showGrid; $('#btnGrid').classList.toggle('active', S.showGrid); render(); });
  $('#btnSnap').addEventListener('click', () => { S.snap = !S.snap; $('#btnSnap').classList.toggle('active', S.snap); });
  $('#btnSave').addEventListener('click', savePlan);
  $('#btnExportPng').addEventListener('click', exportPng);
  $('#btnExportSvg').addEventListener('click', exportSvg);
  $('#btnLibrary').addEventListener('click', openLibrary);
  $('#btnNewPlan').addEventListener('click', newPlan);
  // JSON import / export
  $('#btnExportJson').addEventListener('click', exportJson);
  $('#btnImportJson').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', importJson);
  // 2D / 3D view toggle
  $('#btnView2D').addEventListener('click', () => setView('2d'));
  $('#btnView3D').addEventListener('click', () => setView('3d'));
  // calculator + templates
  $('#btnCalc').addEventListener('click', openCalculator);
  $('#btnTemplates').addEventListener('click', openTemplates);
}

function setView(mode) {
  S.viewMode = mode;
  $('#btnView2D').classList.toggle('active', mode === '2d');
  $('#btnView3D').classList.toggle('active', mode === '3d');
  $('.canvas-area').classList.toggle('view-3d', mode === '3d');
  render();
  toast(mode === '3d' ? '3D изометрический вид' : '2D вид', 'success');
}
function updateZoomLabel() {
  $('#zoomLabel').textContent = Math.round(S.zoom * 100) + '%';
}
function zoomFit() {
  if (!S.walls.length && !S.furniture.length && !S.rooms.length) {
    S.pan = { x: 0, y: 0 }; S.zoom = 1; updateZoomLabel(); render(); return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  S.walls.forEach(w => { expand(w.a.x, w.a.y); expand(w.b.x, w.b.y); });
  S.furniture.forEach(f => expand(f.x, f.y));
  S.rooms.forEach(r => r.points.forEach(p => expand(p.x, p.y)));
  const pad = 100;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = maxX - minX, h = maxY - minY;
  S.zoom = clamp(Math.min(S.W / (w * pxPerCm() / S.zoom), S.H / (h * pxPerCm() / S.zoom)), 0.1, 4);
  S.pan = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  updateZoomLabel(); render();
}

/* ============================================================
 * PANELS
 * ============================================================ */
function bindPanels() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.tab-pane').forEach(p => p.classList.remove('active'));
    t.classList.add('active');
    $(`.tab-pane[data-pane="${t.dataset.tab}"]`).classList.add('active');
  }));

  // project inputs
  $('#pxPerMeter').addEventListener('change', e => { S.pxPerMeter = +e.target.value || 50; pushHistory(); render(); $('#hudScale').textContent = `1 м = ${S.pxPerMeter} px`; });
  $('#gridCm').addEventListener('change', e => { S.gridCm = +e.target.value || 20; pushHistory(); render(); });
  $('#wallThickness').addEventListener('change', e => { S.wallThickness = +e.target.value || 15; pushHistory(); render(); });
  $('#ceilingHeight').addEventListener('change', e => { S.ceilingHeight = +e.target.value || 270; pushHistory(); });

  // layer visibility
  $$('.layer-vis').forEach(b => b.addEventListener('click', () => {
    const key = b.dataset.toggle;
    S.layers[key] = !S.layers[key];
    b.closest('.layer-row').classList.toggle('hidden', !S.layers[key]);
    pushHistory(); render();
  }));

  // furniture search
  $('#furnSearch').addEventListener('input', e => renderFurnitureGrid(e.target.value));
}

function buildFurniturePanel() {
  const catWrap = $('#furnCategories');
  catWrap.innerHTML = '';
  const all = document.createElement('button');
  all.className = 'furn-cat active'; all.textContent = 'Все'; all.dataset.cat = '__all';
  catWrap.appendChild(all);
  window.FURNITURE.categories.forEach(c => {
    const b = document.createElement('button');
    b.className = 'furn-cat'; b.textContent = c; b.dataset.cat = c;
    catWrap.appendChild(b);
  });
  catWrap.addEventListener('click', e => {
    if (e.target.classList.contains('furn-cat')) {
      $$('.furn-cat').forEach(x => x.classList.remove('active'));
      e.target.classList.add('active');
      renderFurnitureGrid($('#furnSearch').value, e.target.dataset.cat);
    }
  });
  renderFurnitureGrid('');
}

function renderFurnitureGrid(filter, cat = '__all') {
  const grid = $('#furnGrid');
  grid.innerHTML = '';
  const f = (filter || '').toLowerCase();
  const items = window.FURNITURE.items.filter(i =>
    (cat === '__all' || i.cat === cat) &&
    (!f || i.name.toLowerCase().includes(f) || i.cat.toLowerCase().includes(f))
  );
  if (!items.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-3);padding:20px;font-size:12px">Ничего не найдено</div>'; return; }
  items.forEach(it => {
    const el = document.createElement('div');
    el.className = 'furn-item';
    el.innerHTML = `<svg viewBox="0 0 40 40">${it.icon}</svg><span>${it.name}</span>`;
    el.addEventListener('click', () => startFurniturePlace(it));
    grid.appendChild(el);
  });
}

function startFurniturePlace(item) {
  // enter placement mode without switching tool — keeps furniturePreview alive
  S.furniturePreview = { item, x: S.mouse.wx, y: S.mouse.wy };
  S.canvas.style.cursor = 'copy';
  setHint(`Размещение: ${item.name}. Кликните на холст, Esc — отмена`);
  render();
}

function refreshPanel(quick) {
  // layers counts
  $('#cntWalls').textContent = S.walls.length;
  $('#cntOpenings').textContent = S.openings.length;
  $('#cntRooms').textContent = S.rooms.length;
  $('#cntFurniture').textContent = S.furniture.length;
  $('#cntText').textContent = S.texts.length + S.measures.length;
  if ($('#cntSymbols')) $('#cntSymbols').textContent = S.symbols.length;

  // props
  const body = $('#propsBody');
  if (!S.selection) {
    body.innerHTML = `<div class="empty-state"><svg viewBox="0 0 24 24" width="40" height="40"><path d="M5 3l14 7-6 2-2 6z" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linejoin="round"/></svg><p>Выберите элемент,<br/>чтобы изменить его свойства</p></div>`;
    $('#projectSection').style.display = '';
    return;
  }
  $('#projectSection').style.display = 'none';
  const sel = S.selection;
  let html = '';
  if (sel.type === 'wall') {
    const w = S.walls.find(x => x.id === sel.id); if (!w) return;
    const L = wallLength(w);
    html = `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);margin-bottom:12px;font-weight:700">Стена</h3>
      <div class="field"><label>Длина (м)</label><input type="number" id="pWallLen" value="${(L/100).toFixed(2)}" step="0.05" min="0.1"></div>
      <div class="field"><label>Толщина (см)</label><input type="number" id="pWallThk" value="${w.thickness||S.wallThickness}" min="3" max="60"></div>
      <div class="field"><label>Угол (°)</label><input type="number" id="pWallAng" value="${angleDeg(w).toFixed(1)}" step="1"></div>
      <div class="field"><label>Цвет</label><input type="color" class="color-input" id="pWallColor" value="${w.color||'#3b3a38'}"></div>
      <div class="field"><label>Координаты A (x, y см)</label><div class="field-row"><input type="number" id="pAx" value="${w.a.x.toFixed(0)}"><input type="number" id="pAy" value="${w.a.y.toFixed(0)}"></div></div>
      <div class="field"><label>Координаты B (x, y см)</label><div class="field-row"><input type="number" id="pBx" value="${w.b.x.toFixed(0)}"><input type="number" id="pBy" value="${w.b.y.toFixed(0)}"></div></div>
      <button class="ghost-btn full" id="pDel" style="width:100%;color:var(--danger);margin-top:8px">Удалить стену</button>
      <button class="ghost-btn full" id="pSplit" style="width:100%;margin-top:6px">Добавить дверь</button>`;
    body.innerHTML = html;
    $('#pWallLen').addEventListener('change', e => {
      const newL = +e.target.value * 100;
      const ang = Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x);
      w.b.x = w.a.x + Math.cos(ang) * newL; w.b.y = w.a.y + Math.sin(ang) * newL;
      pushHistory(); render(); refreshPanel();
    });
    $('#pWallThk').addEventListener('change', e => { w.thickness = +e.target.value; pushHistory(); render(); });
    $('#pWallAng').addEventListener('change', e => {
      const L = wallLength(w); const ang = +e.target.value * Math.PI / 180;
      w.b.x = w.a.x + Math.cos(ang) * L; w.b.y = w.a.y + Math.sin(ang) * L;
      pushHistory(); render();
    });
    $('#pWallColor').addEventListener('input', e => { w.color = e.target.value; render(); });
    ['pAx','pAy','pBx','pBy'].forEach(id => $('#' + id).addEventListener('change', () => {
      w.a.x = +$('#pAx').value; w.a.y = +$('#pAy').value;
      w.b.x = +$('#pBx').value; w.b.y = +$('#pBy').value;
      pushHistory(); render();
    }));
    $('#pDel').addEventListener('click', () => { deleteObj(sel); });
    $('#pSplit').addEventListener('click', () => { setTool('door'); });
  } else if (sel.type === 'furniture') {
    const f = S.furniture.find(x => x.id === sel.id); if (!f) return;
    const item = window.FURNITURE.items.find(i => i.id === f.itemId);
    html = `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);margin-bottom:12px;font-weight:700">${item?item.name:'Мебель'}</h3>
      <div class="field"><label>Подпись</label><input type="text" id="pLabel" value="${f.label||''}" placeholder="не подписывать"></div>
      <div class="field-row">
        <div class="field"><label>Ширина (см)</label><input type="number" id="pFw" value="${f.w}" min="10"></div>
        <div class="field"><label>Глубина (см)</label><input type="number" id="pFh" value="${f.h}" min="10"></div>
      </div>
      <div class="field"><label>Поворот (°)</label><input type="number" id="pRot" value="${f.rot||0}" step="5"></div>
      <div class="field"><label>Цвет</label><input type="color" class="color-input" id="pFColor" value="${f.color||'#4a463f'}"></div>
      <div class="field"><label>Позиция (x, y см)</label><div class="field-row"><input type="number" id="pFx" value="${f.x.toFixed(0)}"><input type="number" id="pFy" value="${f.y.toFixed(0)}"></div></div>
      <div class="btn-row" style="margin-top:8px">
        <button class="ghost-btn" id="pFRotL">↺ -90°</button>
        <button class="ghost-btn" id="pFRotR">↻ +90°</button>
      </div>
      <button class="ghost-btn full" id="pDel" style="width:100%;color:var(--danger);margin-top:8px">Удалить</button>`;
    body.innerHTML = html;
    $('#pLabel').addEventListener('input', e => { f.label = e.target.value; render(); });
    $('#pFw').addEventListener('change', e => { f.w = +e.target.value; pushHistory(); render(); });
    $('#pFh').addEventListener('change', e => { f.h = +e.target.value; pushHistory(); render(); });
    $('#pRot').addEventListener('change', e => { f.rot = +e.target.value; pushHistory(); render(); });
    $('#pFColor').addEventListener('input', e => { f.color = e.target.value; render(); });
    $('#pFx').addEventListener('change', e => { f.x = +e.target.value; pushHistory(); render(); });
    $('#pFy').addEventListener('change', e => { f.y = +e.target.value; pushHistory(); render(); });
    $('#pFRotL').addEventListener('click', () => { f.rot = (f.rot || 0) - 90; pushHistory(); render(); refreshPanel(); });
    $('#pFRotR').addEventListener('click', () => { f.rot = (f.rot || 0) + 90; pushHistory(); render(); refreshPanel(); });
    $('#pDel').addEventListener('click', () => deleteObj(sel));
  } else if (sel.type === 'opening') {
    const o = S.openings.find(x => x.id === sel.id); if (!o) return;
    const w = S.walls.find(x => x.id === o.wallId);
    html = `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);margin-bottom:12px;font-weight:700">${o.kind==='door'?'Дверь':'Окно'}</h3>
      <div class="field"><label>Ширина (см)</label><input type="number" id="pOpenW" value="${o.width}" min="30" max="300"></div>
      <div class="field"><label>Положение на стене (${(o.t*100).toFixed(0)}%)</label><input type="range" id="pOpenT" min="0" max="1" step="0.01" value="${o.t}"></div>
      ${o.kind==='door'?`<div class="field"><label><input type="checkbox" id="pFlip" ${o.flip?'checked':''}> Открывание в другую сторону</label></div>`:''}
      <button class="ghost-btn full" id="pDel" style="width:100%;color:var(--danger);margin-top:8px">Удалить</button>`;
    body.innerHTML = html;
    $('#pOpenW').addEventListener('change', e => { o.width = +e.target.value; pushHistory(); render(); });
    $('#pOpenT').addEventListener('input', e => { o.t = +e.target.value; render(); });
    $('#pOpenT').addEventListener('change', e => { pushHistory(); });
    if (o.kind === 'door') $('#pFlip').addEventListener('change', e => { o.flip = e.target.checked; pushHistory(); render(); });
    $('#pDel').addEventListener('click', () => deleteObj(sel));
  } else if (sel.type === 'text') {
    const t = S.texts.find(x => x.id === sel.id); if (!t) return;
    html = `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);margin-bottom:12px;font-weight:700">Текст</h3>
      <div class="field"><label>Текст</label><input type="text" id="pText" value="${t.text}"></div>
      <div class="field"><label>Размер (px)</label><input type="number" id="pTextSize" value="${t.size||16}" min="8" max="80"></div>
      <div class="field"><label>Цвет</label><input type="color" class="color-input" id="pTextColor" value="${t.color||'#3b3a38'}"></div>
      <button class="ghost-btn full" id="pDel" style="width:100%;color:var(--danger);margin-top:8px">Удалить</button>`;
    body.innerHTML = html;
    $('#pText').addEventListener('input', e => { t.text = e.target.value; render(); });
    $('#pTextSize').addEventListener('change', e => { t.size = +e.target.value; pushHistory(); render(); });
    $('#pTextColor').addEventListener('input', e => { t.color = e.target.value; render(); });
    $('#pDel').addEventListener('click', () => deleteObj(sel));
  } else if (sel.type === 'room') {
    const r = S.rooms.find(x => x.id === sel.id); if (!r) return;
    const area = polygonArea(r.points) / 10000;
    html = `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);margin-bottom:12px;font-weight:700">Комната</h3>
      <div class="field"><label>Название</label><input type="text" id="pRoomName" value="${r.name||''}"></div>
      <div class="field"><label>Тип помещения</label>
        <select id="pRoomType" style="width:100%;height:32px;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;padding:0 8px">
          ${['Комната','Гостиная','Спальня','Кухня','Санузел','Ванная','Прихожая','Кабинет','Детская','Балкон','Гардероб','Другое'].map(t=>`<option ${r.name===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="field"><label>Площадь</label><input type="text" value="${area.toFixed(2)} м²" disabled></div>
      <div class="field"><label>Цвет заливки</label><input type="color" class="color-input" id="pRoomColor" value="${rgbaToHex(r.color)}"></div>
      <button class="ghost-btn full" id="pDel" style="width:100%;color:var(--danger);margin-top:8px">Удалить комнату</button>`;
    body.innerHTML = html;
    $('#pRoomName').addEventListener('input', e => { r.name = e.target.value; render(); });
    $('#pRoomType').addEventListener('change', e => { r.name = e.target.value; $('#pRoomName').value = e.target.value; render(); });
    $('#pRoomColor').addEventListener('input', e => { r.color = hexToRgba(e.target.value, 0.12); render(); });
    $('#pDel').addEventListener('click', () => deleteObj(sel));
  } else if (sel.type === 'symbol') {
    const s = S.symbols.find(x => x.id === sel.id); if (!s) return;
    const kindName = s.kind === 'outlet' ? 'Электроточка' : s.kind === 'light' ? 'Освещение' : 'Заметка';
    html = `
      <h3 style="font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:var(--text-3);margin-bottom:12px;font-weight:700">${kindName}</h3>`;
    if (s.kind === 'outlet') {
      html += `
      <div class="field"><label>Тип</label>
        <select id="pSymSub" style="width:100%;height:32px;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;padding:0 8px">
          ${['Розетка','Розетка 2-ая','Выключатель','Выключатель 2-ой','Розетка TV','Розетка интернет','Электрощиток'].map(t=>`<option ${s.label===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>`;
    } else if (s.kind === 'light') {
      html += `
      <div class="field"><label>Тип светильника</label>
        <select id="pSymSub" style="width:100%;height:32px;background:var(--bg-3);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;padding:0 8px">
          ${['Потолочный','Люстра','Точечный','Бра','Торшер','LED-лента'].map(t=>`<option ${s.label===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>`;
    } else {
      html += `<div class="field"><label>Текст заметки</label><input type="text" id="pSymText" value="${escapeHtml(s.text||'Заметка')}"></div>`;
    }
    html += `
      <div class="field"><label>Поворот (°)</label><input type="number" id="pSymRot" value="${s.rot||0}" step="15"></div>
      <div class="field"><label>Позиция (x, y см)</label><div class="field-row"><input type="number" id="pSymX" value="${s.x.toFixed(0)}"><input type="number" id="pSymY" value="${s.y.toFixed(0)}"></div></div>
      <button class="ghost-btn full" id="pDel" style="width:100%;color:var(--danger);margin-top:8px">Удалить</button>`;
    body.innerHTML = html;
    if ($('#pSymSub')) $('#pSymSub').addEventListener('change', e => { s.label = e.target.value; pushHistory(); render(); });
    if ($('#pSymText')) $('#pSymText').addEventListener('input', e => { s.text = e.target.value; render(); });
    $('#pSymRot').addEventListener('change', e => { s.rot = +e.target.value; pushHistory(); render(); });
    $('#pSymX').addEventListener('change', e => { s.x = +e.target.value; pushHistory(); render(); });
    $('#pSymY').addEventListener('change', e => { s.y = +e.target.value; pushHistory(); render(); });
    $('#pDel').addEventListener('click', () => deleteObj(sel));
  }
}

function syncInputs() {
  $('#pxPerMeter').value = S.pxPerMeter;
  $('#gridCm').value = S.gridCm;
  $('#wallThickness').value = S.wallThickness;
  $('#ceilingHeight').value = S.ceilingHeight;
  $('#hudScale').textContent = `1 м = ${S.pxPerMeter} px`;
  // sync layer visibility UI
  $$('.layer-row').forEach(row => {
    const key = row.dataset.layer;
    row.classList.toggle('hidden', !S.layers[key]);
  });
}

function getObj(hit) {
  if (hit.type === 'wall') return S.walls.find(x => x.id === hit.id);
  if (hit.type === 'furniture') return S.furniture.find(x => x.id === hit.id);
  if (hit.type === 'opening') return S.openings.find(x => x.id === hit.id);
  if (hit.type === 'text') return S.texts.find(x => x.id === hit.id);
  if (hit.type === 'room') return S.rooms.find(x => x.id === hit.id);
  if (hit.type === 'symbol') return S.symbols.find(x => x.id === hit.id);
  return null;
}
function deleteObj(hit) {
  if (hit.type === 'wall') {
    S.walls = S.walls.filter(x => x.id !== hit.id);
    S.openings = S.openings.filter(o => o.wallId !== hit.id);
  } else if (hit.type === 'furniture') S.furniture = S.furniture.filter(x => x.id !== hit.id);
  else if (hit.type === 'opening') S.openings = S.openings.filter(x => x.id !== hit.id);
  else if (hit.type === 'text') S.texts = S.texts.filter(x => x.id !== hit.id);
  else if (hit.type === 'room') S.rooms = S.rooms.filter(x => x.id !== hit.id);
  else if (hit.type === 'symbol') S.symbols = S.symbols.filter(x => x.id !== hit.id);
  S.selection = null;
  pushHistory(); render(); refreshPanel();
}

function rgbaToHex(c) {
  if (!c) return '#f59e0b';
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#f59e0b';
  return '#' + [m[1], m[2], m[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
}
function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* ============================================================
 * STATS / HUD
 * ============================================================ */
function updateHud() {
  $('#hudX').textContent = Math.round(S.mouse.wx);
  $('#hudY').textContent = Math.round(S.mouse.wy);
}
function updateStats() {
  let perimeter = 0, wallArea = 0;
  S.walls.forEach(w => { const L = wallLength(w); perimeter += L; wallArea += L * (w.thickness || S.wallThickness); });
  let totalArea = 0;
  S.rooms.forEach(r => { totalArea += polygonArea(r.points); });
  $('#statWallArea').textContent = (wallArea / 10000).toFixed(2) + ' м²';
  $('#statTotalArea').textContent = (totalArea / 10000).toFixed(2) + ' м²';
  $('#statPerimeter').textContent = (perimeter / 100).toFixed(2) + ' м';
}

/* ============================================================
 * KEYBOARD
 * ============================================================ */
function bindKeyboard() {
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.code === 'Space') { S.spacePan = true; if (!S.mouse.down) $('.canvas-area').classList.add('tool-pan'); e.preventDefault(); }
    if (e.key === 'Escape') { S.drafting = null; S.selection = null; S.furniturePreview = null; S.canvas.style.cursor = ''; setHint(''); render(); refreshPanel(); }
    if (e.key === 'Enter') {
      if (S.drafting && S.drafting.type === 'wall') { S.drafting = null; setHint(''); render(); }
      if (S.drafting && S.drafting.type === 'room' && S.drafting.points.length >= 3) {
        S.rooms.push({ id: uid(), points: S.drafting.points.slice(), name: 'Комната', color: 'rgba(245,158,11,0.08)' });
        S.drafting = null; pushHistory(); render(); refreshPanel(); setHint('');
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); savePlan(); }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (S.selection) { deleteObj(S.selection); } }
    const map = { v: 'select', w: 'wall', d: 'door', n: 'window', r: 'room', t: 'text', m: 'measure', e: 'eraser', h: 'pan', s: 'split', o: 'outlet', l: 'light' };
    if (map[e.key.toLowerCase()] && !e.ctrlKey && !e.metaKey) setTool(map[e.key.toLowerCase()]);
    if (e.key === '[') { S.furniture.forEach(f => { if (S.selection && S.selection.id === f.id) f.rot = (f.rot||0) - 5; }); render(); refreshPanel(true); }
    if (e.key === ']') { S.furniture.forEach(f => { if (S.selection && S.selection.id === f.id) f.rot = (f.rot||0) + 5; }); render(); refreshPanel(true); }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { S.spacePan = false; if (S.tool !== 'pan') $('.canvas-area').classList.remove('tool-pan'); }
  });
}

/* ============================================================
 * MODALS (text, library)
 * ============================================================ */
function bindModals() {
  $$('[data-close]').forEach(b => b.addEventListener('click', () => { $('#' + b.dataset.close).hidden = true; }));
  $$('.modal-overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) o.hidden = true; }));
  $('#btnTextConfirm').addEventListener('click', confirmText);
}

function openTextModal(existing) {
  $('#modalText').hidden = false;
  $('#textInput').value = existing ? existing.text : '';
  $('#textSize').value = existing ? (existing.size || 16) : 16;
  $('#textModalTitle').textContent = existing ? 'Редактировать текст' : 'Новая подпись';
  setTimeout(() => $('#textInput').focus(), 50);
}
function confirmText() {
  const text = $('#textInput').value.trim();
  if (!text) { $('#modalText').hidden = true; return; }
  const size = +$('#textSize').value || 16;
  if (S._pendingTextPos && S._pendingTextPos.id) {
    const t = S.texts.find(x => x.id === S._pendingTextPos.id);
    if (t) { t.text = text; t.size = size; }
  } else if (S._pendingTextPos) {
    S.texts.push({ id: uid(), x: S._pendingTextPos.x, y: S._pendingTextPos.y, text, size, color: '#3b3a38' });
    S.selection = { type: 'text', id: S.texts[S.texts.length - 1].id };
  }
  S._pendingTextPos = null;
  $('#modalText').hidden = true;
  pushHistory(); render(); refreshPanel();
  setTool('select');
}

/* ============================================================
 * LIBRARY (save/load)
 * ============================================================ */
async function openLibrary() {
  $('#modalLibrary').hidden = false;
  const grid = $('#plansGrid');
  grid.innerHTML = '<div class="plans-empty">Загрузка...</div>';
  try {
    const r = await fetch('/api/plans/?XTransformPort=5050');
    const plans = await r.json();
    if (!plans.length) { grid.innerHTML = '<div class="plans-empty">Нет сохранённых проектов</div>'; return; }
    grid.innerHTML = '';
    plans.forEach(p => {
      const card = document.createElement('div');
      card.className = 'plan-card';
      const d = new Date(p.updated);
      card.innerHTML = `
        <div class="thumb">${p.thumbnail ? `<img src="${p.thumbnail}" alt="">` : '<span class="ph">пусто</span>'}</div>
        <div class="meta">
          <div class="pn">${escapeHtml(p.name)}</div>
          <div class="pd"><span>${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}</span><span class="del">удалить</span></div>
        </div>`;
      card.addEventListener('click', async (ev) => {
        if (ev.target.classList.contains('del')) {
          ev.stopPropagation();
          await fetch('/api/plans/' + p.id + '?XTransformPort=5050', { method: 'DELETE' });
          openLibrary(); return;
        }
        await loadPlan(p.id);
        $('#modalLibrary').hidden = true;
      });
      grid.appendChild(card);
    });
  } catch (e) {
    grid.innerHTML = '<div class="plans-empty">Ошибка загрузки</div>';
  }
}
function escapeHtml(s) { return (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function loadPlan(id) {
  try {
    const r = await fetch('/api/plans/' + id + '?XTransformPort=5050');
    const data = await r.json();
    S.planId = data.id; S.planName = data.name || 'Без названия';
    $('#planName').value = S.planName;
    restore(data);
    S.history = []; S.histIdx = -1; pushHistory();
    S.dirty = false; $('#saveStatus').textContent = 'сохранено'; $('#saveStatus').classList.add('saved');
    zoomFit();
    toast(`Загружено: ${S.planName}`, 'success');
  } catch (e) { toast('Ошибка загрузки', 'error'); }
}

async function savePlan() {
  const data = snapshot();
  data.id = S.planId || uid();
  data.name = $('#planName').value || 'Без названия';
  S.planId = data.id; S.planName = data.name;
  // thumbnail (small png)
  data.thumbnail = makeThumbnail();
  try {
    const r = await fetch('/api/plans?XTransformPort=5050', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const res = await r.json();
    S.dirty = false; $('#saveStatus').textContent = 'сохранено'; $('#saveStatus').classList.add('saved');
    toast('Проект сохранён', 'success');
  } catch (e) { toast('Ошибка сохранения', 'error'); }
}

function newPlan() {
  S.walls = []; S.openings = []; S.rooms = []; S.furniture = []; S.texts = []; S.measures = [];
  S.selection = null; S.planId = null; S.planName = 'Без названия';
  $('#planName').value = S.planName;
  S.pan = { x: 0, y: 0 }; S.zoom = 1; updateZoomLabel();
  S.history = []; S.histIdx = -1; pushHistory();
  $('#modalLibrary').hidden = true;
  render(); refreshPanel();
  toast('Новый проект', 'success');
}

function makeThumbnail() {
  // render small offscreen
  const tmp = document.createElement('canvas');
  tmp.width = 240; tmp.height = 160;
  const tc = tmp.getContext('2d');
  tc.fillStyle = '#f4f1ea'; tc.fillRect(0, 0, 240, 160);
  if (!S.walls.length && !S.furniture.length) return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const ex = (x,y) => { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); };
  S.walls.forEach(w => { ex(w.a.x,w.a.y); ex(w.b.x,w.b.y); });
  S.furniture.forEach(f => ex(f.x,f.y));
  S.rooms.forEach(r => r.points.forEach(p => ex(p.x,p.y)));
  const pad = 50; minX-=pad;minY-=pad;maxX+=pad;maxY+=pad;
  const w = maxX-minX, h = maxY-minY;
  const sc = Math.min(220/w, 140/h);
  const ox = (240 - w*sc)/2 - minX*sc, oy = (160 - h*sc)/2 - minY*sc;
  const p2s = (x,y) => [x*sc+ox, y*sc+oy];
  tc.strokeStyle = '#3b3a38'; tc.lineWidth = 2; tc.lineCap = 'round';
  S.walls.forEach(w => { const [ax,ay]=p2s(w.a.x,w.a.y);const [bx,by]=p2s(w.b.x,w.b.y);tc.beginPath();tc.moveTo(ax,ay);tc.lineTo(bx,by);tc.stroke(); });
  tc.fillStyle = 'rgba(245,158,11,.15)';
  S.rooms.forEach(r => { tc.beginPath();const [x0,y0]=p2s(r.points[0].x,r.points[0].y);tc.moveTo(x0,y0);for(let i=1;i<r.points.length;i++){const [x,y]=p2s(r.points[i].x,r.points[i].y);tc.lineTo(x,y);}tc.closePath();tc.fill(); });
  return tmp.toDataURL('image/png');
}

/* ============================================================
 * EXPORT
 * ============================================================ */
function exportPng() {
  // re-render at high res into temp canvas covering bbox
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const ex = (x,y) => { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); };
  S.walls.forEach(w => { ex(w.a.x,w.a.y); ex(w.b.x,w.b.y); });
  S.furniture.forEach(f => ex(f.x,f.y));
  S.rooms.forEach(r => r.points.forEach(p => ex(p.x,p.y)));
  S.texts.forEach(t => ex(t.x,t.y));
  if (!isFinite(minX)) { minX=-200;minY=-200;maxX=200;maxY=200; }
  const pad = 150; minX-=pad;minY-=pad;maxX+=pad;maxY+=pad;
  const wcm = maxX-minX, hcm = maxY-minY;
  const sc = S.pxPerMeter/100 * 2; // 2x for quality
  const tmp = document.createElement('canvas');
  tmp.width = wcm*sc; tmp.height = hcm*sc;
  const tc = tmp.getContext('2d');
  tc.fillStyle = '#f4f1ea'; tc.fillRect(0,0,tmp.width,tmp.height);
  // grid
  tc.strokeStyle = '#d8d2c4'; tc.lineWidth = 1; tc.beginPath();
  for(let x=Math.floor(minX/S.gridCm)*S.gridCm;x<=maxX;x+=S.gridCm){tc.moveTo((x-minX)*sc,0);tc.lineTo((x-minX)*sc,tmp.height);}
  for(let y=Math.floor(minY/S.gridCm)*S.gridCm;y<=maxY;y+=S.gridCm){tc.moveTo(0,(y-minY)*sc);tc.lineTo(tmp.width,(y-minY)*sc);}
  tc.stroke();
  // rooms
  S.rooms.forEach(r => { tc.beginPath();const [x0,y0]=[(r.points[0].x-minX)*sc,(r.points[0].y-minY)*sc];tc.moveTo(x0,y0);for(let i=1;i<r.points.length;i++){tc.lineTo((r.points[i].x-minX)*sc,(r.points[i].y-minY)*sc);}tc.closePath();tc.fillStyle=r.color||'rgba(245,158,11,0.08)';tc.fill();tc.strokeStyle='rgba(120,110,90,.35)';tc.setLineDash([4,4]);tc.stroke();tc.setLineDash([]); });
  // walls
  S.walls.forEach(w => { tc.strokeStyle=w.color||'#3b3a38';tc.lineWidth=Math.max(2,(w.thickness||S.wallThickness)*sc);tc.lineCap='round';tc.beginPath();tc.moveTo((w.a.x-minX)*sc,(w.a.y-minY)*sc);tc.lineTo((w.b.x-minX)*sc,(w.b.y-minY)*sc);tc.stroke(); });
  tc.lineCap='butt';
  // openings (simplified)
  S.openings.forEach(o => { const w=S.walls.find(x=>x.id===o.wallId);if(!w)return;const cx=w.a.x+(w.b.x-w.a.x)*o.t,cy=w.a.y+(w.b.y-w.a.y)*o.t;tc.fillStyle='#f4f1ea';const ang=Math.atan2(w.b.y-w.a.y,w.b.x-w.a.x);const hw=(o.width||80)/2*sc;tc.save();tc.translate((cx-minX)*sc,(cy-minY)*sc);tc.rotate(ang);tc.fillRect(-hw,-(w.thickness||S.wallThickness)*sc/2,hw*2,(w.thickness||S.wallThickness)*sc);tc.restore(); });
  // furniture
  S.furniture.forEach(f => { const it=window.FURNITURE.items.find(i=>i.id===f.itemId);if(!it)return;tc.save();tc.translate((f.x-minX)*sc,(f.y-minY)*sc);tc.rotate((f.rot||0)*Math.PI/180);tc.strokeStyle=f.color||'#4a463f';tc.lineWidth=1.4;tc.fillStyle=(f.color||'#4a463f')+'22';tc.fillRect(-f.w*sc/2,-f.h*sc/2,f.w*sc,f.h*sc);tc.strokeRect(-f.w*sc/2,-f.h*sc/2,f.w*sc,f.h*sc);it.draw(tc,f.w*sc,f.h*sc);tc.restore(); });
  // openings: proper door / window symbols (same as live render)
  S.openings.forEach(o => { const w=S.walls.find(x=>x.id===o.wallId);if(!w)return;const len=wallLength(w);if(len<1)return;const t=clamp(o.t,0,1);const wsize=o.width||80;const halfT=(w.thickness||S.wallThickness)/2;const ang=Math.atan2(w.b.y-w.a.y,w.b.x-w.a.x);const cx=w.a.x+(w.b.x-w.a.x)*t,cy=w.a.y+(w.b.y-w.a.y)*t;const perp=ang+Math.PI/2;const halfW=wsize/2;const p1={x:cx+Math.cos(ang)*halfW,y:cy+Math.sin(ang)*halfW};const p2={x:cx-Math.cos(ang)*halfW,y:cy-Math.sin(ang)*halfW};const pa={x:p1.x+Math.cos(perp)*halfT,y:p1.y+Math.sin(perp)*halfT};const pb={x:p1.x-Math.cos(perp)*halfT,y:p1.y-Math.sin(perp)*halfT};const pc={x:p2.x-Math.cos(perp)*halfT,y:p2.y-Math.sin(perp)*halfT};const pd={x:p2.x+Math.cos(perp)*halfT,y:p2.y+Math.sin(perp)*halfT};const sP=a=>[(a.x-minX)*sc,(a.y-minY)*sc];tc.beginPath();tc.moveTo(...sP(pa));tc.lineTo(...sP(pb));tc.lineTo(...sP(pc));tc.lineTo(...sP(pd));tc.closePath();tc.fillStyle='#f4f1ea';tc.fill();
    if(o.kind==='door'){const hinge=o.flip?p2:p1;const [hx,hy]=sP(hinge);const leafEnd=o.flip?{x:p2.x-Math.cos(perp)*wsize,y:p2.y-Math.sin(perp)*wsize}:{x:p1.x+Math.cos(perp)*wsize,y:p1.y+Math.sin(perp)*wsize};const [lex,ley]=sP(leafEnd);tc.strokeStyle='#5a4a2a';tc.lineWidth=1.5*sc*0.5;tc.beginPath();tc.moveTo(hx,hy);tc.lineTo(lex,ley);tc.stroke();const startA=o.flip?ang+Math.PI:ang;tc.beginPath();tc.arc(hx,hy,wsize*sc,startA,startA+(o.flip?-Math.PI/2:Math.PI/2),o.flip);tc.strokeStyle='rgba(90,74,42,.5)';tc.setLineDash([3*sc*0.5,3*sc*0.5]);tc.stroke();tc.setLineDash([]);}
    else if(o.kind==='window'){const l1=[(p1.x+Math.cos(perp)*halfT*0.4-minX)*sc,(p1.y+Math.sin(perp)*halfT*0.4-minY)*sc];const l2=[(p2.x+Math.cos(perp)*halfT*0.4-minX)*sc,(p2.y+Math.sin(perp)*halfT*0.4-minY)*sc];const l3=[(p1.x-Math.cos(perp)*halfT*0.4-minX)*sc,(p1.y-Math.sin(perp)*halfT*0.4-minY)*sc];const l4=[(p2.x-Math.cos(perp)*halfT*0.4-minX)*sc,(p2.y-Math.sin(perp)*halfT*0.4-minY)*sc];tc.strokeStyle='#2d6a9f';tc.lineWidth=1.6*sc*0.5;tc.beginPath();tc.moveTo(...l1);tc.lineTo(...l2);tc.moveTo(...l3);tc.lineTo(...l4);tc.stroke();}
    tc.strokeStyle='#3b3a38';tc.lineWidth=2*sc*0.5;const c1a=sP({x:p1.x+Math.cos(perp)*halfT,y:p1.y+Math.sin(perp)*halfT});const c1b=sP({x:p1.x-Math.cos(perp)*halfT,y:p1.y-Math.sin(perp)*halfT});const c2a=sP({x:p2.x+Math.cos(perp)*halfT,y:p2.y+Math.sin(perp)*halfT});const c2b=sP({x:p2.x-Math.cos(perp)*halfT,y:p2.y-Math.sin(perp)*halfT});tc.beginPath();tc.moveTo(...c1a);tc.lineTo(...c1b);tc.moveTo(...c2a);tc.lineTo(...c2b);tc.stroke();
  });
  // text
  S.texts.forEach(t => { tc.fillStyle=t.color||'#3b3a38';tc.font=`600 ${t.size||16}px Inter`;tc.textAlign='center';tc.textBaseline='middle';tc.fillText(t.text,(t.x-minX)*sc,(t.y-minY)*sc); });
  // measures (dimension lines)
  S.measures.forEach(m => { const ax=(m.a.x-minX)*sc,ay=(m.a.y-minY)*sc,bx=(m.b.x-minX)*sc,by=(m.b.y-minY)*sc;exportDimLine(tc,ax,ay,bx,by,(dist(m.a.x,m.a.y,m.b.x,m.b.y)/100).toFixed(2)+' м'); });
  // room labels (name + area)
  S.rooms.forEach(r => { if(r.points.length<3)return;const area=polygonArea(r.points)/10000;const cx=r.points.reduce((s,p)=>s+p.x,0)/r.points.length;const cy=r.points.reduce((s,p)=>s+p.y,0)/r.points.length;tc.fillStyle='#6b5d3f';tc.font='600 14px Inter';tc.textAlign='center';tc.textBaseline='middle';tc.fillText(r.name||'',(cx-minX)*sc,(cy-minY)*sc-9);tc.font='500 13px Inter';tc.fillText(area.toFixed(1)+' м²',(cx-minX)*sc,(cy-minY)*sc+9); });

  const link = document.createElement('a');
  link.download = (S.planName || 'plan') + '.png';
  link.href = tmp.toDataURL('image/png');
  link.click();
  toast('PNG экспортирован', 'success');
}

// dimension-line helper for export (uses passed ctx)
function exportDimLine(c, ax, ay, bx, by, label) {
  const ang = Math.atan2(by - ay, bx - ax);
  const off = 18;
  const ox = Math.cos(ang - Math.PI / 2) * off;
  const oy = Math.sin(ang - Math.PI / 2) * off;
  c.strokeStyle = '#c2410c'; c.lineWidth = 1;
  c.beginPath();
  c.moveTo(ax + ox, ay + oy); c.lineTo(bx + ox, by + oy);
  c.moveTo(ax, ay); c.lineTo(ax + ox, ay + oy);
  c.moveTo(bx, by); c.lineTo(bx + ox, by + oy);
  c.stroke();
  const mx = (ax + bx) / 2 + ox, my = (ay + by) / 2 + oy;
  c.font = '600 12px Inter';
  const w = c.measureText(label).width + 8;
  c.fillStyle = '#fff7ed';
  c.fillRect(mx - w / 2, my - 9, w, 18);
  c.strokeStyle = '#fdba74'; c.lineWidth = 1; c.strokeRect(mx - w / 2, my - 9, w, 18);
  c.fillStyle = '#9a3412'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(label, mx, my);
}

function exportSvg() {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const ex = (x,y) => { minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y); };
  S.walls.forEach(w => { ex(w.a.x,w.a.y); ex(w.b.x,w.b.y); });
  S.furniture.forEach(f => ex(f.x,f.y));
  S.rooms.forEach(r => r.points.forEach(p => ex(p.x,p.y)));
  if (!isFinite(minX)) { minX=-200;minY=-200;maxX=200;maxY=200; }
  const pad = 100; minX-=pad;minY-=pad;maxX+=pad;maxY+=pad;
  const sc = S.pxPerMeter/100;
  const W = (maxX-minX)*sc, H = (maxY-minY)*sc;
  const p2s = (x,y) => [(x-minX)*sc, (y-minY)*sc];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  svg += `<rect width="${W}" height="${H}" fill="#f4f1ea"/>`;
  // rooms
  S.rooms.forEach(r => { const pts=r.points.map(p=>p2s(p.x,p.y).join(',')).join(' ');svg+=`<polygon points="${pts}" fill="${r.color||'rgba(245,158,11,0.08)'}" stroke="rgba(120,110,90,.35)" stroke-dasharray="4 4"/>`; });
  // walls
  S.walls.forEach(w => { const [ax,ay]=p2s(w.a.x,w.a.y);const [bx,by]=p2s(w.b.x,w.b.y);svg+=`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${w.color||'#3b3a38'}" stroke-width="${(w.thickness||S.wallThickness)*sc}" stroke-linecap="round"/>`; });
  // furniture
  S.furniture.forEach(f => { const [fx,fy]=p2s(f.x,f.y);const it=window.FURNITURE.items.find(i=>i.id===f.itemId);svg+=`<g transform="translate(${fx},${fy}) rotate(${f.rot||0})"><rect x="${-f.w*sc/2}" y="${-f.h*sc/2}" width="${f.w*sc}" height="${f.h*sc}" fill="${(f.color||'#4a463f')}22" stroke="${f.color||'#4a463f'}" stroke-width="1.4"/>${furnToSvg(it, f.w*sc, f.h*sc, f.color||'#4a463f')}</g>`; });
  // openings (door/window symbols)
  S.openings.forEach(o => { const w=S.walls.find(x=>x.id===o.wallId);if(!w)return;const len=wallLength(w);if(len<1)return;const t=clamp(o.t,0,1);const wsize=o.width||80;const halfT=(w.thickness||S.wallThickness)/2;const ang=Math.atan2(w.b.y-w.a.y,w.b.x-w.a.x);const cx=w.a.x+(w.b.x-w.a.x)*t,cy=w.a.y+(w.b.y-w.a.y)*t;const perp=ang+Math.PI/2;const halfW=wsize/2;const p1={x:cx+Math.cos(ang)*halfW,y:cy+Math.sin(ang)*halfW};const p2={x:cx-Math.cos(ang)*halfW,y:cy-Math.sin(ang)*halfW};const [pax,pay]=p2s(p1.x+Math.cos(perp)*halfT,p1.y+Math.sin(perp)*halfT);const [pbx,pby]=p2s(p1.x-Math.cos(perp)*halfT,p1.y-Math.sin(perp)*halfT);const [pcx,pcy]=p2s(p2.x-Math.cos(perp)*halfT,p2.y-Math.sin(perp)*halfT);const [pdx,pdy]=p2s(p2.x+Math.cos(perp)*halfT,p2.y+Math.sin(perp)*halfT);svg+=`<polygon points="${pax},${pay} ${pbx},${pby} ${pcx},${pcy} ${pdx},${pdy}" fill="#f4f1ea"/>`;
    if(o.kind==='door'){const hinge=o.flip?p2:p1;const [hx,hy]=p2s(hinge.x,hinge.y);const leafEnd=o.flip?{x:p2.x-Math.cos(perp)*wsize,y:p2.y-Math.sin(perp)*wsize}:{x:p1.x+Math.cos(perp)*wsize,y:p1.y+Math.sin(perp)*wsize};const [lex,ley]=p2s(leafEnd.x,leafEnd.y);svg+=`<line x1="${hx}" y1="${hy}" x2="${lex}" y2="${ley}" stroke="#5a4a2a" stroke-width="1.5"/>`;const r=wsize*sc;const startDeg=(o.flip?ang+Math.PI:ang)*180/Math.PI;const endDeg=startDeg+(o.flip?-90:90);svg+=`<path d="M ${hx+r*Math.cos(startDeg*Math.PI/180)} ${hy+r*Math.sin(startDeg*Math.PI/180)} A ${r} ${r} 0 0 ${o.flip?1:0} ${hx+r*Math.cos(endDeg*Math.PI/180)} ${hy+r*Math.sin(endDeg*Math.PI/180)}" fill="none" stroke="rgba(90,74,42,.5)" stroke-dasharray="3 3"/>`;}
    else if(o.kind==='window'){const [l1x,l1y]=p2s(p1.x+Math.cos(perp)*halfT*0.4,p1.y+Math.sin(perp)*halfT*0.4);const [l2x,l2y]=p2s(p2.x+Math.cos(perp)*halfT*0.4,p2.y+Math.sin(perp)*halfT*0.4);const [l3x,l3y]=p2s(p1.x-Math.cos(perp)*halfT*0.4,p1.y-Math.sin(perp)*halfT*0.4);const [l4x,l4y]=p2s(p2.x-Math.cos(perp)*halfT*0.4,p2.y-Math.sin(perp)*halfT*0.4);svg+=`<line x1="${l1x}" y1="${l1y}" x2="${l2x}" y2="${l2y}" stroke="#2d6a9f" stroke-width="1.6"/><line x1="${l3x}" y1="${l3y}" x2="${l4x}" y2="${l4y}" stroke="#2d6a9f" stroke-width="1.6"/>`;}
    const [c1ax,c1ay]=p2s(p1.x+Math.cos(perp)*halfT,p1.y+Math.sin(perp)*halfT);const [c1bx,c1by]=p2s(p1.x-Math.cos(perp)*halfT,p1.y-Math.sin(perp)*halfT);const [c2ax,c2ay]=p2s(p2.x+Math.cos(perp)*halfT,p2.y+Math.sin(perp)*halfT);const [c2bx,c2by]=p2s(p2.x-Math.cos(perp)*halfT,p2.y-Math.sin(perp)*halfT);svg+=`<line x1="${c1ax}" y1="${c1ay}" x2="${c1bx}" y2="${c1by}" stroke="#3b3a38" stroke-width="2"/><line x1="${c2ax}" y1="${c2ay}" x2="${c2bx}" y2="${c2by}" stroke="#3b3a38" stroke-width="2"/>`;
  });
  // texts
  S.texts.forEach(t => { const [x,y]=p2s(t.x,t.y);svg+=`<text x="${x}" y="${y}" font-family="Inter" font-size="${t.size||16}" font-weight="600" fill="${t.color||'#3b3a38'}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(t.text)}</text>`; });
  // measures
  S.measures.forEach(m => { const [ax,ay]=p2s(m.a.x,m.a.y);const [bx,by]=p2s(m.b.x,m.b.y);const ang=Math.atan2(by-ay,bx-ax);const off=18;const ox=Math.cos(ang-Math.PI/2)*off;const oy=Math.sin(ang-Math.PI/2)*off;const mx=(ax+bx)/2+ox,my=(ay+by)/2+oy;svg+=`<line x1="${ax+ox}" y1="${ay+oy}" x2="${bx+ox}" y2="${by+oy}" stroke="#c2410c" stroke-width="1"/><line x1="${ax}" y1="${ay}" x2="${ax+ox}" y2="${ay+oy}" stroke="#c2410c" stroke-width="1"/><line x1="${bx}" y1="${by}" x2="${bx+ox}" y2="${by+oy}" stroke="#c2410c" stroke-width="1"/><rect x="${mx-25}" y="${my-9}" width="50" height="18" rx="2" fill="#fff7ed" stroke="#fdba74"/><text x="${mx}" y="${my}" font-family="Inter" font-size="12" font-weight="600" fill="#9a3412" text-anchor="middle" dominant-baseline="middle">${(dist(m.a.x,m.a.y,m.b.x,m.b.y)/100).toFixed(2)} м</text>`; });
  // room labels
  S.rooms.forEach(r => { if(r.points.length<3)return;const area=polygonArea(r.points)/10000;const cx=r.points.reduce((s,p)=>s+p.x,0)/r.points.length;const cy=r.points.reduce((s,p)=>s+p.y,0)/r.points.length;const [lx,ly]=p2s(cx,cy);svg+=`<text x="${lx}" y="${ly-9}" font-family="Inter" font-size="14" font-weight="600" fill="#6b5d3f" text-anchor="middle" dominant-baseline="middle">${escapeHtml(r.name||'')}</text><text x="${lx}" y="${ly+9}" font-family="Inter" font-size="13" font-weight="500" fill="#6b5d3f" text-anchor="middle" dominant-baseline="middle">${area.toFixed(1)} м²</text>`; });
  svg += `</svg>`;
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const link = document.createElement('a');
  link.download = (S.planName || 'plan') + '.svg';
  link.href = URL.createObjectURL(blob);
  link.click();
  toast('SVG экспортирован', 'success');
}
function furnToSvg(it, w, h, color) {
  // crude: draw rect only (full SVG conversion of each shape is heavy)
  return `<text x="0" y="0" font-size="9" fill="${color}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(it.name)}</text>`;
}

/* ============================================================
 * JSON EXPORT / IMPORT
 * ============================================================ */
function exportJson() {
  const data = snapshot();
  data.id = S.planId || uid();
  data.name = $('#planName').value || 'Без названия';
  data.exportedAt = new Date().toISOString();
  data.appVersion = '2.0';
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = (data.name || 'plan').replace(/[^\wа-яА-Я-]/gi, '_') + '.json';
  link.href = URL.createObjectURL(blob);
  link.click();
  toast('Проект экспортирован в JSON', 'success');
}

function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.walls && !data.rooms) throw new Error('Не похоже на проект планировщика');
      restore(data);
      S.history = []; S.histIdx = -1; pushHistory();
      S.planId = data.id || null;
      S.planName = data.name || 'Импортированный проект';
      $('#planName').value = S.planName;
      S.dirty = false; $('#saveStatus').textContent = 'импортировано'; $('#saveStatus').classList.add('saved');
      zoomFit();
      toast('Проект импортирован: ' + S.planName, 'success');
    } catch (err) {
      toast('Ошибка импорта: ' + err.message, 'error');
    }
    e.target.value = ''; // reset for re-import
  };
  reader.readAsText(file);
}

/* ============================================================
 * CALCULATOR — materials estimate
 * ============================================================ */
function openCalculator() {
  const body = $('#calcBody');
  // compute metrics
  let perimeter = 0, wallArea = 0, floorArea = 0;
  S.walls.forEach(w => { const L = wallLength(w); perimeter += L; wallArea += L * (S.ceilingHeight || 270); });
  S.rooms.forEach(r => { floorArea += polygonArea(r.points); });
  if (!floorArea && S.walls.length) {
    // rough estimate: bounding box
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    S.walls.forEach(w=>{minX=Math.min(minX,w.a.x,w.b.x);minY=Math.min(minY,w.a.y,w.b.y);maxX=Math.max(maxX,w.a.x,w.b.x);maxY=Math.max(maxY,w.a.y,w.b.y);});
    floorArea = (maxX-minX)*(maxY-minY);
  }
  const floorM2 = floorArea / 10000;
  const wallM2 = wallArea / 10000;
  const perimM = perimeter / 100;
  const doors = S.openings.filter(o => o.kind === 'door').length;
  const windows = S.openings.filter(o => o.kind === 'window').length;
  const openingsArea = doors * 1.9 * 0.9 + windows * 1.5 * 1.4; // ~ average door 1.9x0.9, window 1.5x1.4

  body.innerHTML = `
    <div class="calc-note">Расчёт ориентировочный, на основе текущего чертежа. Высота потолка: <b>${S.ceilingHeight} см</b>. Для точных смет уточняйте у поставщиков.</div>

    <div class="calc-section">
      <h3>Основные параметры</h3>
      <div class="calc-grid">
        <div class="calc-item"><span class="ci-label">Площадь пола</span><span class="ci-value">${floorM2.toFixed(2)}</span><span class="ci-unit">м²</span></div>
        <div class="calc-item"><span class="ci-label">Периметр стен</span><span class="ci-value">${perimM.toFixed(2)}</span><span class="ci-unit">м</span></div>
        <div class="calc-item"><span class="ci-label">Площадь стен</span><span class="ci-value">${wallM2.toFixed(2)}</span><span class="ci-unit">м² (с проёмами)</span></div>
        <div class="calc-item"><span class="ci-label">Чистая площадь стен</span><span class="ci-value">${Math.max(0,wallM2-openingsArea).toFixed(2)}</span><span class="ci-unit">м² (минус проёмы)</span></div>
        <div class="calc-item"><span class="ci-label">Дверей</span><span class="ci-value">${doors}</span><span class="ci-unit">шт</span></div>
        <div class="calc-item"><span class="ci-label">Окон</span><span class="ci-value">${windows}</span><span class="ci-unit">шт</span></div>
      </div>
    </div>

    <div class="calc-section">
      <h3>Напольные покрытия</h3>
      <div class="calc-grid">
        <div class="calc-item"><span class="ci-label">Ламинат / паркет (+10% запас)</span><span class="ci-value">${(floorM2*1.1).toFixed(2)}</span><span class="ci-unit">м² = ${Math.ceil(floorM2*1.1/2.13)} уп. по 2.13 м²</span></div>
        <div class="calc-item"><span class="ci-label">Линолеум / ковролин</span><span class="ci-value">${(floorM2*1.05).toFixed(2)}</span><span class="ci-unit">м² (+5%)</span></div>
        <div class="calc-item"><span class="ci-label">Плитка напольная</span><span class="ci-value">${(floorM2*1.1).toFixed(2)}</span><span class="ci-unit">м² (+10%)</span></div>
        <div class="calc-item"><span class="ci-label">Подложка под ламинат</span><span class="ci-value">${floorM2.toFixed(2)}</span><span class="ci-unit">м²</span></div>
      </div>
    </div>

    <div class="calc-section">
      <h3>Стены</h3>
      <div class="calc-grid">
        <div class="calc-item"><span class="ci-label">Обои (рулоны 10×0.53 м)</span><span class="ci-value">${Math.ceil((wallM2-openingsArea)/5.3)}</span><span class="ci-unit">рулонов</span></div>
        <div class="calc-item"><span class="ci-label">Краска (расход 150 г/м²)</span><span class="ci-value">${((wallM2-openingsArea)*0.15*2).toFixed(1)}</span><span class="ci-unit">кг (2 слоя)</span></div>
        <div class="calc-item"><span class="ci-label">Штукатурка (2 см)</span><span class="ci-value">${((wallM2-openingsArea)*0.02*1.6).toFixed(1)}</span><span class="ci-unit">м³ / ${Math.ceil((wallM2-openingsArea)*0.02*1700)} кг</span></div>
        <div class="calc-item"><span class="ci-label">Грунтовка</span><span class="ci-value">${((wallM2-openingsArea)*0.1).toFixed(1)}</span><span class="ci-unit">л</span></div>
      </div>
    </div>

    <div class="calc-section">
      <h3>Потолок</h3>
      <div class="calc-grid">
        <div class="calc-item"><span class="ci-label">Площадь потолка</span><span class="ci-value">${floorM2.toFixed(2)}</span><span class="ci-unit">м²</span></div>
        <div class="calc-item"><span class="ci-label">Краска потолка (2 слоя)</span><span class="ci-value">${(floorM2*0.15*2).toFixed(1)}</span><span class="ci-unit">кг</span></div>
        <div class="calc-item"><span class="ci-label">Натяжной потолок</span><span class="ci-value">${floorM2.toFixed(2)}</span><span class="ci-unit">м²</span></div>
        <div class="calc-item"><span class="ci-label">Грунтовка потолка</span><span class="ci-value">${(floorM2*0.1).toFixed(1)}</span><span class="ci-unit">л</span></div>
      </div>
    </div>

    <div class="calc-section">
      <h3>Прочее</h3>
      <div class="calc-grid">
        <div class="calc-item"><span class="ci-label">Плинтус напольный</span><span class="ci-value">${perimM.toFixed(2)}</span><span class="ci-unit">м = ${Math.ceil(perimM/2.5)} шт по 2.5 м</span></div>
        <div class="calc-item"><span class="ci-label">Плинтус потолочный (галтель)</span><span class="ci-value">${perimM.toFixed(2)}</span><span class="ci-unit">м</span></div>
        <div class="calc-item"><span class="ci-label">Кабель-канал</span><span class="ci-value">${perimM.toFixed(2)}</span><span class="ci-unit">м</span></div>
        <div class="calc-item"><span class="ci-label">Розеток / выключателей</span><span class="ci-value">${S.symbols.filter(s=>s.kind==='outlet').length}</span><span class="ci-unit">шт (по плану)</span></div>
        <div class="calc-item"><span class="ci-label">Светильников</span><span class="ci-value">${S.symbols.filter(s=>s.kind==='light').length}</span><span class="ci-unit">шт (по плану)</span></div>
        <div class="calc-item"><span class="ci-label">Мебели</span><span class="ci-value">${S.furniture.length}</span><span class="ci-unit">шт (по плану)</span></div>
      </div>
    </div>

    <div class="btn-row">
      <button class="ghost-btn" data-close="modalCalc">Закрыть</button>
      <button class="primary-btn" id="btnCalcPrint">Печать / PDF</button>
    </div>
  `;
  $('#modalCalc').hidden = false;
  $('#btnCalcPrint').addEventListener('click', () => {
    const w = window.open('', '_blank');
    w.document.write('<html><head><title>Расчёт материалов — ' + escapeHtml(S.planName) + '</title><style>body{font-family:Inter,Arial,sans-serif;padding:30px;color:#222}h2{color:#c2410c}h3{color:#9a3412;border-bottom:1px solid #eee;padding-bottom:4px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}.item{background:#f5f5f0;padding:8px 10px;border-radius:4px}.lbl{font-size:11px;color:#666}.val{font-size:16px;font-weight:700}.unit{font-size:11px;color:#888}.note{background:#fff7ed;border-left:3px solid #f59e0b;padding:10px;margin-bottom:20px;font-size:12px}</style></head><body>');
    w.document.write('<h2>Расчёт материалов</h2>');
    w.document.write('<p>Проект: <b>' + escapeHtml(S.planName) + '</b> · ' + new Date().toLocaleDateString('ru-RU') + '</p>');
    w.document.write(body.innerHTML.replace(/<button[^>]*>.*?<\/button>/g, '').replace(/<h3>/g, '<h3>').replace(/calc-/g, ''));
    w.document.write('</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 300);
  });
  // re-bind close after innerHTML rewrite
  body.querySelector('[data-close="modalCalc"]').addEventListener('click', () => $('#modalCalc').hidden = true);
}

/* ============================================================
 * TEMPLATES — preset apartment / house layouts
 * ============================================================ */
const TEMPLATES = [
  {
    name: 'Студия 28 м²', desc: 'однокомнатная студия',
    icon: '<rect x="3" y="3" width="34" height="24" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 18h18M21 3v15" stroke="currentColor" stroke-width="1.5"/>',
    build() {
      const W = 600, H = 470;
      return {
        walls: [
          { id: uid(), a: {x:0,y:0}, b:{x:W,y:0}, thickness:15, color:'#3b3a38' },
          { id: uid(), a: {x:W,y:0}, b:{x:W,y:H}, thickness:15, color:'#3b3a38' },
          { id: uid(), a: {x:W,y:H}, b:{x:0,y:H}, thickness:15, color:'#3b3a38' },
          { id: uid(), a: {x:0,y:H}, b:{x:0,y:0}, thickness:15, color:'#3b3a38' },
          { id: uid(), a: {x:0,y:300}, b:{x:250,y:300}, thickness:10, color:'#3b3a38' },
          { id: uid(), a: {x:250,y:300}, b:{x:250,y:H}, thickness:10, color:'#3b3a38' },
        ],
        openings: [
          { id: uid(), wallId: null, t:0.5, kind:'door', width:80, flip:false },
          { id: uid(), wallId: null, t:0.5, kind:'window', width:150, flip:false },
          { id: uid(), wallId: null, t:0.7, kind:'window', width:120, flip:false },
        ],
        rooms: [
          { id: uid(), name:'Студия', points:[{x:0,y:0},{x:W,y:0},{x:W,y:300},{x:0,y:300}], color:'rgba(245,158,11,0.10)' },
          { id: uid(), name:'Санузел', points:[{x:0,y:300},{x:250,y:300},{x:250,y:H},{x:0,y:H}], color:'rgba(59,130,246,0.10)' },
          { id: uid(), name:'Прихожая', points:[{x:250,y:300},{x:W,y:300},{x:W,y:H},{x:250,y:H}], color:'rgba(34,197,94,0.10)' },
        ],
        furniture: [], texts: [], measures: [], symbols: [],
      };
    }
  },
  {
    name: '1-комн. квартира 40 м²', desc: 'отдельная спальня',
    icon: '<rect x="3" y="3" width="34" height="24" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h22M25 3v21" stroke="currentColor" stroke-width="1.5"/>',
    build() {
      const W = 700, H = 570;
      return {
        walls: [
          { id: uid(), a:{x:0,y:0}, b:{x:W,y:0}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:W,y:0}, b:{x:W,y:H}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:W,y:H}, b:{x:0,y:H}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:0,y:H}, b:{x:0,y:0}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:400,y:0}, b:{x:400,y:300}, thickness:10, color:'#3b3a38' },
          { id: uid(), a:{x:0,y:300}, b:{x:250,y:300}, thickness:10, color:'#3b3a38' },
          { id: uid(), a:{x:250,y:300}, b:{x:250,y:H}, thickness:10, color:'#3b3a38' },
          { id: uid(), a:{x:400,y:300}, b:{x:W,y:300}, thickness:10, color:'#3b3a38' },
        ],
        openings: [], rooms: [
          { id: uid(), name:'Гостиная', points:[{x:0,y:0},{x:400,y:0},{x:400,y:300},{x:0,y:300}], color:'rgba(245,158,11,0.10)' },
          { id: uid(), name:'Спальня', points:[{x:400,y:0},{x:W,y:0},{x:W,y:300},{x:400,y:300}], color:'rgba(168,85,247,0.10)' },
          { id: uid(), name:'Кухня', points:[{x:400,y:300},{x:W,y:300},{x:W,y:H},{x:400,y:H}], color:'rgba(239,68,68,0.10)' },
          { id: uid(), name:'Санузел', points:[{x:0,y:300},{x:250,y:300},{x:250,y:H},{x:0,y:H}], color:'rgba(59,130,246,0.10)' },
          { id: uid(), name:'Прихожая', points:[{x:250,y:300},{x:400,y:300},{x:400,y:H},{x:250,y:H}], color:'rgba(34,197,94,0.10)' },
        ],
        furniture: [], texts: [], measures: [], symbols: [],
      };
    }
  },
  {
    name: '2-комн. квартира 60 м²', desc: 'две спальни',
    icon: '<rect x="3" y="3" width="34" height="24" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h34M20 3v9M20 21h17" stroke="currentColor" stroke-width="1.5"/>',
    build() {
      const W = 800, H = 750;
      return {
        walls: [
          { id: uid(), a:{x:0,y:0}, b:{x:W,y:0}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:W,y:0}, b:{x:W,y:H}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:W,y:H}, b:{x:0,y:H}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:0,y:H}, b:{x:0,y:0}, thickness:15, color:'#3b3a38' },
          { id: uid(), a:{x:300,y:0}, b:{x:300,y:380}, thickness:10, color:'#3b3a38' },
          { id: uid(), a:{x:550,y:0}, b:{x:550,y:380}, thickness:10, color:'#3b3a38' },
          { id: uid(), a:{x:0,y:380}, b:{x:W,y:380}, thickness:10, color:'#3b3a38' },
          { id: uid(), a:{x:300,y:380}, b:{x:300,y:H}, thickness:10, color:'#3b3a38' },
        ],
        openings: [], rooms: [
          { id: uid(), name:'Спальня 1', points:[{x:0,y:0},{x:300,y:0},{x:300,y:380},{x:0,y:380}], color:'rgba(168,85,247,0.10)' },
          { id: uid(), name:'Спальня 2', points:[{x:300,y:0},{x:550,y:0},{x:550,y:380},{x:300,y:380}], color:'rgba(217,70,239,0.10)' },
          { id: uid(), name:'Гостиная', points:[{x:550,y:0},{x:W,y:0},{x:W,y:380},{x:550,y:380}], color:'rgba(245,158,11,0.10)' },
          { id: uid(), name:'Кухня', points:[{x:550,y:380},{x:W,y:380},{x:W,y:H},{x:550,y:H}], color:'rgba(239,68,68,0.10)' },
          { id: uid(), name:'Санузел', points:[{x:0,y:380},{x:300,y:380},{x:300,y:H},{x:0,y:H}], color:'rgba(59,130,246,0.10)' },
          { id: uid(), name:'Коридор', points:[{x:300,y:380},{x:550,y:380},{x:550,y:H},{x:300,y:H}], color:'rgba(34,197,94,0.10)' },
        ],
        furniture: [], texts: [], measures: [], symbols: [],
      };
    }
  },
  {
    name: 'Дом 100 м²', desc: 'одноэтажный',
    icon: '<path d="M5 27V15L20 5l15 10v12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 27v-8h6v8" stroke="currentColor" stroke-width="1.5"/>',
    build() {
      const W = 1000, H = 1000;
      return {
        walls: [
          { id: uid(), a:{x:0,y:0}, b:{x:W,y:0}, thickness:20, color:'#3b3a38' },
          { id: uid(), a:{x:W,y:0}, b:{x:W,y:H}, thickness:20, color:'#3b3a38' },
          { id: uid(), a:{x:W,y:H}, b:{x:0,y:H}, thickness:20, color:'#3b3a38' },
          { id: uid(), a:{x:0,y:H}, b:{x:0,y:0}, thickness:20, color:'#3b3a38' },
          { id: uid(), a:{x:500,y:0}, b:{x:500,y:500}, thickness:12, color:'#3b3a38' },
          { id: uid(), a:{x:0,y:500}, b:{x:W,y:500}, thickness:12, color:'#3b3a38' },
          { id: uid(), a:{x:700,y:500}, b:{x:700,y:H}, thickness:12, color:'#3b3a38' },
          { id: uid(), a:{x:300,y:500}, b:{x:300,y:800}, thickness:12, color:'#3b3a38' },
          { id: uid(), a:{x:300,y:800}, b:{x:700,y:800}, thickness:12, color:'#3b3a38' },
        ],
        openings: [], rooms: [
          { id: uid(), name:'Гостиная', points:[{x:0,y:0},{x:500,y:0},{x:500,y:500},{x:0,y:500}], color:'rgba(245,158,11,0.10)' },
          { id: uid(), name:'Кухня-столовая', points:[{x:500,y:0},{x:W,y:0},{x:W,y:500},{x:500,y:500}], color:'rgba(239,68,68,0.10)' },
          { id: uid(), name:'Спальня 1', points:[{x:0,y:500},{x:300,y:500},{x:300,y:800},{x:0,y:800}], color:'rgba(168,85,247,0.10)' },
          { id: uid(), name:'Спальня 2', points:[{x:0,y:800},{x:300,y:800},{x:300,y:H},{x:0,y:H}], color:'rgba(217,70,239,0.10)' },
          { id: uid(), name:'Санузел', points:[{x:300,y:500},{x:700,y:500},{x:700,y:800},{x:300,y:800}], color:'rgba(59,130,246,0.10)' },
          { id: uid(), name:'Холл', points:[{x:300,y:800},{x:700,y:800},{x:700,y:H},{x:300,y:H}], color:'rgba(34,197,94,0.10)' },
          { id: uid(), name:'Кабинет', points:[{x:700,y:500},{x:W,y:500},{x:W,y:H},{x:700,y:H}], color:'rgba(20,184,166,0.10)' },
        ],
        furniture: [], texts: [], measures: [], symbols: [],
      };
    }
  },
  {
    name: 'Пустой холст', desc: 'начать с нуля',
    icon: '<rect x="5" y="5" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"/>',
    build() { return { walls:[], openings:[], rooms:[], furniture:[], texts:[], measures:[], symbols:[] }; }
  },
];

function openTemplates() {
  const grid = $('#templatesGrid');
  grid.innerHTML = '';
  TEMPLATES.forEach(tpl => {
    const card = document.createElement('div');
    card.className = 'template-card';
    card.innerHTML = `<div class="tc-icon"><svg viewBox="0 0 40 40">${tpl.icon}</svg></div><div class="tc-name">${tpl.name}</div><div class="tc-desc">${tpl.desc}</div>`;
    card.addEventListener('click', () => {
      const data = tpl.build();
      // re-link openings to walls by sequential order for templates with walls
      if (data.openings.length && data.walls.length) {
        data.openings.forEach((o, i) => {
          if (i === 0 && data.walls[1]) o.wallId = data.walls[1].id; // right wall door
          else if (i === 1 && data.walls[0]) o.wallId = data.walls[0].id; // top window
          else if (i === 2 && data.walls[2]) o.wallId = data.walls[2].id; // bottom window
          else if (data.walls[i % data.walls.length]) o.wallId = data.walls[i % data.walls.length].id;
        });
      }
      restore(data);
      S.history = []; S.histIdx = -1; pushHistory();
      S.planId = null; S.planName = tpl.name;
      $('#planName').value = S.planName;
      S.pan = { x: Wcenter(data), y: Hcenter(data) };
      zoomFit();
      $('#modalTemplates').hidden = true;
      toast('Загружен шаблон: ' + tpl.name, 'success');
    });
    grid.appendChild(card);
  });
  $('#modalTemplates').hidden = false;
}
function Wcenter(data) {
  if (!data.walls.length) return 0;
  let minX=Infinity,maxX=-Infinity;
  data.walls.forEach(w=>{minX=Math.min(minX,w.a.x,w.b.x);maxX=Math.max(maxX,w.a.x,w.b.x);});
  return (minX+maxX)/2;
}
function Hcenter(data) {
  if (!data.walls.length) return 0;
  let minY=Infinity,maxY=-Infinity;
  data.walls.forEach(w=>{minY=Math.min(minY,w.a.y,w.b.y);maxY=Math.max(maxY,w.a.y,w.b.y);});
  return (minY+maxY)/2;
}

/* ============================================================
 * TOAST
 * ============================================================ */
function toast(msg, type) {
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg;
  $('#toastContainer').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(8px)'; setTimeout(() => t.remove(), 250); }, 2600);
}

/* ============================================================
 * BOOT
 * ============================================================ */
window.addEventListener('DOMContentLoaded', init);

})();
