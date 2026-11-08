// Pantalla de recorte (una ventana por monitor), estilo Flameshot:
// 1) se arrastra para elegir una zona (o clic = pantalla completa)
// 2) aparece una barra con herramientas para dibujar y acciones (Lens, copiar, guardar…)
'use strict';
const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const ID = params.get('id');
// Tamaño real de la captura: la imagen ocupa toda la ventana, así que la escala se calcula con el
// tamaño actual de la ventana (aunque Windows la haya achicado, el recorte sale exacto).
const IW = Number(params.get('iw')) || 1;
const IH = Number(params.get('ih')) || 1;
const kx = () => IW / window.innerWidth;
const ky = () => IH / window.innerHeight;
$('#shot').src = `nv://capture/?id=${encodeURIComponent(ID)}`;

// ------------------------------------------------------------------ Íconos
const ICONS = {
  select: '<path d="M4 4l7 17 2.5-7.5L21 11z"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  marker: '<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  arrow: '<path d="M5 19L19 5M9 5h10v10"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  lens: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  tabs: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
};
document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin',
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[el.dataset.icon] || ''}</svg>`));

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#111827', '#ffffff'];
const S = {
  sel: null,          // zona elegida, en px de pantalla { x, y, width, height }
  tool: 'select',
  color: COLORS[0],
  marks: [],          // dibujos, en coordenadas relativas a la zona
  drag: null,         // arrastre en curso
  textBox: null,      // caja de texto abierta
  done: false,
};

// ------------------------------------------------------------------ Selección
const inside = (p, r) => r && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
function rectFrom(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function layoutSel() {
  const r = S.sel; const el = $('#sel');
  el.hidden = false;
  Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  const dpr = window.devicePixelRatio || 1;
  const c = $('#ink');
  c.width = Math.max(1, Math.round(r.width * dpr)); c.height = Math.max(1, Math.round(r.height * dpr));
  $('#size').textContent = `${Math.round(r.width * kx())} × ${Math.round(r.height * ky())}`;
  $('#size').style.top = r.y < 30 ? '4px' : '-26px';
  document.body.classList.add('has-sel');
  redraw();
}

// ------------------------------------------------------------------ Dibujos
function drawMark(g, m) {
  g.save();
  g.strokeStyle = m.color; g.fillStyle = m.color;
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (m.tool === 'pen' || m.tool === 'marker') {
    if (m.tool === 'marker') { g.globalAlpha = 0.38; g.lineWidth = 16; } else g.lineWidth = 3;
    g.beginPath();
    m.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    if (m.pts.length === 1) g.lineTo(m.pts[0].x + 0.1, m.pts[0].y);
    g.stroke();
  } else if (m.tool === 'rect') {
    g.lineWidth = 3;
    g.strokeRect(Math.min(m.x1, m.x2), Math.min(m.y1, m.y2), Math.abs(m.x2 - m.x1), Math.abs(m.y2 - m.y1));
  } else if (m.tool === 'arrow') {
    g.lineWidth = 3.5;
    const a = Math.atan2(m.y2 - m.y1, m.x2 - m.x1); const h = 16;
    g.beginPath(); g.moveTo(m.x1, m.y1); g.lineTo(m.x2, m.y2); g.stroke();
    g.beginPath();
    g.moveTo(m.x2, m.y2);
    g.lineTo(m.x2 - h * Math.cos(a - 0.45), m.y2 - h * Math.sin(a - 0.45));
    g.lineTo(m.x2 - h * Math.cos(a + 0.45), m.y2 - h * Math.sin(a + 0.45));
    g.closePath(); g.fill();
  } else if (m.tool === 'text') {
    g.font = 'bold 20px "Segoe UI", sans-serif'; g.textBaseline = 'top';
    const light = ['#ffffff', '#f59e0b', '#22c55e'].includes(m.color);
    g.strokeStyle = light ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.9)'; g.lineWidth = 4;
    m.text.split('\n').forEach((line, i) => {
      g.strokeText(line, m.x, m.y + i * 26);
      g.fillText(line, m.x, m.y + i * 26);
    });
  }
  g.restore();
}

function redraw() {
  if (!S.sel) return;
  const c = $('#ink'); const g = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, S.sel.width, S.sel.height);
  for (const m of S.marks) drawMark(g, m);
  if (S.drag?.mark) drawMark(g, S.drag.mark);
  $('#undo').disabled = S.marks.length === 0;
}

function setTool(t) {
  commitText();
  S.tool = t;
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  document.body.className = document.body.className.replace(/\btool-\w+/g, '').trim();
  document.body.classList.add(`tool-${t}`);
}

function setColor(c) {
  S.color = c;
  document.querySelectorAll('.color').forEach((b) => b.classList.toggle('active', b.dataset.color === c));
  if (S.textBox) S.textBox.style.color = c;
}
for (const c of COLORS) {
  const b = document.createElement('button');
  b.className = 'color'; b.dataset.color = c; b.style.background = c; b.title = 'Color';
  b.addEventListener('click', () => setColor(c));
  $('#colors').append(b);
}

function undo() { commitText(); S.marks.pop(); redraw(); }

// Nota de texto: se escribe en una caja y se "pega" sobre la imagen al terminar
function openText(p) {
  commitText();
  const t = document.createElement('textarea');
  t.className = 'textbox'; t.rows = 1; t.spellcheck = false;
  Object.assign(t.style, { left: `${p.x}px`, top: `${p.y}px`, color: S.color });
  t.dataset.x = p.x - S.sel.x; t.dataset.y = p.y - S.sel.y;
  t.addEventListener('input', () => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; t.style.width = 'auto'; t.style.width = `${Math.max(120, t.scrollWidth + 4)}px`; });
  t.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
    if (e.key === 'Escape') { t.value = ''; commitText(); }
  });
  t.addEventListener('blur', () => setTimeout(commitText, 0));
  document.body.append(t);
  S.textBox = t;
  t.focus();
}
function commitText() {
  const t = S.textBox; if (!t) return;
  S.textBox = null;
  const text = t.value.replace(/\s+$/, '');
  if (text) S.marks.push({ tool: 'text', color: t.style.color || S.color, text, x: Number(t.dataset.x) + 3, y: Number(t.dataset.y) + 1 });
  t.remove();
  redraw();
}

// ------------------------------------------------------------------ Barra
function placeBar() {
  const bar = $('#bar');
  bar.hidden = false;
  const r = S.sel; const b = bar.getBoundingClientRect();
  const W = window.innerWidth; const H = window.innerHeight; const gap = 10;
  let top = r.y + r.height + gap;
  if (top + b.height > H - gap) top = r.y - b.height - gap;                 // arriba de la zona
  if (top < gap) top = Math.min(H - b.height - gap, r.y + r.height - b.height - gap);   // adentro, abajo
  const left = Math.max(gap, Math.min(W - b.width - gap, r.x + r.width - b.width));
  Object.assign(bar.style, { top: `${Math.max(gap, top)}px`, left: `${left}px` });
}
function hideBar() { $('#bar').hidden = true; closeTabMenu(); }

async function openTabMenu() {
  const menu = $('#tabmenu');
  const tabs = await window.nvCapture.tabs();
  menu.textContent = '';
  if (!tabs.length) {
    const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'No tabs yet'; menu.append(d);
  }
  for (const name of tabs) {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => doAction('tab', name));
    menu.append(b);
  }
  menu.hidden = false;
  // Debajo de la barra (o arriba si no entra), alineado con el botón "Save to tab…"
  const btn = document.querySelector('[data-action="tab"]').getBoundingClientRect();
  const bar = $('#bar').getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const top = bar.bottom + 6 + m.height < window.innerHeight - 8 ? bar.bottom + 6 : Math.max(8, bar.top - m.height - 6);
  Object.assign(menu.style, { left: `${Math.max(8, Math.min(window.innerWidth - m.width - 8, btn.left))}px`, top: `${top}px` });
}
function closeTabMenu() { $('#tabmenu').hidden = true; }

// ------------------------------------------------------------------ Acciones
// Sin dibujos: el recorte lo hace NVTabs desde la captura original. Con dibujos: se arma la
// imagen final acá (recorte sin pérdida + dibujos) y se envía como PNG.
async function compose(rect) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = `nv://capture/crop?id=${encodeURIComponent(ID)}&x=${rect.x}&y=${rect.y}&w=${rect.width}&h=${rect.height}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.scale(c.width / S.sel.width, c.height / S.sel.height);
  for (const m of S.marks) drawMark(g, m);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

