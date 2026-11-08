// NVTabs - proceso principal (archivos, pestañas, ventana)
const {
  app, BrowserWindow, ipcMain, dialog, shell, clipboard, ClipboardItem, nativeImage,
  nativeTheme, protocol, net, Menu,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL, fileURLToPath } = require('node:url');

const TEST = process.env.NV_TEST || '';            // carpeta para capturas de prueba
if (TEST) {
  // En modo prueba todo vive dentro de la carpeta de prueba (también para probar la migración)
  app.setPath('userData', path.join(TEST, 'userData'));
  app.setPath('appData', path.join(TEST, 'appData'));
  app.setPath('documents', path.join(TEST, 'Documentos'));
  app.setPath('pictures', path.join(TEST, 'Imagenes'));
}

const ROOT = path.join(app.getPath('documents'), 'NVTabs');
const CONFIG = path.join(app.getPath('userData'), 'config.json');
const THUMBS = path.join(app.getPath('userData'), 'miniaturas');
const EXTS = new Set(['.jpg', '.jpeg', '.jfif', '.png', '.gif', '.bmp', '.webp', '.avif']);
const TEXT_EXTS = new Set(['.txt', '.md', '.markdown', '.log', '.csv', '.json', '.xml', '.yml', '.yaml', '.ini']);
const THUMB_W = 480;
const NOTE_MAX_BYTES = 5 * 1024 * 1024;   // el editor simple no abre archivos más grandes
const PREVIEW_CHARS = 500;

protocol.registerSchemesAsPrivileged([
  { scheme: 'nv', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// ------------------------------------------------------------------ Config
let config = { order: [], lastTab: '', size: 210, theme: 'system', bounds: null, maximized: false };
const THEMES = ['system', 'light', 'dark'];
function loadConfig() {
  try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG, 'utf8')) }; } catch { /* primera vez */ }
}
let saveTimer = null;
function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2)); } catch {}
  }, 200);
}

// ------------------------------------------------------------------ Utilidades
class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

function isImage(p) { return EXTS.has(path.extname(p).toLowerCase()); }
function isText(p) { return TEXT_EXTS.has(path.extname(p).toLowerCase()); }
function isSupported(p) { return isImage(p) || isText(p); }

// ------------------------------------------------------------------ Texto (notas)
// Las notas viejas del Bloc de notas pueden estar en UTF-16 o en ANSI (Windows-1252): se detecta
// para que los acentos y la ñ se vean bien. Al guardar se respeta el BOM; ANSI pasa a UTF-8.
function decodeText(buf) {
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return { text: buf.subarray(3).toString('utf8'), enc: 'utf8-bom' };
  if (buf[0] === 0xFF && buf[1] === 0xFE) return { text: buf.subarray(2).toString('utf16le'), enc: 'utf16le' };
  if (buf[0] === 0xFE && buf[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(buf.subarray(2)), enc: 'utf8' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), enc: 'utf8' }; }
  catch { return { text: new TextDecoder('windows-1252').decode(buf), enc: 'utf8' }; }
}
function encodeText(text, enc) {
  if (enc === 'utf8-bom') return Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
  if (enc === 'utf16le') return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]);
  return Buffer.from(text, 'utf8');
}
function notePreview(p, size) {
  try {
    if (size > 256 * 1024) {           // archivo grande: solo el principio
      const fd = fs.openSync(p, 'r'); const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      return new TextDecoder('utf-8').decode(buf.subarray(0, n)).slice(0, PREVIEW_CHARS);
    }
    return decodeText(fs.readFileSync(p)).text.slice(0, PREVIEW_CHARS);
  } catch { return ''; }
}

