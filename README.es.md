# NVTabs

[English](README.md) · **Español**

App de escritorio para Windows, gratuita y de código abierto, para ver y organizar tus fotos y notas en pestañas
(por ejemplo "Ventas", "Compras", "Clientes"...). Todo queda en tu computadora: lo único que se conecta a internet es
*Search with Google Lens*, y solo cuando lo eliges.

> La app está en inglés. En esta guía los nombres de botones y menús aparecen tal como se ven en la app.

## Cómo probarla

NVTabs funciona en **Windows 10 y 11**. Hay dos formas de probarla:

### Opción 1: descargar una versión lista para usar

Entra a [**Releases**](https://github.com/nicolasvillacorta/nvtabs/releases) y descarga uno de estos archivos de la
última versión:

- **`NVTabs-Portable-<versión>.zip`** (recomendada): descomprime la carpeta donde quieras (por ejemplo
  `Documentos\NVTabs-app`) y haz doble clic en `NVTabs.exe`. No la abras desde adentro del .zip.
  No se instala nada; para quitarla, borra la carpeta.
- **`NVTabs-Setup-<versión>.exe`**: instalador que crea accesos directos en el Escritorio y en el menú Inicio.

> **Importante: las versiones todavía no están firmadas digitalmente.**
> - Windows puede mostrar *"Windows protegió su PC"*: haz clic en **Más información → Ejecutar de todas formas**.
> - En las PCs con **Control inteligente de aplicaciones** (Smart App Control) activado, el instalador queda bloqueado.
>   Usa el **.zip portable**: su `NVTabs.exe` es el ejecutable oficial de Electron sin modificar, que Windows ya conoce.

### Opción 2: ejecutarla desde el código

Necesitas [Git](https://git-scm.com/) y [Node.js](https://nodejs.org/) 24 o superior. Después, en una terminal:

```bash
git clone https://github.com/nicolasvillacorta/nvtabs.git
cd nvtabs
npm install
npm start
```

Así se abre la app directamente desde el código, y funciona aunque el Control inteligente de aplicaciones esté activado.
En los dos casos, tus fotos y notas se guardan en `Documentos\NVTabs`.

## Cómo se usa

- **Pestañas:** `+` o `Ctrl+T` para crear una · doble clic para renombrar · clic derecho para más opciones ·
  arrastrarlas para cambiar el orden.
- **Agregar fotos y notas:** botón *Add files* (`Ctrl+O`), arrastrar archivos o carpetas a la ventana (o sobre otra
  pestaña), o pegar con `Ctrl+V` (una captura de pantalla, una imagen copiada, texto copiado o archivos copiados en el
  Explorador). Los archivos se **copian** a la carpeta de la pestaña; los originales quedan donde estaban.
- **Notas:** *New note* (`Ctrl+N`) crea una, y su primera línea se vuelve su nombre. También puedes agregar archivos de
  texto (`.txt`, `.md`, `.log`, `.csv`, `.json`...) o pegar texto copiado con `Ctrl+V`. Haz clic en una nota para
  leerla y editarla (se guarda sola). Con clic derecho sobre cualquier foto o nota → *Open with…* puedes abrirla con
  otra aplicación.
- **Mover entre pestañas:** clic derecho → *Move to* → la pestaña de destino, o arrastra la foto o nota sobre el
  nombre de otra pestaña. Si está seleccionada junto con otras, se mueven todas.
- **Google Lens:** clic derecho en una foto → *Search with Google Lens* (o el botón *Google Lens* / la tecla `L` en la
  vista en grande). Se abre una pestaña en tu navegador con los resultados de Lens para esa imagen.
- **Capturas de pantalla** (inspiradas en Flameshot): presiona `Ctrl+Alt+S` en cualquier parte de Windows (se puede
  cambiar) y arrastra para elegir una zona, o haz clic para capturar la pantalla completa. La pantalla queda congelada
  y aparece una barra junto a tu selección:
  - **Dibujar encima** antes de guardar: lápiz, resaltador, flecha, rectángulo y notas de texto, en varios colores
    (`Ctrl+Z` deshace).
  - **Save to Unsorted** (`Enter` o doble clic) la guarda en la pestaña "Unsorted"; **Search with Google Lens** la
    busca en Lens (y también la guarda en "Unsorted"); **Copy** (`Ctrl+C`) la copia al portapapeles;
    **Save to tab…** la guarda en otra pestaña de NVTabs; **Save as…** (`Ctrl+S`) la guarda en cualquier carpeta de
    tu PC.
  - `Esc` cancela.
- **Sigue funcionando en segundo plano:** al cerrar la ventana, NVTabs queda en el área de notificación (junto al
  reloj) para que el atajo siempre funcione. Para cerrarla del todo: clic derecho en su ícono → *Quit NVTabs*, o
  `⋯` → *Quit NVTabs*. En `⋯` → *Settings* (`Ctrl+,`) puedes cambiar el atajo, desactivar el segundo plano o hacer
  que NVTabs se inicie con Windows.
- **Ver en grande:** clic en una foto · `←` `→` o la rueda del mouse para pasar · `Esc` para cerrar.
- **Seleccionar:** el círculo de cada foto, `Ctrl+clic`, `Shift+clic` o `Ctrl+A` · `Supr` para borrar.
- **Tema:** menú `⋯` → *Theme* → System (el de Windows), Light (claro) o Dark (oscuro).
- Las fotos, notas y pestañas que borres van a la **Papelera de reciclaje**.

Las fotos y notas se guardan en `Documentos\NVTabs\<pestaña>\` (cada pestaña es una carpeta común, así que también
puedes verlas desde el Explorador). La configuración y las miniaturas están en `%APPDATA%\NVTabs`.

## Desarrollo

La guía para desarrolladores (cómo compilar, estructura del código, pruebas automáticas y cómo publicar versiones)
está en inglés, en la sección [Development del README](README.md#development).

## Licencia

[MIT](LICENSE) © 2026 Nicolas Villacorta

Las sugerencias y los reportes de errores son bienvenidos en [Issues](https://github.com/nicolasvillacorta/nvtabs/issues).
