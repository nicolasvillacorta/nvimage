// Compilaciones SIN firma: deja NVTabs.exe idéntico al electron.exe oficial.
//
// electron-builder escribe un checksum del app.asar dentro del .exe en cada compilación
// (incluso con signAndEditExecutable: false). Eso cambia la "huella" del ejecutable y
// Smart App Control de Windows 11 lo bloquea por ser un programa nuevo y desconocido.
// El electron.exe oficial sí es reconocido por Windows, así que lo copiamos encima.
// (Se usa afterPack porque afterSign no se ejecuta cuando no hay firma.)
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  if (context.packager.platformSpecificBuildOptions.signAndEditExecutable !== false) return;

  const electronDir = path.dirname(require.resolve('electron/package.json'));
  const original = path.join(electronDir, 'dist', 'electron.exe');
  // Electron descarga su ejecutable recién la primera vez que se usa (no en "npm install");
  // en GitHub Actions todavía no existe, así que se descarga con su propio instalador.
  if (!fs.existsSync(original)) {
    console.log('  - descargando electron.exe oficial...');
    execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { cwd: electronDir, stdio: 'inherit' });
  }
  const target = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  fs.copyFileSync(original, target);
  console.log('  - NVTabs.exe = electron.exe oficial (compilacion sin firma)');
};
