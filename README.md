# Logos

Translate Confluence spaces (and all nested child pages) into English using a **local LLM** via Ollama. Browse the translated pages in a web UI, generate AI summaries and important-notes, hover over any image to chat with a vision model about it, and export everything as PDF.

---

## Features

- 🔐 **SAML/SSO auth** — Playwright opens a browser once, session is cached for re-use
- 🌳 **Recursive crawl** — pulls a page and every descendant
- 🤖 **Local LLM translation** — text-only, chunked, with macro-aware preprocessing
- 🧱 **Confluence macro support** — drawio / gliffy / lucidchart / plantuml / mermaid diagrams (rendered as images), info / note / warning / tip panels, expand, code, status, jira, layouts, ac:link, task lists, emoticons, and more
- 📋 **Page Summary** + 📝 **Important Notes** generated on demand
- 🔍 **Hover-to-analyze images** — opens a side-by-side modal with a chat interface against a multimodal model (default: `gemma4`)
- 📄 **PDF export** — single combined PDF or per-page

---

## Prerequisites

- **Python 3.11+** (3.13 tested)
- **Node.js 18+** and **npm**
- **Ollama** running locally — https://ollama.com
- A multimodal LLM pulled into Ollama. Default config uses `gemma4` for both text and vision:
  ```bash
  ollama pull gemma4
  ```
  (Any OpenAI-API-compatible endpoint works; just edit `backend/.env`.)
- Network access to your Confluence instance

---

## Quick Start (Local Development)

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# Create your env file
cat > .env <<'EOF'
# Confluence
CONFLUENCE_BASE_URL=https://your-confluence-host.example.com

# LLM — Ollama (local, OpenAI-compatible)
LLM_API_KEY=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=gemma4
LLM_VISION_MODEL=gemma4

# Target language
TARGET_LANGUAGE=en

# App
APP_SECRET_KEY=dev-secret-key-change-in-prod
MAX_CONCURRENT_PAGES=5
EOF

# Make sure Ollama is running and the model is pulled
ollama serve            # in another terminal, if not already running
ollama pull gemma4

# Run the API
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Vite dev server proxies `/api/*` to the backend on port 8000.

### 3. Use it

1. Open <http://localhost:5173>
2. Paste a Confluence page URL
3. (First run only) a Chromium window opens — complete SSO login
4. Wait for crawl + translation
5. Browse the tree, click any page, hover any image to analyze it
6. Click **Download PDF** to export

---

## Docker (optional)

```bash
cp backend/.env backend/.env   # ensure .env exists
docker compose up --build
# → Frontend: http://localhost:3000
# → Backend:  http://localhost:8000
```

> Note: Ollama must be reachable from inside the container. On macOS use `host.docker.internal:11434` for `LLM_BASE_URL`.

---

## Configuration (`backend/.env`)

| Variable               | Default                          | Purpose                                                  |
|------------------------|----------------------------------|----------------------------------------------------------|
| `CONFLUENCE_BASE_URL`  | _(required)_                     | Base URL of your Confluence instance                     |
| `LLM_API_KEY`          | `ollama`                         | API key for the LLM endpoint (any non-empty for Ollama)  |
| `LLM_BASE_URL`         | `http://localhost:11434/v1`      | OpenAI-compatible chat completions endpoint              |
| `LLM_MODEL`            | `gemma4`                         | Text translation + summary/notes model                   |
| `LLM_VISION_MODEL`     | _(falls back to `LLM_MODEL`)_    | Multimodal model for image analysis                      |
| `TARGET_LANGUAGE`      | `en`                             | Target language code                                     |
| `MAX_CONCURRENT_PAGES` | `5`                              | Parallel translation workers                             |
| `APP_SECRET_KEY`       | _(required in prod)_             | Session/cookie signing secret                            |

---

## Tech Stack

- **Backend**: Python 3.13, FastAPI, uvicorn, httpx, Playwright, BeautifulSoup/lxml, WeasyPrint
- **Frontend**: React 19, TypeScript, Vite
- **LLM**: Ollama (any OpenAI-API-compatible provider works)
- **Translation pipeline**: chunked text-node extraction → LLM → reinsert into HTML, after a Confluence-storage-format → standard HTML preprocess pass

---

## Project Layout

```
logos_app/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI entry
│   │   ├── config.py          # Settings (reads .env)
│   │   ├── models/            # Pydantic models
│   │   ├── routers/           # /api/* endpoints (jobs, pages, export, ws)
│   │   ├── services/          # auth, confluence, crawler, translator, cache
│   │   └── utils/             # confluence_macros, html_processor, url_parser
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/        # UrlInput, PageTree, PageViewer, JobProgress
│   │   ├── services/api.ts    # API client
│   │   ├── types/             # Shared types
│   │   └── styles.css
│   └── package.json
├── docker-compose.yml
└── README.md
```

---

## Troubleshooting

| Problem                                         | Fix                                                                                  |
|-------------------------------------------------|--------------------------------------------------------------------------------------|
| `LLM generation failed: Connection refused`     | Start Ollama: `ollama serve`                                                         |
| `model 'gemma4' not found`                      | `ollama pull gemma4` — or change `LLM_MODEL` in `.env`                               |
| Browser opens every job                         | Session cookies expired — log in again; cookies are cached in `backend/browser_session/` |
| Image analysis returns empty                    | Check the model has the `vision` capability: `ollama show <model>`                   |
| `Could not generate content.` for notes/summary | Page has no extractable text, or LLM returned empty — check backend logs             |
| Translation extremely slow                      | Lower `MAX_CONCURRENT_PAGES` or use a smaller model                                  |

---

## Development Tips

- Backend auto-reloads (`uvicorn --reload`) — saving any `.py` file restarts the API.
- Frontend hot-reloads via Vite.
- Auth cookies live in memory (`_session_cache`) and are cleared whenever the backend reloads — you may need to re-authenticate after code changes.
- Debug a single page's raw HTML: `GET /api/pages/{job_id}/{page_id}/raw`

