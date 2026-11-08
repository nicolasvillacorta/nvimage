// NVTabs - proceso principal (archivos, pestañas, ventana)
const {
  app, BrowserWindow, ipcMain, dialog, shell, clipboard, ClipboardItem, nativeImage,
  nativeTheme, protocol, net, Menu, Tray, globalShortcut, desktopCapturer, screen, Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = fs.promises;
const crypto = require('node:crypto');
const { spawn, execFile, execFileSync } = require('node:child_process');
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
  { scheme: 'nv', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// ------------------------------------------------------------------ Config
let config = {
  order: [], lastTab: '', size: 210, theme: 'system', bounds: null, maximized: false,
  shortcut: 'Ctrl+Alt+S',   // atajo global para capturar la pantalla ('' = sin atajo)
  background: true,         // al cerrar la ventana sigue corriendo en el área de notificación
  startup: false,           // iniciar con Windows (oculta, en segundo plano)
  backgroundNoticeShown: false,
};
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
      if (u.hostname === 'capture') {   // pantalla congelada durante una captura
        const c = captureImages.get(u.searchParams.get('id'));
        if (!c) return new Response('', { status: 404 });
        const cors = { 'access-control-allow-origin': '*' };   // para poder dibujarla en un canvas
        if (u.pathname === '/crop') {   // recorte sin pérdida (PNG) en píxeles de la imagen
          const n = (k) => Math.max(0, Math.round(Number(u.searchParams.get(k)) || 0));
          const { width: iw, height: ih } = c.image.getSize();
          const x = Math.min(n('x'), iw - 1); const y = Math.min(n('y'), ih - 1);
          const rect = { x, y, width: Math.max(1, Math.min(n('w'), iw - x)), height: Math.max(1, Math.min(n('h'), ih - y)) };
          return new Response(c.image.crop(rect).toPNG(), { headers: { 'content-type': 'image/png', ...cors } });
        }
        return new Response(c.jpeg, { headers: { 'content-type': 'image/jpeg', ...cors } });
      }
      const p = u.searchParams.get('p') || '';
      if (!insideRoot(p) || !isImage(p)) return new Response('', { status: 403 });
      const file = u.hostname === 'thumb' ? await thumbFor(p) : p;
      return net.fetch(pathToFileURL(file).toString());
    } catch {
      return new Response('', { status: 404 });
    }
  });
}

// ------------------------------------------------------------------ Google Lens
// Google no tiene una forma oficial de abrir Lens con un archivo local, y los resultados quedan
// atados al navegador que sube la imagen. Por eso se genera una página temporal que el navegador
// predeterminado abre y que sube la imagen a Lens desde ahí (como si la arrastraras a lens.google.com).
const LENS_DIR = path.join(app.getPath('temp'), 'nvtabs-lens');
const LENS_MAX = 2000;   // px: las fotos más grandes se achican para que la página sea liviana

function cleanLensDir() {
  try {
    for (const f of fs.readdirSync(LENS_DIR)) {
      const p = path.join(LENS_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 10 * 60 * 1000) fs.rmSync(p, { force: true });
    }
  } catch {}
}

function lensImage(p) {
  const ext = path.extname(p).toLowerCase();
  const img = nativeImage.createFromPath(p);
  if (img.isEmpty()) {   // gif, webp, avif...: se envía tal cual
    const type = { '.gif': 'gif', '.webp': 'webp', '.avif': 'avif', '.bmp': 'bmp' }[ext] || 'jpeg';
    return { data: fs.readFileSync(p), mime: `image/${type}`, name: `image${ext}` };
  }
  const { width, height } = img.getSize();
  const k = Math.min(1, LENS_MAX / Math.max(width, height));
  const out = k < 1 ? img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'good' }) : img;
  return ext === '.png'
    ? { data: out.toPNG(), mime: 'image/png', name: 'image.png' }
    : { data: out.toJPEG(92), mime: 'image/jpeg', name: 'image.jpg' };
}

