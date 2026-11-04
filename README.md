# stirling-pdf-app

A native-feeling desktop wrapper around [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF) — a FOSS
PDF toolkit (merge, split, compress, convert, OCR, watermark, and more). Stirling-PDF normally runs via Docker and
is used through a browser tab; this wraps it in Electron instead, so it opens as its own app window with no
Docker and no browser chrome.

## How it works

- `app/main.js` spawns the Stirling-PDF jar as a Java child process (`java -jar backend/Stirling-PDF.jar`),
  polls `http://localhost:8080` until it responds, then loads that URL into an Electron `BrowserWindow`.
- Closing the window kills the backend process — nothing lingers in the background.
- A named single-instance lock means launching the app twice just focuses the existing window instead of
  starting a second backend and fighting over port 8080.

## Requirements

- **Java 25** on the machine running the app — the released Stirling-PDF jar is built targeting Java 25
  specifically (confirmed via their `build.gradle`); older JDKs fail with an `UnsupportedClassVersionError`.
  [Eclipse Temurin](https://adoptium.net) is a good source if you don't have it.
- **Node.js** (for development/building only — not needed by an end user running a packaged release build).

## Development setup

```bash
./scripts/fetch-backend.sh      # downloads backend/Stirling-PDF.jar (not committed — ~300MB)
cd app
npm install
npm start
```

## Building a release locally

```bash
./scripts/fetch-backend.sh
cd app
npm install
npx electron-builder            # produces an installer for your current OS in app/dist/
```

Official Windows + Linux builds are produced by `.github/workflows/release.yml` on a GitHub Actions matrix
(`windows-latest` + `ubuntu-latest`), so you don't need both OSes locally to get both installers.

## Known limitations

- **Java must be installed separately.** Packaged builds bundle the Stirling-PDF jar but not a JRE — bundling a
  per-platform runtime is a potential follow-up, not done yet.
- **Optional Stirling-PDF features are disabled** unless their external tool is also installed and on `PATH`:
  OCR (Tesseract/OCRmyPDF), Office conversions (LibreOffice), some compress/repair/vector modes (Ghostscript,
  qpdf, ImageMagick), HTML/Markdown/URL-to-PDF (WeasyPrint), PDF-to-HTML (Poppler's `pdftohtml`), eBook
  conversion (Calibre). Stirling-PDF detects what's missing at startup and just disables those tools in its UI
  — everything else (merge, split, rotate, rearrange, basic compress, watermark, extract pages, password/
  metadata operations, etc.) works with nothing but the jar and Java.
