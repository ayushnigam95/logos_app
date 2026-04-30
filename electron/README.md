# `electron/` — Logos desktop app

This is the entire Logos desktop app: Electron main process **and** the React
renderer, in a single npm package. There is no separate `frontend/` workspace.

It owns:

- All long-running work (Confluence auth, crawl, translation, PDF rendering, vision analysis)
- The IPC surface exposed to the renderer through [`src/preload.ts`](src/preload.ts)
- The renderer source under [`renderer/`](renderer/) (built by Vite to `dist/renderer/`)
- A custom privileged `logos-image://` protocol scheme used by the renderer to load authenticated Confluence images without an HTTP proxy

This package replaces the original FastAPI backend — there is no HTTP server.

---

## Layout

```
electron/
├── src/                       # MAIN process (Node, lib: ES2022 + DOM types only for fetch)
│   ├── main.ts                # BrowserWindow + lifecycle
│   ├── loadEnv.ts             # Reads <root>/.env, <cwd>/.env, <userData>/.env
│   ├── preload.ts             # contextBridge → window.electronAPI (with snake/camel conv.)
│   ├── ipc.ts                 # All ipcMain.handle handlers
│   ├── imageProtocol.ts       # logos-image:// custom scheme
│   ├── config.ts              # Settings from process.env (after loadDotEnv runs)
│   ├── services/
│   │   ├── auth.ts            # SAML via Playwright launchPersistentContext
│   │   ├── confluence.ts      # Confluence REST client (fetch + cookies)
│   │   ├── crawler.ts         # Recursive page-tree crawler with semaphore
│   │   ├── translator.ts      # Chunked text-node translation (OpenAI SDK)
│   │   ├── cache.ts           # SHA-256-keyed SQLite cache (better-sqlite3)
│   │   ├── pdfGenerator.ts    # Playwright Chromium PDF rendering + ZIP
│   │   ├── imageHelpers.ts    # Image URL rewriting + base64 embedding for PDFs
│   │   ├── llmHelpers.ts      # Page summary / notes / vision analysis
│   │   └── jobs.ts            # Job orchestration + EventEmitter (replaces /api/jobs)
│   ├── utils/
│   │   ├── urlParser.ts           # Cloud + DC + viewpage.action URL parsing
│   │   ├── htmlProcessor.ts       # extractTextNodes / replaceTextNodes (cheerio)
│   │   └── confluenceMacros.ts    # ~600 LOC ac:* / ri:* preprocessing
│   └── types/index.ts         # Shared types (camelCase)
├── renderer/                  # RENDERER (React, lib: DOM, jsx)
│   ├── index.html             # Vite entry point
│   └── src/
│       ├── main.tsx           # React mount
│       ├── App.tsx
│       ├── components/        # UrlInput, ProgressTracker, PageTree, PageViewer, PdfDownload
│       ├── hooks/useWebSocket.ts  # IPC listener (name kept for historical reasons)
│       ├── services/api.ts    # Thin wrapper over window.electronAPI
│       ├── types/index.ts     # snake_case API shape
│       ├── styles.css
│       ├── vite-env.d.ts      # Window.electronAPI typing
│       └── test/              # vitest + @testing-library/react
├── vite.config.ts             # root: ./renderer, outDir: ./dist/renderer
├── tsconfig.json              # Main process compiler config
├── tsconfig.renderer.json     # Renderer type-check config (noEmit)
├── package.json               # All deps (Electron, React, Vite, Playwright, …)
└── dist/                      # Build output (gitignored)
    ├── main.js                # tsc output
    ├── preload.js
    └── renderer/              # vite build output (loaded via file:// in production)
```

The **two TS configs** keep DOM/Node libs from polluting each other:

- `tsconfig.json` (`include: src`, `lib: [ES2022, DOM]`, emits CommonJS to `dist/`) — main process.
- `tsconfig.renderer.json` (`include: renderer`, `lib: [DOM, DOM.Iterable]`, `noEmit`, `jsx: react-jsx`) — renderer; Vite handles the actual build.

---

## Module → channel map

The renderer never talks to Node directly. Every capability is reachable via
`window.electronAPI.*`, which dispatches to `ipcMain.handle` channels in
[`src/ipc.ts`](src/ipc.ts):

