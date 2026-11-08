// Puente seguro entre la interfaz y el proceso principal
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

contextBridge.exposeInMainWorld('nv', {
  state: () => call('state'),
  tabs: () => call('tabs'),
  photos: (tab) => call('photos', tab),

  createTab: (name) => call('tab:create', name),
  renameTab: (oldName, name) => call('tab:rename', oldName, name),
  deleteTab: (name) => call('tab:delete', name),
  reorderTabs: (names) => call('tab:reorder', names),
  selectTab: (name) => call('tab:select', name),
  openTabFolder: (name) => call('tab:open', name),

  addPhotos: (tab, paths) => call('photos:add', tab, paths),
  pickPhotos: (tab) => call('photos:pick', tab),
  pastePhotos: (tab) => call('photos:paste', tab),
  deletePhotos: (paths, ask = true) => call('photos:delete', paths, ask),

  openPhoto: (p) => call('photo:open', p),
  revealPhoto: (p) => call('photo:reveal', p),
  copyPhoto: (p) => call('photo:copy', p),
  openWith: (p) => call('file:openWith', p),
  moveItems: (paths, tab) => call('items:move', paths, tab),

  createNote: (tab) => call('note:create', tab),
  readNote: (p) => call('note:read', p),
  writeNote: (p, text, enc) => call('note:write', p, text, enc),
  autonameNote: (p, text) => call('note:autoname', p, text),
  copyNote: (p) => call('note:copy', p),

  setSize: (size) => call('config:size', size),
  setTheme: (theme) => call('theme:set', theme),
  menu: (items) => call('menu', items),
  viewerMode: (on) => call('overlay', !!on),
  about: () => call('about'),
  openLink: (id) => call('link', id),

  pathForFile: (file) => webUtils.getPathForFile(file),
  onFocus: (cb) => ipcRenderer.on('window:focus', () => cb()),
});
