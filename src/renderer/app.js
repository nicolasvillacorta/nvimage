// NVTabs - interfaz
'use strict';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));

const $ = (s) => document.querySelector(s);
// `nv` es el puente global expuesto por preload.js

// ------------------------------------------------------------------ Íconos
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M9 6V4h6v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.6"/><path d="M21 15l-5-5L5 21"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checks: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8 12.5l3 3 5-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  external: '<path d="M14 3h7v7M10 14L21 3M20 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5"/>',
  small: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
  bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1V6a3 3 0 1 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6.5 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  big: '<rect x="2" y="2" width="20" height="20" rx="3"/>',
  note: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
};
function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}
document.querySelectorAll('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

// ------------------------------------------------------------------ Estado
const S = {
  tabs: [],            // [{name, count}]
  current: null,       // nombre de la pestaña activa
  photos: [],          // [{name, path, v}]
  selected: new Set(), // rutas
  anchor: -1,          // para Shift+clic
  viewer: -1,          // índice abierto en el visor (-1 = cerrado)
  theme: 'system',     // system | light | dark
  busy: false,
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const photoUrl = (kind, p) => `nv://${kind}/?p=${encodeURIComponent(p.path)}&v=${p.v}`;

// ------------------------------------------------------------------ Avisos
let toastTimer = null;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.hidden = false;
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 5000 : 3000);
}
async function guard(fn) {
  try { return await fn(); } catch (e) { toast(e.message || String(e), true); return undefined; }
}

function describeCount(images, notes) {
  const parts = [];
  if (images) parts.push(plural(images, 'photo', 'photos'));
  if (notes) parts.push(plural(notes, 'note', 'notes'));
  return parts.join(' and ');
}

function reportAdd(r, tab) {
  if (!r || r.canceled) return;
  if (r.empty) { toast('The clipboard has no images, files or text.'); return; }
  if (r.found === 0) { toast('No supported files found (images or text files like .txt and .md).', true); return; }
  let msg = r.added ? `Added ${describeCount(r.images ?? r.added, r.notes ?? 0)} to "${tab}"` : 'Nothing was added';
  if (r.failed.length) msg += ` · ${r.failed.length} could not be copied`;
  toast(msg, r.added === 0);
}

// ------------------------------------------------------------------ Pestañas
function renderTabs() {
  const box = $('#tabs');
  box.textContent = '';
  for (const t of S.tabs) {
    const b = document.createElement('button');
    b.className = 'tab' + (t.name === S.current ? ' active' : '');
    b.draggable = true;
    b.dataset.name = t.name;
    b.title = t.name;
    b.setAttribute('role', 'tab');
    const label = document.createElement('span'); label.className = 'label'; label.textContent = t.name;
    const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = t.count;
    b.append(label, badge);
    box.append(b);
  }
  box.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const none = S.tabs.length === 0;
  $('#noTabs').hidden = !none;
  if (none) { $('#empty').hidden = true; $('#grid').textContent = ''; }
  document.querySelector('.toolbar').style.visibility = none ? 'hidden' : '';
}

async function refreshTabs() {
  S.tabs = await nv.tabs();
  if (S.current && !S.tabs.some((t) => t.name === S.current)) S.current = null;
  renderTabs();
}

async function selectTab(name) {
  if (!name) return;
  closeViewer();
  if (name !== S.current) { S.selected.clear(); S.anchor = -1; $('#main').scrollTop = 0; }
  S.current = name;
  renderTabs();
  nv.selectTab(name);
  document.title = `${name} - NVTabs`;
  await loadPhotos(true);
}

