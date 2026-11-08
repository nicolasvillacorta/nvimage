// Genera build/icon.png (512 px) y build/icon.ico (16-256 px) a partir de src/renderer/icon.svg.
// Uso:  npx electron build/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SVG = path.join(__dirname, '..', 'src', 'renderer', 'icon.svg');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];

function buildIco(pngs) {
  // Formato ICO con imágenes PNG embebidas (soportado desde Windows Vista)
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const sizes = [...ICO_SIZES, 512];
  // Dibuja el SVG en un canvas de cada tamaño (fondo transparente) y devuelve PNG en base64
  const out = await win.webContents.executeJavaScript(`(async () => {
    const url = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(svg).toString('base64'))};
    const img = new Image(); img.src = url; await img.decode();
    const res = {};
    for (const s of ${JSON.stringify(sizes)}) {
      const c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, s, s);
      res[s] = c.toDataURL('image/png').split(',')[1];
    }
    return res;
  })()`);
  const png = (s) => Buffer.from(out[s], 'base64');
  fs.writeFileSync(path.join(__dirname, 'icon.png'), png(512));
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), buildIco(ICO_SIZES.map((size) => ({ size, data: png(size) }))));
  console.log('icon.png e icon.ico generados');
  app.quit();
});
