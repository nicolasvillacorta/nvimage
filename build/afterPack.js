// Compilaciones SIN firma: deja NVTabs.exe idéntico al electron.exe oficial.
//
// electron-builder escribe un checksum del app.asar dentro del .exe en cada compilación
// (incluso con signAndEditExecutable: false). Eso cambia la "huella" del ejecutable y
// Smart App Control de Windows 11 lo bloquea por ser un programa nuevo y desconocido.
// El electron.exe oficial sí es reconocido por Windows, así que lo copiamos encima.
// (Se usa afterPack porque afterSign no se ejecuta cuando no hay firma.)
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (context.packager.platformSpecificBuildOptions.signAndEditExecutable !== false) return;

  const original = path.join(path.dirname(require.resolve('electron/package.json')), 'dist', 'electron.exe');
  const target = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  fs.copyFileSync(original, target);
  console.log('  - NVTabs.exe = electron.exe oficial (compilacion sin firma)');
};