async function doAction(action, tab) {
  if (S.done || !S.sel) return;
  if (action === 'cancel') { S.done = true; window.nvCapture.cancel(); return; }
  if (action === 'tab' && !tab) { if ($('#tabmenu').hidden) openTabMenu(); else closeTabMenu(); return; }
  commitText();
  S.done = true;
  document.body.classList.add('busy');
  const r = S.sel;
  const rect = { x: Math.round(r.x * kx()), y: Math.round(r.y * ky()), width: Math.round(r.width * kx()), height: Math.round(r.height * ky()) };
  const payload = { action, tab };
  try {
    if (S.marks.length) payload.png = await compose(rect); else payload.rect = rect;
  } catch {
    payload.rect = rect; delete payload.png;   // si fallara el dibujo, al menos se guarda el recorte
  }
  await window.nvCapture.action(payload);
}

document.querySelectorAll('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#undo').addEventListener('click', undo);
document.querySelectorAll('.act').forEach((b) => b.addEventListener('click', () => doAction(b.dataset.action)));

// ------------------------------------------------------------------ Mouse
const point = (e) => ({ x: e.clientX, y: e.clientY });
const local = (p) => ({ x: p.x - S.sel.x, y: p.y - S.sel.y });
const onUi = (e) => e.target.closest?.('#bar, #tabmenu, .textbox');