// Nombre de archivo a partir de la primera línea de texto ("# Pedidos marzo" -> "Pedidos marzo")
function nameFromText(text) {
  const line = String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  let name = line.replace(/^(#+|[-*>]|\d+[.)])\s*/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '');
  if (RESERVED.test(name)) name += '_';
  return name;
}

function insideRoot(p) {
  const r = path.resolve(p);
  return r.toLowerCase().startsWith(ROOT.toLowerCase() + path.sep);
}

function tabDir(name) {
  const d = path.resolve(ROOT, String(name));
  if (path.dirname(d).toLowerCase() !== ROOT.toLowerCase()) fail('Invalid tab name.');
  return d;
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
function validateName(raw, except) {
  const name = String(raw ?? '').trim();
  if (!name) fail('The name cannot be empty.');
  if (/[\\/:*?"<>|]/.test(name)) fail('The name cannot contain  \\ / : * ? " < > |');
  if (name.endsWith('.') || name.startsWith('.')) fail('The name cannot start or end with a dot.');
  if (RESERVED.test(name)) fail('That name is reserved by Windows. Please choose another one.');
  if (name.length > 80) fail('The name is too long (80 characters max).');
  const exists = listTabNames().some((t) => t.toLowerCase() === name.toLowerCase() && t !== except);
  if (exists) fail(`A tab named "${name}" already exists.`);
  return name;
}

function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let p = path.join(dir, fileName);
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`);
  return p;
}

function listTabNames() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, t: fs.statSync(path.join(ROOT, d.name)).birthtimeMs }));
  } catch {}
  const idx = (n) => { const i = config.order.indexOf(n); return i < 0 ? Infinity : i; };
  dirs.sort((a, b) => idx(a.name) - idx(b.name) || a.t - b.t || a.name.localeCompare(b.name));
  return dirs.map((d) => d.name);
}

// Fotos y notas de una pestaña, mezcladas y ordenadas por fecha en que se agregaron
function listItems(name) {
  const dir = tabDir(name);
  let files = [];
  try {
    files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && isSupported(f.name))
      .map((f) => {
        const p = path.join(dir, f.name);
        const st = fs.statSync(p);
        const item = { name: f.name, path: p, added: st.birthtimeMs, size: st.size, v: Math.round(st.mtimeMs) };
        if (isText(f.name)) { item.kind = 'note'; item.preview = notePreview(p, st.size); }
        else item.kind = 'image';
        return item;
      });
  } catch {}
  files.sort((a, b) => a.added - b.added || a.name.localeCompare(b.name));
  return files;
}

function noteItem(p) {
  const st = fs.statSync(p);
  return { kind: 'note', name: path.basename(p), path: p, added: st.birthtimeMs, size: st.size, v: Math.round(st.mtimeMs), preview: notePreview(p, st.size) };
}

function tabsSummary() {
  return listTabNames().map((name) => ({ name, count: listItems(name).length }));
}

async function collectFiles(paths) {
  const out = [];
  async function walk(p) {
    let st;
    try { st = await fsp.stat(p); } catch { return; }
    if (st.isDirectory()) {
      for (const e of await fsp.readdir(p)) await walk(path.join(p, e));
    } else if (isSupported(p)) out.push(p);
  }
  for (const p of paths) await walk(p);
  return out;
}

// Copia fotos y notas a la carpeta de la pestaña (los originales quedan donde estaban)
async function addFiles(name, paths) {
  const dir = tabDir(name);
  await fsp.mkdir(dir, { recursive: true });
  const files = await collectFiles(paths);
  let images = 0; let notes = 0; const failed = [];
  for (const src of files) {
    if (path.dirname(path.resolve(src)).toLowerCase() === dir.toLowerCase()) continue; // ya está aquí
    try {
      await fsp.copyFile(src, uniquePath(dir, path.basename(src)), fs.constants.COPYFILE_EXCL);
      if (isText(src)) notes++; else images++;
    } catch { failed.push(path.basename(src)); }
  }
  return { added: images + notes, images, notes, failed, found: files.length };
}

async function createNote(tab, text = '') {
  const dir = tabDir(tab);
  await fsp.mkdir(dir, { recursive: true });
  const p = uniquePath(dir, `${nameFromText(text) || 'New note'}.txt`);
  await fsp.writeFile(p, encodeText(text, 'utf8'), { flag: 'wx' });
  return noteItem(p);
}

// ------------------------------------------------------------------ Miniaturas
async function thumbFor(p) {
  const st = await fsp.stat(p);
  const key = crypto.createHash('sha1').update(`${p.toLowerCase()}|${st.size}|${st.mtimeMs}|${THUMB_W}`).digest('hex');
  const out = path.join(THUMBS, `${key}.png`);
  if (fs.existsSync(out)) return out;
  let img = null;
  try { img = await nativeImage.createThumbnailFromPath(p, { width: THUMB_W, height: THUMB_W }); } catch {}
  if (!img || img.isEmpty()) {
    img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return p; // que Chromium la muestre tal cual (gif, webp, avif...)
    const { width, height } = img.getSize();
    const k = Math.min(1, THUMB_W / Math.max(width, height));
    img = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'good' });
  }
  await fsp.mkdir(THUMBS, { recursive: true });
  await fsp.writeFile(out, img.toPNG());
  return out;
}

function registerProtocol() {
  protocol.handle('nv', async (req) => {
    try {
      const u = new URL(req.url);
      const p = u.searchParams.get('p') || '';
      if (!insideRoot(p) || !isImage(p)) return new Response('', { status: 403 });
      const file = u.hostname === 'thumb' ? await thumbFor(p) : p;
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('', { status: 404 });
    }
  });
}

// ------------------------------------------------------------------ Ventana
let win = null;

function overlayColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#17181b', symbolColor: '#e8e9ec', height: 46 }
    : { color: '#eceef2', symbolColor: '#1d1f23', height: 46 };
}

function createWindow() {
  const b = config.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 840, x: b.x, y: b.y,
    minWidth: 760, minHeight: 480,
    show: false,
    title: 'NVTabs',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#17181b' : '#eceef2',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  if (config.maximized && !TEST) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!TEST) win.show(); });

  const remember = () => {
    if (win.isDestroyed()) return;
    config.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) config.bounds = win.getBounds();
    saveConfig();
  };
  win.on('resize', remember); win.on('move', remember); win.on('close', remember);
  win.on('focus', () => win.webContents.send('window:focus'));

  // Los enlaces nunca abren ventanas nuevas dentro de la app
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (TEST) runTest();
}

nativeTheme.on('updated', () => {
  if (win && !win.isDestroyed()) {
    win.setTitleBarOverlay(overlayColors());
    win.setBackgroundColor(overlayColors().color);
  }
});

async function confirm(message, detail, okLabel) {
  const r = await dialog.showMessageBox(win, {
    type: 'warning', buttons: [okLabel, 'Cancel'], defaultId: 1, cancelId: 1,
    title: 'NVTabs', message, detail, noLink: true,
  });
  return r.response === 0;
}

// ------------------------------------------------------------------ IPC
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (err) { return { ok: false, error: err instanceof UserError ? err.message : `Error: ${err.message}` }; }
  });
}

function registerIpc() {
  handle('state', () => ({ root: ROOT, tabs: tabsSummary(), config: { lastTab: config.lastTab, size: config.size, theme: config.theme } }));

  // Tema: "system" sigue a Windows; "light"/"dark" lo fijan. La interfaz usa prefers-color-scheme,
  // que Electron ajusta según nativeTheme.themeSource (y la barra de título se actualiza en 'updated').
  handle('theme:set', (theme) => {
    if (!THEMES.includes(theme)) fail('Unknown theme.');
    config.theme = theme; saveConfig();
    nativeTheme.themeSource = theme;
    return theme;
  });
  handle('tabs', () => tabsSummary());
  handle('photos', (name) => listItems(name));

  handle('tab:create', async (raw) => {
    const name = validateName(raw);
    await fsp.mkdir(tabDir(name), { recursive: true });
    config.order = [...listTabNames().filter((n) => n !== name), name];
    config.lastTab = name; saveConfig();
    return name;
  });

  handle('tab:rename', async (oldName, raw) => {
    const name = validateName(raw, oldName);
    if (name === oldName) return name;
    const from = tabDir(oldName); const to = tabDir(name);
    if (name.toLowerCase() === oldName.toLowerCase()) {      // solo cambian mayúsculas
      const tmp = path.join(ROOT, `.renombrando-${Date.now()}`);
      await fsp.rename(from, tmp); await fsp.rename(tmp, to);
    } else {
      await fsp.rename(from, to);
    }
    config.order = config.order.map((n) => (n === oldName ? name : n));
    if (config.lastTab === oldName) config.lastTab = name;
    saveConfig();
    return name;
  });

  handle('tab:delete', async (name) => {
    const n = listItems(name).length;
    const ok = await confirm(
      `Delete the tab "${name}"${n ? ` and its ${n} item${n === 1 ? '' : 's'}` : ''}?`,
      'It will be moved to the Recycle Bin, where you can restore it.',
      'Delete tab');
    if (!ok) return false;
    await shell.trashItem(tabDir(name));
    config.order = config.order.filter((x) => x !== name); saveConfig();
    return true;
  });

  handle('tab:reorder', (names) => { config.order = names.map(String); saveConfig(); return true; });
  handle('tab:select', (name) => { config.lastTab = String(name); saveConfig(); return true; });
  handle('tab:open', (name) => shell.openPath(tabDir(name)));

  handle('photos:add', (name, paths) => addFiles(name, (paths || []).map(String)));

  handle('photos:pick', async (name) => {
    const r = await dialog.showOpenDialog(win, {
      title: `Add photos or notes to "${name}"`,
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Photos and notes', extensions: [...EXTS, ...TEXT_EXTS].map((e) => e.slice(1)) },
        { name: 'Images', extensions: [...EXTS].map((e) => e.slice(1)) },
        { name: 'Text files', extensions: [...TEXT_EXTS].map((e) => e.slice(1)) },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (r.canceled) return { added: 0, failed: [], found: 0, canceled: true };
    return addFiles(name, r.filePaths);
  });

  handle('photos:paste', async (name) => {
    // Electron 45+: API asíncrona del portapapeles (clipboard.read() -> ClipboardItem)
    const items = await clipboard.read();

    // 1) Archivos copiados en el Explorador -> llegan como "text/uri-list" (file:///...)
    for (const it of items) {
      if (!it.types.includes('text/uri-list')) continue;
      const text = await (await it.getType('text/uri-list')).text();
      const paths = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith('file:'))
        .map((u) => { try { return fileURLToPath(u); } catch { return null; } }).filter(Boolean);
      if (paths.length) return addFiles(name, paths);
    }

    // 2) Una imagen copiada (captura con Win+Shift+S, desde el navegador, etc.)
    for (const it of items) {
      const type = it.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const buf = Buffer.from(await (await it.getType(type)).arrayBuffer());
      if (!buf.length) continue;
      const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp' }[type] || '.png';
      const d = new Date(); const pad = (x) => String(x).padStart(2, '0');
      const fname = `Pasted ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}${ext}`;
      const dir = tabDir(name);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(uniquePath(dir, fname), buf);
      return { added: 1, images: 1, notes: 0, failed: [], found: 1 };
    }

    // 3) Texto copiado -> nota nueva (su nombre sale de la primera línea)
    for (const it of items) {
      if (!it.types.includes('text/plain')) continue;
      const text = await (await it.getType('text/plain')).text();
      if (!text.trim()) continue;
      const note = await createNote(name, text);
      return { added: 1, images: 0, notes: 1, failed: [], found: 1, note };
    }
    return { added: 0, failed: [], found: 0, empty: true };
  });

  // Mover fotos/notas a otra pestaña (se mueven los archivos; si el nombre existe se agrega " (2)")
  handle('items:move', async (paths, targetTab) => {
    const dir = tabDir(targetTab);
    if (!fs.existsSync(dir)) fail(`The tab "${targetTab}" no longer exists.`);
    let moved = 0; const failed = [];
    for (const p of (paths || []).map(String)) {
      if (!insideRoot(p) || !isSupported(p)) continue;
      if (path.dirname(path.resolve(p)).toLowerCase() === dir.toLowerCase()) continue; // ya está ahí
      try { await fsp.rename(p, uniquePath(dir, path.basename(p))); moved++; }
      catch { failed.push(path.basename(p)); }
    }
    return { moved, failed };
  });

  // ---------------------------------------------------------------- Notas
  handle('note:create', (tab) => createNote(tab, ''));

  handle('note:read', async (p) => {
    if (!insideRoot(p) || !isText(p)) fail('This file cannot be opened as a note.');
    const st = await fsp.stat(p);
    if (st.size > NOTE_MAX_BYTES) fail('This file is too big for the note editor. Open it with another app.');
    return { ...decodeText(await fsp.readFile(p)), v: Math.round(st.mtimeMs) };
  });

  handle('note:write', async (p, text, enc) => {
    if (!insideRoot(p) || !isText(p)) fail('This note cannot be saved.');
    await fsp.writeFile(p, encodeText(String(text), enc));
    return noteItem(p);
  });

  // Renombra la nota según su primera línea (solo para notas creadas en NVTabs)
  handle('note:autoname', async (p, text) => {
    if (!insideRoot(p) || !isText(p)) return noteItem(p);
    const base = nameFromText(text) || 'New note';
    const ext = path.extname(p);
    if (path.basename(p, ext) === base) return noteItem(p);
    const target = uniquePath(path.dirname(p), `${base}${ext}`);
    await fsp.rename(p, target);
    return noteItem(target);
  });

  handle('note:copy', async (p) => {
    if (!insideRoot(p) || !isText(p)) return false;
    await clipboard.writeText(decodeText(await fsp.readFile(p)).text);
    return true;
  });

  // "Abrir con..." de Windows (elegir la aplicación)
  handle('file:openWith', (p) => {
    if (!insideRoot(p)) return false;
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', path.resolve(p)], { detached: true, stdio: 'ignore' }).unref();
    return true;
  });

  handle('photos:delete', async (paths, ask = true) => {
    paths = (paths || []).map(String).filter(insideRoot);
    if (!paths.length) return 0;
    if (ask) {
      const ok = await confirm(
        paths.length === 1 ? `Delete "${path.basename(paths[0])}"?` : `Delete ${paths.length} items?`,
        'Deleted items go to the Recycle Bin.', 'Delete');
      if (!ok) return 0;
    }
    let n = 0;
    for (const p of paths) { try { await shell.trashItem(p); n++; } catch {} }
    return n;
  });

  handle('photo:open', (p) => { if (insideRoot(p)) return shell.openPath(p); });
  handle('photo:reveal', (p) => { if (insideRoot(p)) shell.showItemInFolder(p); });
  handle('photo:copy', async (p) => {
    if (!insideRoot(p)) return false;
    const img = nativeImage.createFromPath(p);
    if (img.isEmpty()) fail('This image could not be copied (format not supported by the clipboard).');
    const png = new Blob([img.toPNG()], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  });

  // En el visor (fondo oscuro) los botones de la ventana también se ven oscuros
  handle('overlay', (dark) => {
    win.setTitleBarOverlay(dark ? { color: '#0c0c0e', symbolColor: '#e8e9ec', height: 46 } : overlayColors());
  });

  handle('about', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `Windows ${process.getSystemVersion()} (${process.arch})`,
    root: ROOT,
  }));

  // Solo se abren enlaces conocidos (nunca URLs que vengan de la interfaz)
  const REPO = 'https://github.com/nicolasvillacorta/nvtabs';
  const LINKS = {
    repo: REPO,
    issues: `${REPO}/issues`,
    releases: `${REPO}/releases`,
    license: `${REPO}/blob/main/LICENSE`,
  };
  handle('link', (id) => {
    if (id === 'photos') return shell.openPath(ROOT);
    if (!LINKS[id]) fail('Unknown link.');
    return shell.openExternal(LINKS[id]);
  });

  handle('config:size', (size) => { config.size = Math.max(120, Math.min(380, Number(size) || 210)); saveConfig(); });

  // Menús contextuales nativos: devuelven la opción elegida
  // Admite separadores ('-'), submenús ({ label, submenu: [...] }) y opciones tipo radio ({ radio, checked })
  handle('menu', (items) => new Promise((resolve) => {
    let chosen = null;
    const build = (list) => list.map((it) => {
      if (it === '-') return { type: 'separator' };
      if (it.submenu) return { label: it.label, submenu: build(it.submenu) };
      return {
        label: it.label, enabled: it.enabled !== false,
        ...(it.radio ? { type: 'radio', checked: !!it.checked } : {}),
        click: () => { chosen = it.id; },
      };
    });
    Menu.buildFromTemplate(build(items)).popup({ window: win, callback: () => setTimeout(() => resolve(chosen), 0) });
  }));
}

// ------------------------------------------------------------------ Prueba automática (solo desarrollo)
async function runTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(TEST, `${name}.png`), img.toPNG());
  };
  win.webContents.on('console-message', (e) => {
    fs.appendFileSync(path.join(TEST, 'consola.txt'), `[${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})\n`);
  });
  if (process.env.NV_TEST_PASTE) {   // prueba de Ctrl+V: pega lo que haya en el portapapeles en "Compras"
    win.webContents.once('did-finish-load', async () => {
      const res = {};
      try {
        await wait(1500);
        res.paste = await win.webContents.executeJavaScript(`nv.pastePhotos('Compras')`);
        res.compras = listItems('Compras').map((p) => p.name);
        if (process.env.NV_TEST_PASTE === 'copy') {
          await clipboard.clear();
          res.copy = await win.webContents.executeJavaScript(`nv.copyPhoto(${JSON.stringify(path.join(ROOT, 'Ventas', 'venta 2.jpg'))})`);
          res.clipboardHasPng = await clipboard.has('image/png');
        }
      } catch (e) { res.error = String(e); }
      fs.writeFileSync(path.join(TEST, 'pegar.json'), JSON.stringify(res, null, 2));
      app.quit();
    });
    return;
  }
  if (process.env.NV_TEST_MOVE) {   // prueba de mover fotos/notas entre pestañas
    win.webContents.once('did-finish-load', async () => {
      const res = {};
      const js = (code) => win.webContents.executeJavaScript(code);
      const names = (tab) => listItems(tab).map((p) => p.name);
      try {
        await wait(2000);
        res.antes = { Ventas: names('Ventas').length, Clientes: names('Clientes'), Compras: names('Compras').length };
        // 1) Como el menú "Move to": dos seleccionadas -> Clientes
        await js(`S.selected.add(S.photos[0].path); S.selected.add(S.photos.find(p => p.kind === 'note').path); updateSelectionUI();
                  moveItems([...S.selected], 'Clientes')`);
        await wait(800);
        res.menu = { Ventas: names('Ventas').length, Clientes: names('Clientes') };
        // 2) Arrastrar una tarjeta sobre la pestaña "Compras"
        await js(`(() => {
          const dt = new DataTransfer();
          const card = document.querySelectorAll('.card')[1];
          window.__movida = S.photos[1].name;
          card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
          const tab = [...document.querySelectorAll('.tab')].find(t => t.dataset.name === 'Compras');
          tab.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
          window.__dt = dt;
        })()`);
        await wait(400); await shot('m1-arrastrando');
        await js(`(() => {
          const tab = [...document.querySelectorAll('.tab')].find(t => t.dataset.name === 'Compras');
          tab.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }));
        })()`);
        await wait(1200);
        res.movida = await js('window.__movida');
        res.arrastre = { Ventas: names('Ventas').length, CompraTieneLaMovida: names('Compras').includes(await js('window.__movida')) };
        res.badges = await js(`[...document.querySelectorAll('.tab')].map(t => t.textContent)`);
        await shot('m2-despues');
      } catch (e) { res.error = String(e.stack || e); }
      res.errores = await js('window.__errors || []');
      fs.writeFileSync(path.join(TEST, 'mover.json'), JSON.stringify(res, null, 2));
      app.quit();
    });
    return;
  }
  if (process.env.NV_TEST_NOTES) {   // prueba de notas (ver README: NV_TEST)
    win.webContents.once('did-finish-load', async () => {
      const res = {};
      const js = (code) => win.webContents.executeJavaScript(code);
      const names = (tab) => listItems(tab).map((p) => `${p.kind}:${p.name}`);
      const prevClipboard = await clipboard.readText().catch(() => '');
      try {
        await wait(2000); await shot('n1-grilla-mezclada');
        res.ventas = names('Ventas');
        // Importar una carpeta con .txt, .md y una foto
        res.importar = await js(`nv.addPhotos('Compras', [${JSON.stringify(path.join(TEST, 'importar'))}])`);
        res.compras = names('Compras');
        // Codificaciones viejas del Bloc de notas
        const dir = path.join(ROOT, 'Ventas');
        res.ansi = (await js(`nv.readNote(${JSON.stringify(path.join(dir, 'nota ansi.txt'))})`)).text;
        res.utf16 = (await js(`nv.readNote(${JSON.stringify(path.join(dir, 'nota utf16.txt'))})`)).text;
        // Nota nueva desde la interfaz: el nombre sale de la primera línea
        await js(`newNote()`); await wait(800);
        await js(`edText.value = 'Pedidos de marzo\\nleche x2\\npan'; edText.dispatchEvent(new Event('input'))`);
        await wait(1600); await shot('n2-editor');
        await js(`closeNote()`); await wait(800);
        // Editar una nota importada: NO se renombra
        await js(`openNote(S.photos.find(p => p.name === 'pedidos.txt'))`); await wait(600);
        await js(`edText.value = 'Otra primera linea\\n' + edText.value; edText.dispatchEvent(new Event('input'))`);
        await js(`closeNote()`); await wait(800);
        res.ventasDespues = names('Ventas');
        res.ansiGuardada = fs.readFileSync(path.join(dir, 'nota ansi.txt')).toString('hex').slice(0, 12);
        // Pegar texto -> nota nueva
        await clipboard.writeText('Llamar a Juan el lunes\nTel 1234');
        res.pegar = await js(`nv.pastePhotos('Ventas')`);
        // El visor recorre solo las fotos
        await js(`loadPhotos(true)`); await wait(800);
        await js(`openViewer(S.photos.findIndex(p => p.kind === 'image'))`); await wait(800);
        res.visor = await js(`({ fotos: S.vlist.length, notasEnVisor: S.vlist.filter(p => p.kind === 'note').length, pos: document.querySelector('#vPos').textContent })`);
        await shot('n3-visor');
        await js(`closeViewer()`); await wait(1200); await shot('n4-grilla-final');
      } catch (e) { res.error = String(e.stack || e); }
      await clipboard.writeText(prevClipboard).catch(() => {});
      res.errores = await win.webContents.executeJavaScript('window.__errors || []');
      fs.writeFileSync(path.join(TEST, 'notas.json'), JSON.stringify(res, null, 2));
      app.quit();
    });
    return;
  }
  win.webContents.once('did-finish-load', async () => {
    try {
      await wait(2500); await shot('1-galeria');
      await win.webContents.executeJavaScript(`document.querySelector('.card').click()`);
      await wait(1200); await shot('2-visor');
      await win.webContents.executeJavaScript(`
        document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));
        document.querySelectorAll('.card .check')[1].click();
        document.querySelectorAll('.card .check')[3].click();`);
      await wait(600); await shot('3-seleccion');
      await win.webContents.executeJavaScript(`setTheme('dark')`);
      await win.webContents.executeJavaScript(`document.querySelectorAll('.tab')[1].click()`);
      await wait(1500); await shot('4-oscuro-vacia');
      await win.webContents.executeJavaScript(`setTheme('light')`);
      const src = path.join(ROOT, 'Ventas', 'venta 3.jpg').replace(/\\/g, '\\\\');
      const tabsNow = await win.webContents.executeJavaScript(`(async () => {
        newTab();
        const inp = document.querySelector('.tab input');
        inp.value = 'Proveedores';
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        await new Promise(r => setTimeout(r, 800));
        const r = await nv.addPhotos('Proveedores', ['${src}']);
        await loadPhotos();
        const n = await nv.renameTab('Proveedores', 'Proveedores 2026');
        S.current = n; await refreshTabs(); await selectTab(n);
        return { added: r.added, tabs: S.tabs };
      })()`);
      fs.writeFileSync(path.join(TEST, 'pestanas.json'), JSON.stringify(tabsNow, null, 2));
      await wait(1500); await shot('5-claro-nueva');
      await win.webContents.executeJavaScript(`openAbout()`);
      await wait(800); await shot('6-acerca-de');
      const imgs = await win.webContents.executeJavaScript(`Promise.all([...document.querySelectorAll('.card img')].map(async i =>
        ({ src: decodeURIComponent(i.src), complete: i.complete, w: i.naturalWidth, cls: i.className,
           probe: await new Promise(r => { const x = new Image(); x.onload = () => r('ok ' + x.naturalWidth); x.onerror = () => r('error'); x.src = i.src; }) })))`);
      fs.writeFileSync(path.join(TEST, 'imagenes.json'), JSON.stringify(imgs, null, 2));
      const errs = await win.webContents.executeJavaScript('window.__errors || []');
      fs.writeFileSync(path.join(TEST, 'errores.json'), JSON.stringify(errs, null, 2));
    } catch (e) {
      fs.writeFileSync(path.join(TEST, 'errores.json'), JSON.stringify([String(e)]));
    }
    app.quit();
  });
}

// ------------------------------------------------------------------ Migración desde "NVImage"
// La app se llamaba NVImage y guardaba las fotos en Imágenes\NVImage y la configuración en
// %APPDATA%\NVImage. La primera vez que abre NVTabs, se mueven a sus lugares nuevos.
function migrateFromNVImage() {
  const oldRoot = path.join(app.getPath('pictures'), 'NVImage');
  const oldConfig = path.join(app.getPath('appData'), 'NVImage', 'config.json');
  try {
    if (!fs.existsSync(ROOT) && fs.existsSync(oldRoot)) {
      fs.mkdirSync(path.dirname(ROOT), { recursive: true });
      try {
        fs.renameSync(oldRoot, ROOT);           // misma unidad: instantáneo y conserva las fechas
      } catch {
        fs.cpSync(oldRoot, ROOT, { recursive: true, preserveTimestamps: true }); // otra unidad: copia (deja el original)
      }
    }
    if (!fs.existsSync(CONFIG) && fs.existsSync(oldConfig)) {
      fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
      fs.copyFileSync(oldConfig, CONFIG);
    }
  } catch (e) {
    console.error('No se pudo migrar desde NVImage:', e);
  }
}

// ------------------------------------------------------------------ Arranque
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
  });

  app.setAppUserModelId('com.nvtabs.app'); // agrupa la ventana con el acceso directo (ícono en la barra de tareas)

  app.whenReady().then(() => {
    migrateFromNVImage();
    loadConfig();
    if (THEMES.includes(config.theme)) nativeTheme.themeSource = config.theme;
    const firstRun = !fs.existsSync(ROOT);
    fs.mkdirSync(ROOT, { recursive: true });
    if (firstRun) fs.mkdirSync(path.join(ROOT, 'Photos'), { recursive: true });
    registerProtocol();
    registerIpc();
    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