function lensPage({ data, mime, name }) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Opening Google Lens…</title>
<body style="margin:0;height:100vh;display:grid;place-items:center;font:16px 'Segoe UI',sans-serif;color:#555;background:#f6f7f9">
<div>Opening Google Lens…</div>
<form id="f" method="POST" enctype="multipart/form-data" action="https://lens.google.com/v3/upload?ep=ccm&amp;re=dcsp&amp;s=4&amp;st=${Date.now()}">
<input type="file" name="encoded_image" id="i" hidden></form>
<script>
const bytes = Uint8Array.from(atob('${data.toString('base64')}'), (c) => c.charCodeAt(0));
const dt = new DataTransfer();
dt.items.add(new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} }));
document.getElementById('i').files = dt.files;
document.getElementById('f').submit();
</script></body></html>`;
}

// Navegador predeterminado para https (Chrome, Edge, Firefox...). Si no se encuentra, Windows decide.
function defaultBrowserExe() {
  try {
    const q = (args) => execFileSync('reg', ['query', ...args], { encoding: 'utf8', windowsHide: true });
    const progId = /ProgId\s+REG_SZ\s+(\S+)/i.exec(q(['HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId']))?.[1];
    if (!progId) return null;
    const cmd = /REG_\w+\s+(.+)/.exec(q([`HKCR\\${progId}\\shell\\open\\command`, '/ve']))?.[1]?.trim();
    const exe = cmd?.startsWith('"') ? cmd.slice(1, cmd.indexOf('"', 1)) : cmd?.split(' ')[0];
    return exe && fs.existsSync(exe) ? exe : null;
  } catch { return null; }
}

async function openInLens(p) {
  fs.mkdirSync(LENS_DIR, { recursive: true });
  cleanLensDir();
  const file = path.join(LENS_DIR, `lens-${Date.now()}.html`);
  fs.writeFileSync(file, lensPage(lensImage(p)));
  const url = pathToFileURL(file).href;
  if (TEST) return url;   // en las pruebas no se abre el navegador
  const exe = defaultBrowserExe();
  if (exe) spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref();
  else await shell.openExternal(url);
  return url;
}

// ------------------------------------------------------------------ Ventana
let win = null;
let quitting = false;
const START_HIDDEN = process.argv.includes('--hidden');

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
    icon: fs.existsSync(ICON_ICO) ? ICON_ICO : path.join(__dirname, '..', 'build', 'icon.png'),   // .ico con todos los tamaños
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
  // Identidad de la ventana para Windows: al anclarla a Inicio o a la barra de tareas usa
  // "NVTabs" y su ícono (si no, toma el nombre e ícono del .exe, que es el de Electron).
  if (process.platform === 'win32' && app.isPackaged) {
    win.setAppDetails({
      appId: 'com.nvtabs.app',
      appIconPath: ICON_ICO,
      appIconIndex: 0,
      relaunchCommand: `"${process.execPath}"`,
      relaunchDisplayName: 'NVTabs',
    });
  }
  if (config.maximized && !TEST) win.maximize();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Al iniciar con Windows (--hidden) la app arranca solo en el área de notificación
  win.once('ready-to-show', () => { if (!TEST && !(START_HIDDEN && config.background)) win.show(); });

  const remember = () => {
    if (win.isDestroyed()) return;
    config.maximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) config.bounds = win.getBounds();
    saveConfig();
  };
  win.on('resize', remember); win.on('move', remember);
  win.on('close', (e) => {
    remember();
    if (config.background && !quitting && !TEST) {   // cerrar = esconder; sigue en el área de notificación
      e.preventDefault();
      win.hide();
      backgroundNotice();
    }
  });
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

  // ---------------------------------------------------------------- Configuración y captura
  handle('settings:get', () => settingsState());

  handle('settings:set', (s = {}) => {
    if ('shortcut' in s) {
      const prev = config.shortcut;
      config.shortcut = String(s.shortcut || '');
      if (!applyShortcut()) {
        const wanted = config.shortcut; const reason = shortcutError;
        config.shortcut = prev; applyShortcut();
        fail(reason === 'invalid'
          ? `"${wanted}" is not a valid shortcut.`
          : `"${wanted}" can't be used: another app or Windows is already using it. Try another combination.`);
      }
    }
    if ('background' in s) { config.background = !!s.background; if (!config.background) config.startup = false; }
    if ('startup' in s) { config.startup = !!s.startup; if (config.startup) config.background = true; }
    saveConfig(); updateTray(); applyStartup();
    return settingsState();
  });

  // Mientras se graba un atajo nuevo en Configuración, el actual no debe disparar capturas
  handle('shortcut:pause', (paused) => { if (paused) globalShortcut.unregisterAll(); else applyShortcut(); });
  handle('capture:start', () => { startCapture({ fromApp: true }); });
  handle('app:quit', () => quitApp());
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
  // Google Lens: la imagen SOLO se envía a Google cuando el usuario elige esta opción
  handle('lens', async (p) => {
    if (!insideRoot(p) || !isImage(p)) fail('Only photos can be searched with Google Lens.');
    return openInLens(p);
  });

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
  if (process.env.NV_TEST_CAPTURE) {   // prueba de Google Lens, captura de pantalla y configuración
    win.webContents.once('did-finish-load', async () => {
      const res = {};
      const js = (code) => win.webContents.executeJavaScript(code);
      try {
        await wait(2000);
        if (process.env.NV_TEST_CAPTURE === 'visor') {   // solo el botón de Lens en el visor (sin contactar a Google)
          await js(`openViewer(S.photos.findIndex(p => p.name === 'lens texto.png'))`); await wait(1200);
          res.visor = await js(`({ abierto: !document.querySelector('#viewer').hidden, boton: document.querySelector('#vLens').textContent, foto: document.querySelector('#vName').textContent })`);
          await shot('c0-visor-lens');
          throw new Error('fin');
        }
        // Captura con pantalla falsa: no se toca la pantalla real ni se contacta a Google
        const fake = nativeImage.createFromPath(path.join(TEST, 'pantalla-falsa.png')).getSize();
        const pixel = (file, x, y) => { const b = nativeImage.createFromPath(file).crop({ x, y, width: 1, height: 1 }).toBitmap(); return [b[2], b[1], b[0]]; };
        const newest = (tab) => listItems(tab).sort((a, b) => b.added - a.added)[0];
        const open = async () => { startCapture(); await wait(2200); return overlays[0]; };
        const run = (o, code) => o.win.webContents.executeJavaScript(code);
        const fire = (o, code) => o.win.webContents.executeJavaScript(`${code}; true`).catch(() => {});   // la ventana se cierra sola
        const ovShot = async (o, name) => fs.writeFileSync(path.join(TEST, `${name}.png`), (await o.win.webContents.capturePage()).toPNG());

        // A) Selección con el mouse -> aparece la barra
        let ov = await open();
        await ovShot(ov, 'c1-inicio');
        res.barraAntesDeRecortar = await run(ov, `getComputedStyle(document.querySelector('#bar')).display`);   // debe ser "none"
        await run(ov, `(() => { const ev = (t, x, y) => window.dispatchEvent(new MouseEvent(t, { clientX: x, clientY: y, button: 0, bubbles: true }));
          ev('mousedown', 200, 150); ev('mousemove', 500, 300); ev('mousemove', 700, 450); ev('mouseup', 700, 450); })()`);
        await wait(400);
        res.seleccion = await run(ov, '__test.state()');
        const vent = await run(ov, '({ w: innerWidth, h: innerHeight })');
        const kx = fake.width / vent.w; const ky = fake.height / vent.h;
        res.ventanaCaptura = { ...vent, imagen: fake };
        await ovShot(ov, 'c2-barra');
        // B) Dibujos: lápiz, flecha, rectángulo y nota
        await run(ov, `__test.tool('pen');
          __test.mark({ tool: 'pen', color: '#ef4444', pts: [{ x: 20, y: 250 }, { x: 120, y: 270 }, { x: 220, y: 250 }] });
          __test.mark({ tool: 'arrow', color: '#3b82f6', x1: 300, y1: 260, x2: 420, y2: 200 });
          __test.mark({ tool: 'rect', color: '#22c55e', x1: 40, y1: 40, x2: 260, y2: 130 });
          __test.mark({ tool: 'text', color: '#f59e0b', text: 'Buscar este producto', x: 270, y: 20 }); true`);
        await wait(300); await ovShot(ov, 'c3-anotado');
        res.anotado = await run(ov, '__test.state()');
        // C) Save to Unsorted con dibujos (se arma el PNG con el recorte original + dibujos)
        fire(ov, `__test.action('unsorted')`); await wait(1500);
        const s1 = newest(UNSORTED);
        res.unsortedConDibujos = s1 && {
          name: s1.name, size: nativeImage.createFromPath(s1.path).getSize(),
          esperado: { width: Math.round(500 * kx), height: Math.round(300 * ky) },
          colorDelLapiz: pixel(s1.path, Math.round(120 * kx), Math.round(270 * ky)),
        };
        res.overlayCerrada = ov.win.isDestroyed();
        const antesUnsorted = listItems(UNSORTED).length;
        // D) Copy: va al portapapeles y no se guarda
        const prevClip = await clipboard.readText().catch(() => '');
        ov = await open(); await run(ov, `__test.select({ x: 100, y: 100, width: 300, height: 200 })`);
        await clipboard.clear();
        fire(ov, `__test.action('copy')`); await wait(1200);
        res.copy = { pngEnPortapapeles: await clipboard.has('image/png'), noSeGuardo: listItems(UNSORTED).length === antesUnsorted };
        await clipboard.writeText(prevClip).catch(() => {});
        // E) Save to tab… -> "Compras"
        ov = await open(); await run(ov, `__test.select({ x: 100, y: 100, width: 300, height: 200 })`);
        await run(ov, `__test.openTabs()`); await wait(400); await ovShot(ov, 'c4-menu-pestanas');
        res.menuPestanas = await run(ov, `[...document.querySelectorAll('#tabmenu button')].map(b => b.textContent)`);
        res.menuPosicion = await run(ov, `(() => { const m = document.querySelector('#tabmenu'), b = document.querySelector('#bar');
          const r = m.getBoundingClientRect(), br = b.getBoundingClientRect();
          return { visible: !m.hidden, top: Math.round(r.top), left: Math.round(r.left), alto: Math.round(r.height), barraAbajo: Math.round(br.bottom), pantalla: innerHeight }; })()`);
        const antesCompras = listItems('Compras').length;
        fire(ov, `__test.action('tab', 'Compras')`); await wait(1200);
        res.saveToTab = { nuevasEnCompras: listItems('Compras').length - antesCompras, noEnUnsorted: listItems(UNSORTED).length === antesUnsorted };
        // F) Save as… (en pruebas se guarda en un archivo fijo, sin abrir el diálogo)
        ov = await open(); await run(ov, `__test.select({ x: 50, y: 50, width: 200, height: 100 })`);
        fire(ov, `__test.action('saveas')`); await wait(1200);
        const sa = path.join(TEST, 'guardar-como.png');
        res.saveAs = { existe: fs.existsSync(sa), size: fs.existsSync(sa) && nativeImage.createFromPath(sa).getSize(), noEnUnsorted: listItems(UNSORTED).length === antesUnsorted };
        // G) Google Lens: se guarda en Unsorted y se arma la página (en pruebas no se abre ni se envía)
        ov = await open(); await run(ov, `__test.select({ x: 100, y: 100, width: 300, height: 200 })`);
        fire(ov, `__test.action('lens')`); await wait(1500);
        res.lens = { nuevasEnUnsorted: listItems(UNSORTED).length - antesUnsorted, paginasLens: fs.readdirSync(LENS_DIR).filter((f) => f.startsWith('lens-')).length };
        // H) Esc cancela sin guardar
        const antesEsc = listItems(UNSORTED).length;
        ov = await open(); await run(ov, `__test.select({ x: 100, y: 100, width: 300, height: 200 })`);
        fire(ov, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await wait(800);
        res.esc = { cerrada: ov.win.isDestroyed(), noGuardo: listItems(UNSORTED).length === antesEsc };
        res.tabs = await js('S.tabs.map(t => t.name + ":" + t.count)');
        await js(`selectTab('Unsorted')`); await wait(1200); await shot('c5-unsorted');
        // 4) Configuración
        await js('openSettings()'); await wait(600); await shot('c4-settings');
        res.accel = await js(`[accelFromEvent({ key: 's', code: 'KeyS', ctrlKey: true, altKey: true }),
                              accelFromEvent({ key: 'x', code: 'KeyX' }), accelFromEvent({ key: 'F8', code: 'F8' })]`);
        res.atajoValido = await js(`nv.saveSettings({ shortcut: 'Ctrl+Alt+Shift+F9' })`);
        res.atajoInvalido = await js(`nv.saveSettings({ shortcut: 'Ctrl+Nada' }).then(() => 'aceptado', (e) => e.message)`);
        res.segundoPlano = await js(`nv.saveSettings({ background: false, startup: true })`);
        await js('closeSettings()');
        // 5) La captura real de Windows responde (miniatura chiquita, no se guarda ni se muestra)
        const real = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 64, height: 36 } });
        res.capturaReal = { pantallas: real.length, conImagen: real.every((s) => !s.thumbnail.isEmpty()) };
      } catch (e) { res.error = String(e.stack || e); }
      res.errores = await js('window.__errors || []');
      fs.writeFileSync(path.join(TEST, 'captura.json'), JSON.stringify(res, null, 2));
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

// ------------------------------------------------------------------ Segundo plano (área de notificación)
const ICON_ICO = app.isPackaged ? path.join(process.resourcesPath, 'icon.ico') : path.join(__dirname, '..', 'build', 'icon.ico');
let tray = null;
let lastNotification = null;   // referencia para que no se libere antes del clic

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}

