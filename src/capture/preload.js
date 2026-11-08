// Puente de la ventana de captura: elegir la acción para el recorte, pedir las pestañas o cancelar
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nvCapture', {
  action: (payload) => ipcRenderer.invoke('capture:action', payload),
  tabs: () => ipcRenderer.invoke('capture:tabs'),
  cancel: () => ipcRenderer.invoke('capture:cancel'),
});