function startTabEdit(el, initial, onCommit) {
  const input = document.createElement('input');
  input.value = initial;
  input.spellcheck = false;
  el.textContent = '';
  el.draggable = false;
  el.append(input);
  input.focus(); input.select();
  let done = false;
  const finish = async (commit) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (commit && v && v !== initial) {
      const ok = await guard(() => onCommit(v));
      if (ok === undefined) { await refreshTabs(); return; }
    } else if (commit && v && initial === '') {
      await guard(() => onCommit(v));
    }
    await refreshTabs();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

function newTab() {
  const box = $('#tabs');
  const el = document.createElement('div');
  el.className = 'tab active';
  box.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  box.append(el);
  el.scrollIntoView({ inline: 'nearest' });
  startTabEdit(el, '', async (name) => {
    const created = await nv.createTab(name);
    S.tabs = await nv.tabs();
    await selectTab(created);
    toast(`Tab "${created}" created`);
    return created;
  });
}

function renameTab(name = S.current) {
  const el = [...document.querySelectorAll('.tab')].find((t) => t.dataset.name === name);
  if (!el) return;
  startTabEdit(el, name, async (v) => {
    const newName = await nv.renameTab(name, v);
    if (S.current === name) S.current = newName;
    S.selected.clear();
    await refreshTabs();
    if (S.current === newName) await selectTab(newName);
    return newName;
  });
}

async function deleteTab(name = S.current) {
  const idx = S.tabs.findIndex((t) => t.name === name);
  const ok = await guard(() => nv.deleteTab(name));
  if (!ok) return;
  toast(`Tab "${name}" moved to the Recycle Bin`);
  await refreshTabs();
  if (!S.current || S.current === name) {
    const next = S.tabs[Math.min(idx, S.tabs.length - 1)];
    S.current = null;
    if (next) await selectTab(next.name); else renderTabs();
  }
}

async function moveTab(name, delta) {
  const i = S.tabs.findIndex((t) => t.name === name);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= S.tabs.length) return;
  const [t] = S.tabs.splice(i, 1);
  S.tabs.splice(j, 0, t);
  renderTabs();
  await nv.reorderTabs(S.tabs.map((x) => x.name));
}

async function tabMenu(name) {
  const i = S.tabs.findIndex((t) => t.name === name);
  const choice = await nv.menu([
    { id: 'rename', label: 'Rename' },
    { id: 'folder', label: 'Open folder' },
    '-',
    { id: 'left', label: 'Move left', enabled: i > 0 },
    { id: 'right', label: 'Move right', enabled: i < S.tabs.length - 1 },
    '-',
    { id: 'delete', label: 'Delete tab…' },
  ]);
  if (choice === 'rename') { if (name !== S.current) await selectTab(name); renameTab(name); }
  if (choice === 'folder') guard(() => nv.openTabFolder(name));
  if (choice === 'left') moveTab(name, -1);
  if (choice === 'right') moveTab(name, 1);
  if (choice === 'delete') deleteTab(name);
}

// Eventos de la barra de pestañas
const tabsBox = $('#tabs');
const tabFrom = (e) => e.target.closest('.tab[data-name]');
tabsBox.addEventListener('click', (e) => { const t = tabFrom(e); if (t) selectTab(t.dataset.name); });
tabsBox.addEventListener('dblclick', (e) => { const t = tabFrom(e); if (t) renameTab(t.dataset.name); });
tabsBox.addEventListener('contextmenu', (e) => { const t = tabFrom(e); if (t) { e.preventDefault(); tabMenu(t.dataset.name); } });
tabsBox.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
tabsBox.addEventListener('wheel', (e) => { tabsBox.scrollLeft += e.deltaY; }, { passive: true });
$('#addTab').addEventListener('click', newTab);