function quitApp() { quitting = true; app.quit(); }

function notify(title, body, onClick) {
  if (TEST || !Notification.isSupported()) return;
  lastNotification = new Notification({ title, body, icon: ICON_ICO, silent: true });
  if (onClick) lastNotification.on('click', onClick);
  lastNotification.show();
}

function backgroundNotice() {
  if (config.backgroundNoticeShown) return;
  config.backgroundNoticeShown = true; saveConfig();
  notify('NVTabs is still running',
    `It keeps running in the notification area${config.shortcut ? ` so ${config.shortcut} can take screenshots` : ''}. Right-click its icon to quit.`);
}

function updateTray() {
  if (TEST) return;
  if (config.background && !tray) {
    tray = new Tray(nativeImage.createFromPath(ICON_ICO));
    tray.setToolTip('NVTabs');
    tray.on('click', showWindow);
  }
  if (!config.background && tray) { tray.destroy(); tray = null; }
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open NVTabs', click: showWindow },
    { label: 'Take screenshot', accelerator: config.shortcut || undefined, registerAccelerator: false, click: () => startCapture() },
    { type: 'separator' },
    { label: 'Quit NVTabs', click: quitApp },
  ]));
}

// Atajo global de captura
let shortcutOk = true;
let shortcutError = '';   // 'invalid' = combinación no válida, 'taken' = la usa otra app o Windows
function applyShortcut() {
  globalShortcut.unregisterAll();
  shortcutOk = true; shortcutError = '';
  if (!config.shortcut) return true;
  try {
    shortcutOk = globalShortcut.register(config.shortcut, () => startCapture());
    if (!shortcutOk) shortcutError = 'taken';
  } catch { shortcutOk = false; shortcutError = 'invalid'; }
  return shortcutOk;
}

