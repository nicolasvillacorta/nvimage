# NVTabs

**English** · [Español](README.es.md)

A free and open source Windows desktop app to view and organize your photos and notes in tabs
(for example "Sales", "Purchases", "Clients"...). Everything stays on your computer: the only time NVTabs goes online is when you choose *Search with Google Lens*.

## Try it

NVTabs runs on **Windows 10 and 11**. There are two ways to try it:

### Option 1: download a ready-to-use version

Go to [**Releases**](https://github.com/nicolasvillacorta/nvtabs/releases) and download one of these files
from the latest version:

- **`NVTabs-Portable-<version>.zip`** (recommended): extract the folder anywhere you like (for example
  `Documents\NVTabs-app`) and double-click `NVTabs.exe`. Don't run it from inside the .zip.
  Nothing gets installed; to remove it, just delete the folder.
- **`NVTabs-Setup-<version>.exe`**: installer that creates shortcuts on the Desktop and in the Start menu.

> **Heads-up: builds are not digitally signed yet.**
> - Windows may show *"Windows protected your PC"*: click **More info → Run anyway**.
> - On PCs with **Smart App Control** turned on, the installer will be blocked. Use the **portable .zip** instead:
>   `NVTabs.exe` is the unmodified official Electron executable, which Windows already recognizes.

### Option 2: run it from the source code

You need [Git](https://git-scm.com/) and [Node.js](https://nodejs.org/) 24 or newer. Then, in a terminal:

```bash
git clone https://github.com/nicolasvillacorta/nvtabs.git
cd nvtabs
npm install
npm start
```

This opens the app directly from the code, and it works even with Smart App Control turned on.
Your photos and notes are saved in `Documents\NVTabs` either way.

## How to use it

- **Tabs:** `+` or `Ctrl+T` to create one · double-click to rename · right-click for more options · drag to reorder.
- **Add photos and notes:** the *Add files* button (`Ctrl+O`), drag files or folders onto the window (or onto another tab),
  or paste with `Ctrl+V` (a screenshot, a copied image, copied text, or files copied in File Explorer).
  Files are **copied** into the tab's folder; the originals stay where they were.
- **Notes:** *New note* (`Ctrl+N`) creates one, and its first line becomes its name. You can also add text files
  (`.txt`, `.md`, `.log`, `.csv`, `.json`...) or paste copied text with `Ctrl+V`. Click a note to read and edit it
  (it saves automatically). Right-click any photo or note → *Open with…* to use another app.
- **Move between tabs:** right-click → *Move to* → the destination tab, or drag a photo or note onto another tab's name.
  If it's selected together with others, they all move.
- **Google Lens:** right-click a photo → *Search with Google Lens* (or the *Google Lens* button / `L` in the full-size view).
  It opens a new tab in your browser with the Lens results for that image.
- **Screenshots** (inspired by Flameshot): press `Ctrl+Alt+S` anywhere in Windows (configurable) and drag to select an
  area, or click to capture the whole screen. The screen stays frozen and a toolbar appears next to your selection:
  - **Draw on it** before saving: pen, highlighter, arrow, rectangle and text notes, in several colors (`Ctrl+Z` undoes).
  - **Save to Unsorted** (`Enter` or double-click), **Search with Google Lens** (also saves it to Unsorted),
    **Copy** (`Ctrl+C`), **Save to tab…** (any other NVTabs tab) or **Save as…** (`Ctrl+S`, any folder on your PC).
  - `Esc` cancels.
- **Runs in the background:** closing the window keeps NVTabs in the notification area (next to the clock) so the
  shortcut always works. Quit it from its icon or from `⋯` → *Quit NVTabs*. In `⋯` → *Settings* (`Ctrl+,`) you can
  change the shortcut, turn off the background mode, or make NVTabs start with Windows.
- **View full size:** click a photo · `←` `→` or the mouse wheel to browse · `Esc` to close.
- **Select:** each photo's circle, `Ctrl+click`, `Shift+click` or `Ctrl+A` · `Del` to delete.
- **Theme:** `⋯` menu → *Theme* → System, Light or Dark.
- Deleted photos and tabs go to the **Recycle Bin**.

Photos and notes are stored in `Documents\NVTabs\<tab>\` (each tab is a regular folder, so you can also browse it
in File Explorer). Settings and thumbnails are stored in `%APPDATA%\NVTabs`.

## Development

Requires [Node.js](https://nodejs.org/) 24 or newer.

```bash
npm install
npm start                # run the app in development mode
npm run build            # installer:  dist\NVTabs-Setup-<version>.exe
npm run build:portable   # portable:   dist\NVTabs-Portable-<version>.zip
npm run icons            # regenerate build\icon.png and build\icon.ico from src\renderer\icon.svg
```

| Folder / file | Contents |
|---|---|
| `src/main.js` | Main process: files, tabs, notes, thumbnails, clipboard, Google Lens, screenshots, notification area, settings |
| `src/preload.js` | Secure bridge between the UI and the main process |
| `src/renderer/` | User interface (HTML, CSS and JavaScript, no frameworks) |
| `src/capture/` | Full-screen screenshot overlay: area selection, drawing tools and the action toolbar |
| `build/` | Icons, icon generator, build hooks and installer script |
| `.github/workflows/release.yml` | Automated build, signing and release on GitHub |
| `.github/signpath/` | Artifact configurations for SignPath |
| `version-powershell/` | First version (PowerShell script), kept for reference |

**Automated tests:** with the environment variable `NV_TEST=<folder>`, the app uses test data from that folder
(including fake Documents/Pictures/AppData folders), takes screenshots of the main screens and closes itself
(see `runTest` in `src/main.js`). Add one of these variables to test a specific feature:

| Variable | Tests |
|---|---|
| `NV_TEST_NOTES=1` | Notes: import, old encodings, editor, automatic names, pasting text |
| `NV_TEST_MOVE=1` | Moving photos and notes between tabs (menu and drag & drop) |
| `NV_TEST_PASTE=<mode>` | Pasting from the clipboard (`archivos`, `imagen`, `copy`) |
| `NV_TEST_CAPTURE=fake` | Screenshots with a fake screen (`<folder>\pantalla-falsa.png`): toolbar, drawing, every action, settings |

### Publishing a release

1. Bump `version` in `package.json`.
2. Create and push the tag `v<version>` (for example `v1.1.1`).
3. GitHub Actions builds, signs (if SignPath is configured) and creates a draft Release to review and publish.

### Smart App Control and code signing

Windows 11 with Smart App Control blocks unknown, unsigned programs. That's why unsigned builds keep `NVTabs.exe`
byte-identical to the official Electron executable (`signAndEditExecutable: false` plus `build/afterPack.js`),
and the icon is applied to the shortcuts by `build/installer.nsh`.

Code signing through [SignPath Foundation](https://signpath.org/) is **planned but not active yet**: releases are
currently unsigned. The release workflow is already prepared and starts signing automatically once SignPath is
configured (see the [code signing policy](CODE_SIGNING_POLICY.md)).

## License

[MIT](LICENSE) © 2026 Nicolas Villacorta

Feedback and bug reports are welcome in [Issues](https://github.com/nicolasvillacorta/nvtabs/issues).