// Reordenar arrastrando + soltar archivos sobre una pestaña
let dragTab = null;
let dragItems = null;   // rutas de fotos/notas que se están arrastrando desde la grilla
function endItemDrag() {
  dragItems = null;
  document.body.classList.remove('dragging-items');
  clearTabMarks();
}
const isFileDrag = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
function clearTabMarks() {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('insert-before', 'insert-after', 'file-target'));
}
tabsBox.addEventListener('dragstart', (e) => {
  const t = tabFrom(e); if (!t) return;
  dragTab = t.dataset.name;
  t.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-nv-tab', dragTab);
});
tabsBox.addEventListener('dragend', () => { dragTab = null; clearTabMarks(); document.querySelectorAll('.tab.dragging').forEach((t) => t.classList.remove('dragging')); });
tabsBox.addEventListener('dragover', (e) => {
  const t = tabFrom(e);
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  clearTabMarks();
  if (dragItems) {                       // fotos/notas arrastradas desde la grilla
    if (t.dataset.name === S.current) { e.dataTransfer.dropEffect = 'none'; return; }
    e.dataTransfer.dropEffect = 'move';
    t.classList.add('file-target');
  } else if (isFileDrag(e)) {
    e.dataTransfer.dropEffect = 'copy';
    t.classList.add('file-target');
    hideDrop();
  } else if (dragTab && t.dataset.name !== dragTab) {
    e.dataTransfer.dropEffect = 'move';
    const r = t.getBoundingClientRect();
    t.classList.add(e.clientX < r.left + r.width / 2 ? 'insert-before' : 'insert-after');
  }
});
tabsBox.addEventListener('dragleave', (e) => { const t = tabFrom(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('file-target', 'insert-before', 'insert-after'); });
tabsBox.addEventListener('drop', async (e) => {
  const t = tabFrom(e);
  e.preventDefault(); e.stopPropagation();
  clearTabMarks(); hideDrop();
  if (!t) return;
  const target = t.dataset.name;
  if (dragItems) {
    const paths = dragItems; endItemDrag();
    await moveItems(paths, target);
  } else if (isFileDrag(e)) {
    const paths = [...e.dataTransfer.files].map((f) => nv.pathForFile(f)).filter(Boolean);
    const r = await guard(() => nv.addPhotos(target, paths));
    reportAdd(r, target);
    await refreshTabs();
    await selectTab(target);
  } else if (dragTab && target !== dragTab) {
    const r = t.getBoundingClientRect();
    const after = e.clientX >= r.left + r.width / 2;
    const names = S.tabs.map((x) => x.name).filter((n) => n !== dragTab);
    names.splice(names.indexOf(target) + (after ? 1 : 0), 0, dragTab);
    S.tabs = names.map((n) => S.tabs.find((x) => x.name === n));
    renderTabs();
    await nv.reorderTabs(names);
  }
});

// ------------------------------------------------------------------ Fotos
function signature(list) { return list.map((p) => `${p.path}|${p.v}`).join('\n'); }

async function loadPhotos(force = false) {
  if (!S.current) return;
  const tab = S.current;
  const list = await guard(() => nv.photos(tab));
  if (!list || tab !== S.current) return;
  const changed = force || signature(list) !== signature(S.photos);
  S.photos = list;
  const valid = new Set(list.map((p) => p.path));
  for (const p of [...S.selected]) if (!valid.has(p)) S.selected.delete(p);
  const t = S.tabs.find((x) => x.name === tab);
  if (t && t.count !== list.length) { t.count = list.length; renderTabs(); }
  if (changed) renderGrid();
  renderToolbar();
}

function renderGrid() {
  const grid = $('#grid');
  grid.textContent = '';
  const frag = document.createDocumentFragment();
  S.photos.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'card' + (p.kind === 'note' ? ' note' : '') + (S.selected.has(p.path) ? ' selected' : '');
    card.dataset.i = i;
    card.draggable = true;   // se puede arrastrar a otra pestaña
    card.title = p.name;
    const th = document.createElement('div'); th.className = 'thumb';
    if (p.kind === 'note') {
      const pre = document.createElement('div'); pre.className = 'note-preview';
      pre.textContent = p.preview || '';
      if (!p.preview) { pre.classList.add('empty-note'); pre.textContent = 'Empty note'; }
      const ext = document.createElement('span'); ext.className = 'note-ext';
      ext.textContent = (p.name.split('.').pop() || 'txt').toUpperCase();
      th.append(pre, ext);
    } else {
      const img = document.createElement('img');
      img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true });
      img.src = photoUrl('thumb', p);
      th.append(img);
    }
    const chk = document.createElement('button');
    chk.className = 'check'; chk.title = 'Select'; chk.innerHTML = icon('check');
    const name = document.createElement('div'); name.className = 'name'; name.textContent = p.name;
    card.append(th, chk, name);
    frag.append(card);
  });
  grid.append(frag);
  $('#empty').hidden = S.photos.length > 0 || !S.current;
  updateSelectionUI();
}

function renderToolbar() {
  $('#title').textContent = S.current || '';
  const notes = S.photos.filter((p) => p.kind === 'note').length;
  const images = S.photos.length - notes;
  $('#count').textContent = !S.current ? '' : (S.photos.length ? describeCount(images, notes) : 'empty');
}

function updateSelectionUI() {
  const n = S.selected.size;
  document.querySelectorAll('.card').forEach((c) => {
    c.classList.toggle('selected', S.selected.has(S.photos[c.dataset.i]?.path));
  });
  $('#grid').classList.toggle('selecting', n > 0);
  $('#selActions').hidden = n === 0;
  $('#selCount').textContent = `${n} selected`;
  const all = n > 0 && n === S.photos.length;
  $('#selectAll').lastChild.textContent = all ? 'None' : 'Select';
}