// El .exe es el de Electron (sin modificar, por Smart App Control), así que Windows mostraría
// "Electron" y su ícono en notificaciones y otros lugares. Se registra el nombre e ícono de NVTabs
// para su identificador de aplicación (solo afecta a NVTabs, en el registro del usuario).
function registerAppIdentity() {
  if (!app.isPackaged || TEST) return;
  const key = 'HKCU\\Software\\Classes\\AppUserModelId\\com.nvtabs.app';
  const add = (name, value) => execFile('reg', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }, () => {});
  add('DisplayName', 'NVTabs');
  add('IconUri', ICON_ICO);
}

// Iniciar con Windows (solo en la app instalada; arranca oculta en el área de notificación)
function applyStartup() {
  if (!app.isPackaged || TEST) return;
  app.setLoginItemSettings({ openAtLogin: !!config.startup, path: process.execPath, args: ['--hidden'] });
}

function settingsState() {
  return { shortcut: config.shortcut, shortcutOk, background: config.background, startup: config.startup, canStartup: app.isPackaged };
}

// ------------------------------------------------------------------ Captura de pantalla
// Al apretar el atajo se "congela" cada monitor en una ventana a pantalla completa; el usuario
// arrastra para elegir una zona (o hace clic para capturar todo el monitor) y se guarda en "Unsorted".
const UNSORTED = 'Unsorted';
const captureImages = new Map();   // id -> { jpeg (lo que se muestra), image (captura original) }
let overlays = [];                 // [{ win, display, image }]
let capturing = false;
let reopenAfterCapture = false;

