# Logos

Translate Confluence spaces (and all nested child pages) using an LLM, browse the
results in a desktop UI, generate AI summaries / notes, chat about images with a
vision model, and export everything as PDF.

Logos is a **pure Electron + TypeScript desktop app** — no Python backend, no
external server. Drop in a Confluence URL, log in once via SAML/SSO, and the app
crawls + translates everything locally.

---

## Features

- 🔐 **SAML/SSO auth** — Playwright opens a browser once, session cached for re-use
- 🌳 **Recursive crawl** — pulls a page and every descendant
- 🤖 **OpenAI-compatible translation** — works with any chat-completions endpoint (Ollama, OpenAI, Azure, Groq, etc.)
- 🧱 **Confluence macro support** — drawio / gliffy / lucidchart / plantuml / mermaid (rendered as images), info / note / warning / tip panels, expand, code, status, jira, layouts, ac:link, task lists, emoticons, and more
- 📋 **Page Summary** + 📝 **Important Notes** generated on demand with markdown rendering
- 🔍 **Hover-to-analyze images** — side-by-side modal with multi-turn vision-model chat and markdown responses
- 📄 **PDF export** — single combined PDF, or ZIP of per-page PDFs (native save dialog)
- 💾 **Translation cache** — SHA-256-keyed SQLite cache (`better-sqlite3`)
- ⚙️ **In-app Settings panel** — edit all config at runtime (no restart needed); live Ollama connection status and dynamic model dropdown

---

## Prerequisites