function toggle(i, on) {
  const p = S.photos[i]; if (!p) return;
  const want = on ?? !S.selected.has(p.path);
  if (want) S.selected.add(p.path); else S.selected.delete(p.path);
  S.anchor = i;
  updateSelectionUI();
}

function selectRange(i) {
  const a = Math.max(0, S.anchor);
  const [from, to] = a < i ? [a, i] : [i, a];
  for (let k = from; k <= to; k++) S.selected.add(S.photos[k].path);
  updateSelectionUI();
}

function selectAll() {
  if (!S.photos.length) return;
  if (S.selected.size === S.photos.length) S.selected.clear();
  else S.photos.forEach((p) => S.selected.add(p.path));
  updateSelectionUI();
}

function clearSelection() { S.selected.clear(); S.anchor = -1; updateSelectionUI(); }

async function deletePaths(paths, ask = true) {
  if (!paths.length) return 0;
  const n = await guard(() => nv.deletePhotos(paths, ask));
  if (n) {
    paths.forEach((p) => S.selected.delete(p));
    toast(`${plural(n, 'item', 'items')} moved to the Recycle Bin`);
    await loadPhotos();
  }
  return n || 0;
}

async function moveItems(paths, tab) {
  if (!paths.length || !tab || tab === S.current) return;
  const r = await guard(() => nv.moveItems(paths, tab));
  if (!r) return;
  paths.forEach((p) => S.selected.delete(p));
  if (r.moved) toast(`Moved ${plural(r.moved, 'item', 'items')} to "${tab}"`);
  if (r.failed.length) toast(`${plural(r.failed.length, 'item', 'items')} could not be moved: ${r.failed.join(', ')}`, true);
  await refreshTabs();
  await loadPhotos();
}

async function addPhotosDialog() {
  if (!S.current) return;
  const tab = S.current;
  const r = await guard(() => nv.pickPhotos(tab));
  reportAdd(r, tab);
  if (r?.added) await loadPhotos();
}

async function paste() {
  if (!S.current) return;
  const tab = S.current;
  const r = await guard(() => nv.pastePhotos(tab));
  if (r?.note) toast(`Created the note "${r.note.name}" from the pasted text`);
  else reportAdd(r, tab);
  if (r?.added) await loadPhotos();
}

async function photoMenu(i) {
  const p = S.photos[i]; if (!p) return;
  const sel = S.selected.has(p.path);
  const many = S.selected.size > 1 && sel;
  const isNote = p.kind === 'note';
  const others = S.tabs.filter((t) => t.name !== S.current);
  const choice = await nv.menu([
    { id: 'view', label: isNote ? 'Open note' : 'View' },
    { id: 'open', label: 'Open with the default app' },
    { id: 'openWith', label: 'Open with…' },
    { id: 'reveal', label: 'Show in folder' },
    { id: 'copy', label: isNote ? 'Copy text' : 'Copy image' },
    '-',
    {
      label: many ? `Move ${S.selected.size} selected to` : 'Move to',
      submenu: others.length ? others.map((t) => ({ id: `move:${t.name}`, label: t.name }))
        : [{ id: 'none', label: 'No other tabs', enabled: false }],
    },
    { id: 'select', label: sel ? 'Deselect' : 'Select' },
    '-',
    { id: 'delete', label: many ? `Delete ${S.selected.size} selected…` : (isNote ? 'Delete note…' : 'Delete photo…') },
  ]);
  if (choice?.startsWith('move:')) moveItems(many ? [...S.selected] : [p.path], choice.slice(5));
  if (choice === 'view') openViewer(i);
  if (choice === 'open') guard(() => nv.openPhoto(p.path));
  if (choice === 'openWith') guard(() => nv.openWith(p.path));
  if (choice === 'reveal') guard(() => nv.revealPhoto(p.path));
  if (choice === 'copy') {
    const ok = await guard(() => (isNote ? nv.copyNote(p.path) : nv.copyPhoto(p.path)));
    if (ok) toast(isNote ? 'Text copied' : 'Image copied');
  }
  if (choice === 'select') toggle(i);
  if (choice === 'delete') deletePaths(many ? [...S.selected] : [p.path]);
}