async function grabScreens() {
  const displays = screen.getAllDisplays();
  if (TEST && process.env.NV_TEST_CAPTURE === 'fake') {   // pruebas: pantalla falsa, no se captura la real
    const img = nativeImage.createFromPath(path.join(TEST, 'pantalla-falsa.png'));
    return displays.slice(0, 1).map((display) => ({ display, image: img }));
  }
  const size = displays.reduce((m, d) => ({
    width: Math.max(m.width, Math.round(d.size.width * d.scaleFactor)),
    height: Math.max(m.height, Math.round(d.size.height * d.scaleFactor)),
  }), { width: 0, height: 0 });
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  return displays
    .map((display, i) => ({ display, image: (sources.find((s) => s.display_id === String(display.id)) || sources[i])?.thumbnail }))
    .filter((s) => s.image && !s.image.isEmpty());
}

async function startCapture({ fromApp = false } = {}) {
  if (capturing) return;
  capturing = true;
  try {
    // Desde el menú de la app: se esconde NVTabs para que no salga en la captura
    reopenAfterCapture = fromApp && win && !win.isDestroyed() && win.isVisible();
    if (reopenAfterCapture) { win.hide(); await new Promise((r) => setTimeout(r, 250)); }
    const shots = await grabScreens();
    if (!shots.length) throw new Error('No screen could be captured.');
    const cursor = screen.getCursorScreenPoint();
    overlays = shots.map(({ display, image }, idx) => {
      const id = `${Date.now()}-${idx}`;
      captureImages.set(id, { jpeg: image.toJPEG(92), image });   // JPEG solo para mostrar; el recorte final sale del original
      const w = new BrowserWindow({
        ...display.bounds, show: false, frame: false, resizable: false, movable: false, minimizable: false,
        maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
        enableLargerThanScreen: true, backgroundColor: '#000000',
        webPreferences: { preload: path.join(__dirname, 'capture', 'preload.js'), contextIsolation: true, sandbox: true },
      });
      w.setAlwaysOnTop(true, 'screen-saver');
      const { width: iw, height: ih } = image.getSize();
      w.loadFile(path.join(__dirname, 'capture', 'capture.html'), { query: { id, iw: String(iw), ih: String(ih) } });
      w.once('ready-to-show', () => {
        if (TEST) return;
        w.setBounds(display.bounds);   // Windows a veces ajusta el tamaño por la escala del monitor
        w.setFullScreen(true);         // cubre también la barra de tareas
        w.show();
        const b = display.bounds;
        if (cursor.x >= b.x && cursor.x < b.x + b.width && cursor.y >= b.y && cursor.y < b.y + b.height) w.focus();
      });
      return { win: w, display, image };
    });
  } catch (e) {
    endCapture();
    notify('Screenshot failed', e.message);
  }
}