- **Node.js 18+** and **npm**
- An OpenAI-compatible LLM endpoint
  - Local: [Ollama](https://ollama.com) running at `http://localhost:11434/v1`
  - Cloud: OpenAI / Azure OpenAI / Groq / etc.
- Network access to your Confluence instance

---

## Quick Start (Development)

```bash
git clone <repo>
cd logos_app
(cd electron && npm install)   # installs main + renderer deps in one place,
                               # rebuilds better-sqlite3 against Electron's ABI,
                               # and downloads the Playwright Chromium

# Configure environment. The Electron app auto-loads, in order:
#   1. <projectRoot>/.env
#   2. <cwd>/.env
#   3. <userData>/.env
# Existing process.env values always win over file values.
cat > .env <<'EOF'
CONFLUENCE_BASE_URL=https://your-confluence-host.example.com
LLM_API_KEY=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=gemma4
LLM_VISION_MODEL=gemma4
TARGET_LANGUAGE=en
MAX_CONCURRENT_PAGES=5
EOF

npm run dev                    # starts vite (5173) + electron with HMR
```

The first time you submit a job, Playwright opens a Chromium window so you can
complete SSO; cookies are persisted under `~/Library/Application
Support/Logos/browser_session/`.

---

## Building & Packaging

```bash
npm run build                  # type-check + bundle frontend + compile electron
npm run package                # produces a .dmg under electron/release/
```

`electron-builder` is configured to:

- Unpack `playwright`, `playwright-core`, and `better-sqlite3` from the asar
  (native binaries cannot be loaded from inside an asar)
- Run `electron-rebuild` against `better-sqlite3` on `npm install`
- Install Chromium with `PLAYWRIGHT_BROWSERS_PATH=0` so it lands inside
  `node_modules/playwright` and is bundled into the app

---

## Configuration

All settings are read from environment variables, populated either from a
`.env` file (auto-loaded by [`electron/src/loadEnv.ts`](electron/src/loadEnv.ts))
or from the real shell environment (which always wins).

| Variable               | Default                                 | Purpose                                     |
| ---------------------- | --------------------------------------- | ------------------------------------------- |
| `CONFLUENCE_BASE_URL`  | _(required)_                            | Base URL of your Confluence instance        |
| `LLM_API_KEY`          | _(required)_                            | API key for the LLM endpoint                |
| `LLM_BASE_URL`         | `https://models.inference.ai.azure.com` | OpenAI-compatible chat completions endpoint |
| `LLM_MODEL`            | `gpt-4o`                                | Text translation + summary/notes model      |
| `LLM_VISION_MODEL`     | _(falls back to `LLM_MODEL`)_           | Multimodal model for image analysis         |
| `TARGET_LANGUAGE`      | `en`                                    | Target language code                        |
| `MAX_CONCURRENT_PAGES` | `5`                                     | Parallel translation workers                |

Settings can also be changed at runtime via the **⚙️ gear icon** in the app header — changes apply immediately without restarting. The Settings panel also shows a live Ollama connection status indicator and populates model dropdowns from `/api/tags` when Ollama is reachable.

Caches and persistent state (translation cache, browser session) live under
`app.getPath('userData')`:

- macOS: `~/Library/Application Support/Logos/`
- Windows: `%APPDATA%\Logos\`
- Linux: `~/.config/Logos/`

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                Renderer (React)                  │
│  components/  hooks/  services/api.ts            │
│         │                                        │
│         │  window.electronAPI.* (IPC)            │
│         ▼                                        │
├──────────────────────────────────────────────────┤
│         Preload (contextIsolation bridge)        │
│   snake_case ↔ camelCase key conversion          │
├──────────────────────────────────────────────────┤
│              Main process (Node)                 │
│  ipc.ts    ─→ jobs.ts  ─→ {auth, confluence,     │
│                            crawler, translator,  │
│                            cache, pdfGenerator,  │
│                            llmHelpers}           │
│  imageProtocol.ts  (logos-image://<job>/<url>)   │
│  jobEvents (EventEmitter) → webContents.send     │
└──────────────────────────────────────────────────┘
```

- **No HTTP server.** What used to be `/api/*` endpoints are now `ipcMain.handle`
  channels in [`electron/src/ipc.ts`](electron/src/ipc.ts).
- **No WebSocket.** Progress updates are pushed via
  `webContents.send('job:progress', ...)`.
- **No image proxy endpoint.** Authenticated Confluence images are served via a
  custom `logos-image://` protocol scheme registered as privileged with
  `bypassCSP` and cookie support.

---

## Tech Stack

- **Shell**: Electron 33, electron-builder 25
- **Renderer**: React 19, TypeScript, Vite 6 (lives under `electron/renderer/`)
- **Main process**: TypeScript, Playwright 1.59 (Chromium for SAML + PDF), cheerio (xmlMode for namespaced Confluence storage format), better-sqlite3, openai SDK, jszip

---

## Project Layout

```
logos_app/
├── electron/                    # The whole desktop app (single npm package)
│   ├── src/                     # Main process (Node side, compiled to dist/)
│   │   ├── main.ts              # BrowserWindow + lifecycle
│   │   ├── loadEnv.ts           # .env auto-loader
│   │   ├── preload.ts           # contextBridge → window.electronAPI
│   │   ├── ipc.ts               # ipcMain.handle channels
│   │   ├── imageProtocol.ts     # logos-image:// custom scheme
│   │   ├── config.ts
│   │   ├── services/            # auth, confluence, crawler, translator, cache,
│   │   │                       # pdfGenerator, imageHelpers, llmHelpers, jobs
│   │   ├── utils/               # urlParser, htmlProcessor, confluenceMacros
│   │   └── types/index.ts
│   ├── renderer/                # React renderer (DOM side, bundled by Vite)
│   │   ├── index.html
│   │   └── src/
│   │       ├── App.tsx          # Root component; header with Ollama dot + settings gear
│   │       ├── components/      # PageTree, TranslatedView, ImageAnalysis, Settings, Markdown
│   │       ├── hooks/           # useJobProgress (IPC event listener)
│   │       ├── services/api.ts  # window.electronAPI wrappers
│   │       └── types/
│   ├── vite.config.ts           # root: ./renderer, outDir: ./dist/renderer
│   ├── tsconfig.json            # Main process (Node lib)
│   ├── tsconfig.renderer.json   # Renderer (DOM lib)
│   └── package.json             # All deps live here — single node_modules
└── package.json                 # Thin pass-through to electron/ scripts
```

---

## Troubleshooting

| Problem                                        | Fix                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `electronAPI is not available`                 | Preload didn't load — make sure `npm run build` produced `electron/dist/preload.js`                                                                                                                                                                         |
| `LLM authentication failed (401…)`             | `.env` is missing or `LLM_API_KEY` is wrong. Watch for `[env] loaded: …` line in the dev console                                                                                                                                                            |
| `LLM endpoint unreachable`                     | Start your LLM server (`ollama serve`) or check `LLM_BASE_URL`                                                                                                                                                                                              |
| Browser opens every job                        | Session cookies expired — log in again; cookies cached under `userData/browser_session/`                                                                                                                                                                    |
| `better-sqlite3` ABI mismatch on launch        | `cd electron && ./node_modules/.bin/electron-rebuild -f -w better-sqlite3`                                                                                                                                                                                  |
| `browserType.launch: Executable doesn't exist` | `cd electron && npm run install-browsers` (or `npx playwright install chromium` from the workspace root)                                                                                                                                                    |
| `npm install` skipped postinstall              | Run `npm install` again _without_ `--ignore-scripts`, or trigger the hooks manually:<br>`cd electron && ./node_modules/.bin/electron-rebuild -f -w better-sqlite3`<br>`cd .. && PLAYWRIGHT_BROWSERS_PATH=0 ./node_modules/.bin/playwright install chromium` |
| Translation extremely slow                     | Lower `MAX_CONCURRENT_PAGES` or use a smaller model                                                                                                                                                                                                         |