// Clics en la galería
const grid = $('#grid');
grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  const i = Number(card.dataset.i);
  if (e.target.closest('.check')) { if (e.shiftKey && S.anchor >= 0) selectRange(i); else toggle(i); return; }
  if (e.shiftKey && S.anchor >= 0) { selectRange(i); return; }
  if (e.ctrlKey || S.selected.size > 0) { toggle(i); return; }
  openViewer(i);
});
// Arrastrar fotos/notas hacia otra pestaña (si la arrastrada está seleccionada, van todas las seleccionadas)
grid.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  const p = S.photos[Number(card.dataset.i)]; if (!p) return;
  dragItems = S.selected.has(p.path) ? [...S.selected] : [p.path];
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/x-nv-items', String(dragItems.length));
  document.body.classList.add('dragging-items');
  if (dragItems.length > 1) {
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.textContent = `${dragItems.length} items`;
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, 20, 20);
    setTimeout(() => ghost.remove(), 0);
  }
});
grid.addEventListener('dragend', endItemDrag);

grid.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  e.preventDefault();
  photoMenu(Number(card.dataset.i));
});

// Barra de herramientas
$('#addPhotos').addEventListener('click', addPhotosDialog);
$('#emptyAdd').addEventListener('click', addPhotosDialog);
$('#newNote').addEventListener('click', newNote);
$('#emptyNote').addEventListener('click', newNote);
$('#noTabsAdd').addEventListener('click', newTab);
$('#selectAll').addEventListener('click', selectAll);
$('#clearSel').addEventListener('click', clearSelection);
$('#delSel').addEventListener('click', () => deletePaths([...S.selected]));
$('#openFolder').addEventListener('click', () => S.current && guard(() => nv.openTabFolder(S.current)));

const sizeInput = $('#size');
function applySize(v) { document.documentElement.style.setProperty('--size', `${v}px`); }
sizeInput.addEventListener('input', () => applySize(sizeInput.value));
sizeInput.addEventListener('change', () => nv.setSize(Number(sizeInput.value)));

// ------------------------------------------------------------------ Arrastrar archivos a la ventana
let dragDepth = 0;
function showDrop() { if (!S.current) return; $('#dropName').textContent = S.current; $('#drop').hidden = false; }
function hideDrop() { $('#drop').hidden = true; }
document.addEventListener('dragenter', (e) => { if (!isFileDrag(e)) return; dragDepth++; if (!e.target.closest?.('#tabs')) showDrop(); });
document.addEventListener('dragleave', (e) => { if (!isFileDrag(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) hideDrop(); });
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (isFileDrag(e)) { e.dataTransfer.dropEffect = S.current ? 'copy' : 'none'; if (!e.target.closest?.('#tabs')) { clearTabMarks(); showDrop(); } }
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; hideDrop();
  if (!isFileDrag(e) || !S.current) return;
  const tab = S.current;
  const paths = [...e.dataTransfer.files].map((f) => nv.pathForFile(f)).filter(Boolean);
  const r = await guard(() => nv.addPhotos(tab, paths));
  reportAdd(r, tab);
  if (r?.added) await loadPhotos();
});

// ------------------------------------------------------------------ Visor
// El visor recorre solo las fotos (las notas se abren en el editor)
const vImg = $('#vImg');
const imagesOnly = () => S.photos.filter((p) => p.kind !== 'note');
S.vlist = [];
function openViewer(i) {
  const item = S.photos[i];
  if (!item) return;
  if (item.kind === 'note') { openNote(item); return; }
  S.vlist = imagesOnly();
  S.viewer = S.vlist.indexOf(item);
  $('#viewer').hidden = false;
  nv.viewerMode(true);
  showViewerPhoto();
}
function closeViewer() {
  if (S.viewer < 0) return;
  S.viewer = -1;
  $('#viewer').hidden = true;
  vImg.removeAttribute('src');
  nv.viewerMode(false);
}
function showViewerPhoto() {
  const n = S.vlist.length;
  if (!n) { closeViewer(); return; }
  S.viewer = (S.viewer + n) % n;
  const p = S.vlist[S.viewer];
  vImg.src = photoUrl('full', p);
  $('#vName').textContent = p.name;
  $('#vPos').textContent = `${S.viewer + 1} of ${n}`;
  for (const d of [1, -1]) { const q = S.vlist[(S.viewer + d + n) % n]; if (q) new Image().src = photoUrl('full', q); }
}
const vCurrent = () => S.vlist[S.viewer];
const vStep = (d) => { if (S.viewer >= 0) { S.viewer += d; showViewerPhoto(); } };
$('#vPrev').addEventListener('click', (e) => { e.stopPropagation(); vStep(-1); });
$('#vNext').addEventListener('click', (e) => { e.stopPropagation(); vStep(1); });
$('#vClose').addEventListener('click', closeViewer);
$('#vStage').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeViewer(); });
$('#vOpen').addEventListener('click', () => guard(() => nv.openPhoto(vCurrent().path)));
$('#vReveal').addEventListener('click', () => guard(() => nv.revealPhoto(vCurrent().path)));
$('#vCopy').addEventListener('click', async () => { if (await guard(() => nv.copyPhoto(vCurrent().path))) toast('Image copied'); });
$('#vDelete').addEventListener('click', viewerDelete);
async function viewerDelete() {
  const p = vCurrent(); if (!p) return;
  const idx = S.viewer;
  const n = await deletePaths([p.path]);
  if (n && S.viewer >= 0) { S.vlist = imagesOnly(); S.viewer = Math.min(idx, S.vlist.length - 1); showViewerPhoto(); }
}