function endCapture() {
  for (const o of overlays) if (!o.win.isDestroyed()) o.win.destroy();
  overlays = [];
  captureImages.clear();
  capturing = false;
  if (reopenAfterCapture) { reopenAfterCapture = false; showWindow(); }
}

function screenshotName(ext = 'png') {
  const d = new Date(); const pad = (x) => String(x).padStart(2, '0');
  return `Screenshot ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}.${ext}`;
}

// Guarda la captura en una pestaña de NVTabs ("Unsorted" por defecto)
async function saveScreenshot(img, tab = UNSORTED, { quiet = false } = {}) {
  const dir = tabDir(tab);
  if (!fs.existsSync(dir)) {
    await fsp.mkdir(dir, { recursive: true });
    if (!config.order.includes(tab)) { config.order = [...listTabNames().filter((n) => n !== tab), tab]; saveConfig(); }
  }
  const file = uniquePath(dir, screenshotName());
  await fsp.writeFile(file, img.toPNG());
  if (win && !win.isDestroyed()) win.webContents.send('items:changed', tab);
  if (!quiet) {
    notify('Screenshot saved', `Saved to "${tab}". Click to open it.`, () => {
      showWindow();
      win?.webContents.send('tab:goto', tab);
    });
  }
  return { name: path.basename(file), path: file };
}