window.addEventListener('mousedown', (e) => {
  if (S.done || e.button !== 0 || onUi(e)) return;
  closeTabMenu();
  if (S.textBox) { commitText(); return; }
  const p = point(e);
  if (S.sel && S.tool !== 'select') {
    if (!inside(p, S.sel)) return;
    if (S.tool === 'text') { openText(p); e.preventDefault(); return; }
    const q = local(p);
    S.drag = { mark: S.tool === 'pen' || S.tool === 'marker'
      ? { tool: S.tool, color: S.color, pts: [q] }
      : { tool: S.tool, color: S.color, x1: q.x, y1: q.y, x2: q.x, y2: q.y } };
    return;
  }
  // Herramienta "select": elegir (o volver a elegir) la zona
  S.drag = { start: p, prev: S.sel, moved: false };
});

window.addEventListener('mousemove', (e) => {
  if (!S.drag) return;
  const p = point(e);
  if (S.drag.start) {
    if (!S.drag.moved && Math.hypot(p.x - S.drag.start.x, p.y - S.drag.start.y) < 4) return;
    S.drag.moved = true;
    S.sel = rectFrom(S.drag.start, p);
    S.marks = [];
    hideBar();
    layoutSel();
  } else if (S.drag.mark) {
    const q = local(p); const m = S.drag.mark;
    if (m.pts) m.pts.push(q); else { m.x2 = q.x; m.y2 = q.y; }
    redraw();
  }
});

window.addEventListener('mouseup', (e) => {
  if (!S.drag || e.button !== 0) return;
  const d = S.drag; S.drag = null;
  if (d.start) {
    const r = rectFrom(d.start, point(e));
    const tiny = !d.moved || r.width < 4 || r.height < 4;
    if (tiny && d.prev) return;   // clic sin arrastrar con una zona ya elegida: no cambia nada
    S.sel = tiny ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } : r;   // primer clic = pantalla completa
    S.marks = [];
    layoutSel();
    placeBar();
    setTool(S.tool);
  } else if (d.mark) {
    S.marks.push(d.mark);
    redraw();
  }
});

window.addEventListener('dblclick', (e) => {
  if (S.sel && S.tool === 'select' && inside(point(e), S.sel) && !onUi(e)) doAction('unsorted');
});

window.addEventListener('contextmenu', (e) => e.preventDefault());

// ------------------------------------------------------------------ Teclado
window.addEventListener('keydown', (e) => {
  if (S.done) return;
  const ctrl = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
  if (e.key === 'Escape') {
    if (!$('#tabmenu').hidden) closeTabMenu(); else doActionCancel();
    return;
  }
  if (!S.sel || S.drag) return;
  if (e.key === 'Enter') doAction('unsorted');
  else if (ctrl && k === 'c') doAction('copy');
  else if (ctrl && k === 's') { e.preventDefault(); doAction('saveas'); }
  else if (ctrl && k === 'z') undo();
  else if (!ctrl) {
    const tools = { v: 'select', p: 'pen', h: 'marker', a: 'arrow', r: 'rect', t: 'text' };
    if (tools[k]) setTool(tools[k]);
  }
});
function doActionCancel() { S.done = true; window.nvCapture.cancel(); }

setTool('select');
setColor(COLORS[0]);

// Para las pruebas automáticas
window.__test = {
  select: (r) => { S.sel = r; layoutSel(); placeBar(); },
  tool: setTool,
  color: setColor,
  mark: (m) => { S.marks.push(m); redraw(); },
  action: (a, tab) => doAction(a, tab),
  openTabs: () => openTabMenu(),
  state: () => ({ sel: S.sel, marks: S.marks.length, tool: S.tool, bar: !$('#bar').hidden }),
};