// ------------------------------------------------------------------ Editor de notas (simple)
// Guarda solo mientras escribes. Las notas creadas en NVTabs toman el nombre de su primera línea.
const edText = $('#edText');
S.editor = null;   // { path, name, enc, isNew, timer, saving }
const editorOpen = () => !!S.editor;

async function openNote(item, isNew = false) {
  const data = await guard(() => nv.readNote(item.path));
  if (!data) return;
  S.editor = { path: item.path, name: item.name, enc: data.enc, isNew, timer: null, saving: null };
  edText.value = data.text;
  $('#edName').textContent = item.name;
  $('#edState').textContent = '';
  $('#editor').hidden = false;
  edText.focus();
  edText.setSelectionRange(edText.value.length, edText.value.length);
}

async function saveNote() {
  const ed = S.editor; if (!ed) return;
  clearTimeout(ed.timer); ed.timer = null;
  const text = edText.value;
  await ed.saving;   // no pisar un guardado en curso
  ed.saving = (async () => {
    const saved = await guard(() => nv.writeNote(ed.path, text, ed.enc));
    if (!saved) { $('#edState').textContent = 'Not saved'; return; }
    if (ed.isNew) {
      const renamed = await guard(() => nv.autonameNote(ed.path, text));
      if (renamed) { ed.path = renamed.path; ed.name = renamed.name; $('#edName').textContent = renamed.name; }
    }
    if (S.editor === ed) $('#edState').textContent = 'Saved';
  })();
  await ed.saving;
}

edText.addEventListener('input', () => {
  const ed = S.editor; if (!ed) return;
  $('#edState').textContent = 'Editing…';
  clearTimeout(ed.timer);
  ed.timer = setTimeout(saveNote, 700);
});

async function closeNote() {
  const ed = S.editor; if (!ed) return;
  if (ed.timer) await saveNote(); else await ed.saving;
  S.editor = null;
  $('#editor').hidden = true;
  await loadPhotos();
}

async function newNote() {
  if (!S.current) return;
  const item = await guard(() => nv.createNote(S.current));
  if (!item) return;
  await loadPhotos();
  openNote(item, true);
}

$('#edClose').addEventListener('click', closeNote);
$('#editor').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeNote(); });
$('#edOpenWith').addEventListener('click', async () => { if (S.editor) { await saveNote(); guard(() => nv.openWith(S.editor.path)); } });
$('#edReveal').addEventListener('click', async () => { if (S.editor) { await saveNote(); guard(() => nv.revealPhoto(S.editor.path)); } });
let wheelLock = 0;
$('#viewer').addEventListener('wheel', (e) => {
  const now = Date.now(); if (now - wheelLock < 180) return; wheelLock = now;
  vStep(e.deltaY > 0 ? 1 : -1);
}, { passive: true });

// ------------------------------------------------------------------ Tema
async function setTheme(theme) {
  const t = await guard(() => nv.setTheme(theme));
  if (t) S.theme = t;
}

// ------------------------------------------------------------------ Menú y "Acerca de"
let aboutText = '';
async function openAbout() {
  const a = await guard(() => nv.about());
  if (!a) return;
  $('#aboutVersion').textContent = `Version ${a.version}`;
  const rows = [
    ['Version', a.version],
    ['Electron', a.electron],
    ['Chromium', a.chrome],
    ['Node.js', a.node],
    ['System', a.os],
    ['Data folder', a.root],
  ];
  const dl = $('#aboutInfo');
  dl.textContent = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v; dd.title = v;
    dl.append(dt, dd);
  }
  aboutText = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  $('#about').hidden = false;
}
function closeAbout() { $('#about').hidden = true; }
const aboutOpen = () => !$('#about').hidden;