| Renderer call (`window.electronAPI.*`) | IPC channel           | Backed by                                               |
| -------------------------------------- | --------------------- | ------------------------------------------------------- |
| `createJob(req)`                       | `job:create`          | `jobs.startJob`                                         |
| `getJobStatus(id)`                     | `job:get`             | `jobs.listJob`                                          |
| `getJobPages(id)`                      | `job:pages`           | `jobs.getResults`                                       |
| `cancelJob(id)`                        | `job:cancel`          | `jobs.cancelJob`                                        |
| `getTranslatedPage(id, pid)`           | `page:get`            | `confluenceMacros` + image rewrite                      |
| `getPageSummary(id, pid)`              | `page:summary`        | `llmHelpers.generatePageSummary`                        |
| `getPageNotes(id, pid)`                | `page:notes`          | `llmHelpers.generatePageNotes`                          |
| `analyzeImage(id, url, opts)`          | `image:analyze`       | `llmHelpers.analyzeImage`                               |
| `exportPagePdf(id, pid)`               | `export:pagePdf:save` | `pdfGenerator.generatePdfFromPage` + native save dialog |
| `exportJobPdf(id, mode)`               | `export:jobPdf:save`  | `pdfGenerator.generateCombinedPdf` / `generatePdfZip`   |
| _(push events)_ `onJobProgress`        | `job:progress`        | `jobEvents` EventEmitter → `webContents.send`           |

The preload layer also performs **automatic snake_case ↔ camelCase conversion**
on every payload, so the renderer keeps its existing FastAPI-flavoured types
unchanged.

---

## Custom protocols

[`src/imageProtocol.ts`](src/imageProtocol.ts) registers `logos-image://` as a
**privileged** scheme (`standard`, `secure`, `supportFetchAPI`, `bypassCSP`) at
app startup, then resolves URLs of the form:

```
logos-image://<jobId>/<percent-encoded-confluence-url>
```

…by fetching the underlying Confluence URL with the job's cached cookies and
streaming the body back to the renderer. Same-origin to the Confluence host is
enforced. This replaces the legacy `/api/images/{job_id}?url=…` proxy endpoint.

---

## Environment

All configuration is read from `process.env` after [`loadEnv.ts`](src/loadEnv.ts)
runs. Search order (first hit wins per key, real `process.env` always wins over
file values):

1. `<projectRoot>/.env`
2. `<cwd>/.env`
3. `<userData>/.env`

See the [root README](../README.md#configuration) for the full variable list.

---

## Scripts

Run from `electron/` (or via the pass-through scripts at the project root):

```bash
npm install                # installs everything; postinstall handles native rebuild + chromium
npm run dev                # tsc main + concurrently { vite, wait-on 5173 + electron }
npm run build              # build:main (tsc) + build:renderer (vite build)
npm run start              # cross-env NODE_ENV=production electron dist/main.js
npm run test               # vitest run (renderer tests under renderer/src/test/)
npm run typecheck:renderer # tsc -p tsconfig.renderer.json (no emit)
npm run rebuild-native     # electron-rebuild -f -w better-sqlite3
npm run install-browsers   # PLAYWRIGHT_BROWSERS_PATH=0 playwright install chromium
npm run package            # build + electron-builder --mac --x64 --arm64 → release/*.dmg
npm run package:all        # build + electron-builder -mwl
npm run clean              # rimraf dist release
```

`postinstall` runs `rebuild-native` and `install-browsers` automatically, so a
plain `npm install` is enough on a fresh checkout.

---

## Native dependencies & packaging

- **`better-sqlite3`** — must be rebuilt against Electron's Node ABI; the
  `postinstall` hook handles that. If you ever see `was compiled against a
different Node.js version`, run `./node_modules/.bin/electron-rebuild -f -w
better-sqlite3`.
- **Playwright Chromium** — downloaded into `node_modules/playwright-core/.local-browsers/`
  (because the install runs with `PLAYWRIGHT_BROWSERS_PATH=0`). At runtime,
  `main.ts` re-asserts `process.env.PLAYWRIGHT_BROWSERS_PATH = '0'` before any
  Playwright module is imported, so the bundled binary is always found.
- **`electron-builder`** is configured with `asarUnpack` for `playwright`,
  `playwright-core`, and `better-sqlite3` — native binaries can't be loaded
  from inside an asar archive.

---

## Tests / smoke tests

Vitest + `@testing-library/react` for the renderer. Tests live under
[`renderer/src/test/`](renderer/src/test/) and stub `window.electronAPI`
per-test. Run with `npm test`.

There are no formal unit tests for the main-process code yet. Hand-validated
smoke tests to date:

- `confluenceMacros.preprocessConfluenceHtml` against representative storage-format snippets (layouts, panels, status, `ac:image`, emoticons)
- `cache` CRUD round-trip against a temp SQLite file
- `pdfGenerator.renderPdf` rendering a small HTML doc to a Buffer