// "Save as…": elegir carpeta y nombre en la PC (no se guarda en NVTabs)
async function saveScreenshotAs(img) {
  const defaultPath = path.join(config.saveAsDir && fs.existsSync(config.saveAsDir) ? config.saveAsDir : app.getPath('pictures'), screenshotName());
  let filePath;
  if (TEST) filePath = path.join(TEST, 'guardar-como.png');
  else {
    const r = await dialog.showSaveDialog({
      title: 'Save screenshot as', defaultPath,
      filters: [{ name: 'PNG image', extensions: ['png'] }, { name: 'JPEG image', extensions: ['jpg', 'jpeg'] }],
    });
    if (r.canceled || !r.filePath) return null;
    filePath = r.filePath;
  }
  const jpg = /\.jpe?g$/i.test(filePath);
  await fsp.writeFile(filePath, jpg ? img.toJPEG(92) : img.toPNG());
  config.saveAsDir = path.dirname(filePath); saveConfig();
  notify('Screenshot saved', `Saved to ${filePath}`, () => shell.showItemInFolder(filePath));
  return { name: path.basename(filePath), path: filePath };
}

function registerCaptureIpc() {
  // Pestañas para "Save to tab…"
  ipcMain.handle('capture:tabs', () => listTabNames());

  // Acción elegida en el menú del recorte.
  //   rect: zona en píxeles de la imagen (sin dibujos)   ó   png: imagen final con los dibujos
  //   action: 'unsorted' | 'lens' | 'copy' | 'tab' | 'saveas'
  ipcMain.handle('capture:action', async (e, { action, rect, png, tab } = {}) => {
    const o = overlays.find((x) => x.win.webContents === e.sender);
    if (!o) return null;
    let img;
    if (png) img = nativeImage.createFromBuffer(Buffer.from(png));
    else {
      const { width: iw, height: ih } = o.image.getSize();
      const x = Math.max(0, Math.min(iw - 1, Math.round(rect?.x || 0)));
      const y = Math.max(0, Math.min(ih - 1, Math.round(rect?.y || 0)));
      img = o.image.crop({ x, y, width: Math.max(1, Math.min(iw - x, Math.round(rect?.width || iw))), height: Math.max(1, Math.min(ih - y, Math.round(rect?.height || ih))) });
    }
    endCapture();   // la pantalla vuelve enseguida; lo demás sigue en segundo plano
    try {
      if (action === 'copy') {
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
        notify('Screenshot copied', 'Paste it anywhere with Ctrl+V.');
        return { copied: true };
      }
      if (action === 'saveas') return await saveScreenshotAs(img);
      if (action === 'lens') {   // se guarda también en "Unsorted" y se busca en Google Lens
        const saved = await saveScreenshot(img, UNSORTED, { quiet: true });
        saved.lens = await openInLens(saved.path);
        return saved;
      }
      if (action === 'tab' && tab && listTabNames().includes(tab)) return await saveScreenshot(img, tab);
      return await saveScreenshot(img, UNSORTED);
    } catch (err) {
      notify('Screenshot failed', err.message);
      return null;
    }
  });
  ipcMain.handle('capture:cancel', () => { endCapture(); });
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
  app.on('second-instance', () => showWindow());   // abrir NVTabs otra vez muestra la ventana existente

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
    registerCaptureIpc();
    createWindow();
    if (!TEST) { registerAppIdentity(); applyShortcut(); updateTray(); applyStartup(); }
  });

  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  // En segundo plano la app sigue viva aunque no haya ventanas (área de notificación + atajo)
  app.on('window-all-closed', () => { if (!config.background || TEST) app.quit(); });
}