$('#aboutClose').addEventListener('click', closeAbout);
$('#about').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAbout(); });
$('#about').addEventListener('click', (e) => {
  const link = e.target.closest('[data-link]');
  if (link) { e.preventDefault(); guard(() => nv.openLink(link.dataset.link)); }
});
$('#aboutCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(`NVTabs\n${aboutText}`); toast('Info copied'); }
  catch { toast('Could not copy the info', true); }
});

$('#appMenu').addEventListener('click', async () => {
  const themeItem = (id, label) => ({ id: `theme:${id}`, label, radio: true, checked: S.theme === id });
  const choice = await nv.menu([
    { id: 'photos', label: 'Open NVTabs folder' },
    { label: 'Theme', submenu: [themeItem('system', 'System'), themeItem('light', 'Light'), themeItem('dark', 'Dark')] },
    '-',
    { id: 'issues', label: 'Report an issue' },
    { id: 'repo', label: 'Source code on GitHub' },
    '-',
    { id: 'about', label: 'About NVTabs' },
  ]);
  if (choice === 'about') openAbout();
  else if (choice?.startsWith('theme:')) setTheme(choice.slice(6));
  else if (choice) guard(() => nv.openLink(choice));
});

// ------------------------------------------------------------------ Teclado
document.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input[type="text"], input:not([type])')) return;
  const ctrl = e.ctrlKey || e.metaKey;

  if (editorOpen()) {   // mientras se edita una nota, las teclas son para el texto
    if (e.key === 'Escape') { e.preventDefault(); closeNote(); }
    else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveNote(); }
    return;
  }
  if (aboutOpen()) { if (e.key === 'Escape') { closeAbout(); e.preventDefault(); } return; }
  if (e.key === 'F1') { openAbout(); e.preventDefault(); return; }

  if (S.viewer >= 0) {
    if (e.key === 'ArrowLeft') vStep(-1);
    else if (e.key === 'ArrowRight' || e.key === ' ') vStep(1);
    else if (e.key === 'Escape') closeViewer();
    else if (e.key === 'Delete') viewerDelete();
    else if (e.key === 'Home') { S.viewer = 0; showViewerPhoto(); }
    else if (e.key === 'End') { S.viewer = S.vlist.length - 1; showViewerPhoto(); }
    else return;
    e.preventDefault(); return;
  }

  const k = e.key.toLowerCase();
  if (ctrl && k === 't') newTab();
  else if (ctrl && k === 'n') newNote();
  else if (ctrl && k === 'v') paste();
  else if (ctrl && k === 'o') addPhotosDialog();
  else if (ctrl && k === 'a') selectAll();
  else if (ctrl && (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp')) {
    const back = e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey);
    const i = S.tabs.findIndex((t) => t.name === S.current);
    const n = S.tabs.length; if (!n) return;
    selectTab(S.tabs[(i + (back ? -1 : 1) + n) % n].name);
  }
  else if (ctrl && /^[1-9]$/.test(e.key)) { const t = S.tabs[Number(e.key) - 1]; if (t) selectTab(t.name); }
  else if (e.key === 'F2') renameTab();
  else if (e.key === 'Delete') { if (S.selected.size) deletePaths([...S.selected]); }
  else if (e.key === 'Escape') clearSelection();
  else return;
  e.preventDefault();
});

// Al volver a la ventana, reflejar cambios hechos desde el Explorador
nv.onFocus(async () => {
  if (S.viewer >= 0 || editorOpen()) return;
  await refreshTabs();
  if (!S.current && S.tabs[0]) await selectTab(S.tabs[0].name);
  else await loadPhotos();
});

// ------------------------------------------------------------------ Inicio
(async function init() {
  const st = await nv.state();
  S.tabs = st.tabs;
  S.theme = st.config.theme || 'system';
  sizeInput.value = st.config.size;
  applySize(st.config.size);
  const start = S.tabs.find((t) => t.name === st.config.lastTab) || S.tabs[0];
  renderTabs();
  if (start) await selectTab(start.name);
})();
