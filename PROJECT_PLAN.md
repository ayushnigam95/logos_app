# Confluence Page Translator

> Scrape Confluence pages (including nested children), translate all content to English (text + images), and serve/export as PDF — preserving original layout.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     React Frontend (Vite)                    │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ URL Input│  │ Progress View│  │ Translated Page Viewer │ │
│  │ + Config │  │ (WebSocket)  │  │ + PDF Download         │ │
│  └──────────┘  └──────────────┘  └────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│                  Python FastAPI Backend                       │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ SAML Auth    │  │ Translation  │  │ PDF Generation     │  │
│  │ (Playwright) │  │ Engine       │  │ Engine             │  │
│  │ → Cookies    │  │ (Text + OCR) │  │ (WeasyPrint)       │  │
│  └──────┬──────┘  └──────────────┘  └────────────────────┘  │
│         ▼                                                    │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Confluence   │  │ Image        │  │ Layout             │  │
│  │ REST Client  │  │ Processor    │  │ Preserver          │  │
│  │ (httpx)      │  └──────────────┘  └────────────────────┘  │
│  └─────────────┘                                             │
│  ┌─────────────┐                                             │
│  │ Page Tree    │                                            │
│  │ Crawler      │                                            │
│  └─────────────┘                                             │
└──────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │Confluence│ │ Google   │ │  SQLite  │
        │(via SAML │ │Translate │ │  (Cache) │
        │ cookies) │ │/ DeepL   │ └──────────┘
        └──────────┘ └──────────┘
```

---

## 2. Tech Stack

| Layer           | Technology                                      | Reason                                             |
| --------------- | ----------------------------------------------- | -------------------------------------------------- |
| **Frontend**    | React + Vite + TypeScript                       | Fast dev, good component model for page rendering  |
| **Backend**     | Python 3.12 + FastAPI                           | Best ecosystem for scraping, OCR, translation, PDF |
| **Auth**        | Playwright (persistent ctx)                     | Handles SAML/SSO login, saves session cookies      |
| **Confluence**  | `httpx` + REST API directly                     | Fast async HTTP with cookies from Playwright       |
| **Translation** | `deep-translator` (Google/DeepL/LibreTranslate) | Free tier available, multiple provider support     |
| **OCR**         | `pytesseract` + Pillow                          | Extract text from images for translation           |
| **Image Edit**  | Pillow + `img2pdf`                              | Overlay translated text on images                  |
| **PDF Export**  | WeasyPrint                                      | HTML/CSS → PDF with layout fidelity                |
| **Real-time**   | WebSocket (FastAPI)                             | Progress updates during long scrape/translate jobs |
| **Cache/DB**    | SQLite + `aiosqlite`                            | Cache translated pages, avoid re-translating       |
| **Task Queue**  | `asyncio` tasks (or Celery for scale)           | Background processing of page trees                |

---

## 3. Features Breakdown

### Phase 1 — Core (MVP)

| #   | Feature                        | Description                                                       |
| --- | ------------------------------ | ----------------------------------------------------------------- |
| 1   | Confluence URL input           | Accept a Confluence page URL, extract space key + page ID         |
| 2   | API authentication             | Support Confluence Cloud (API token) and Data Center (PAT/basic)  |
| 3   | Single page scrape             | Fetch page title, body (storage format HTML), attachments, images |
| 4   | Recursive child page discovery | Walk the page tree via `/rest/api/content/{id}/child/page`        |
| 5   | Text translation               | Translate all text nodes in the HTML body to English              |
| 6   | Layout-preserving render       | Serve translated HTML keeping Confluence macros/tables/formatting |
| 7   | PDF export (single page)       | Convert translated page → PDF with WeasyPrint                     |

### Phase 2 — Images & Polish

| #   | Feature                       | Description                                                       |
| --- | ----------------------------- | ----------------------------------------------------------------- |
| 8   | Image OCR                     | Extract text from embedded images via Tesseract                   |
| 9   | Image translation overlay     | Replace/annotate image text with English translation              |
| 10  | Batch PDF export              | Export entire page tree as a single PDF or ZIP of PDFs            |
| 11  | Progress tracking (WebSocket) | Real-time progress bar: pages found → scraped → translated → done |
| 12  | Translation cache             | Cache translations in SQLite to avoid redundant API calls         |

### Phase 3 — Advanced

| #   | Feature                         | Description                                                     |
| --- | ------------------------------- | --------------------------------------------------------------- |
| 13  | Browser extension / bookmarklet | "Translate this page" button when viewing Confluence in browser |
| 14  | Language auto-detection         | Detect source language per page (some may already be English)   |
| 15  | Side-by-side view               | Show original + translated content side by side                 |
| 16  | Confluence macro support        | Handle special macros: code blocks (skip), Jira links, etc.     |
| 17  | Multi-language output           | Translate to languages other than English                       |

---

## 4. Project Structure

```
confluence-translator/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app entry point
│   │   ├── config.py               # Settings (env vars, API keys)
│   │   ├── routers/
│   │   │   ├── pages.py            # /api/pages — scrape & translate endpoints
│   │   │   ├── export.py           # /api/export — PDF generation
│   │   │   └── ws.py               # WebSocket for progress updates
│   │   ├── services/
│   │   │   ├── confluence.py       # Confluence API client + page tree crawler
│   │   │   ├── scraper.py          # HTML parsing + content extraction
│   │   │   ├── translator.py       # Text translation service
│   │   │   ├── ocr.py              # Image OCR + text overlay
│   │   │   ├── pdf_generator.py    # HTML → PDF conversion
│   │   │   └── cache.py            # Translation cache (SQLite)
│   │   ├── models/
│   │   │   ├── page.py             # Page data models (Pydantic)
│   │   │   └── job.py              # Translation job models
│   │   └── utils/
│   │       ├── html_processor.py   # HTML manipulation helpers
│   │       └── url_parser.py       # Extract space/page from Confluence URLs
│   ├── tests/
│   │   ├── test_confluence.py
│   │   ├── test_translator.py
│   │   └── test_pdf.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── UrlInput.tsx        # URL input + auth config form
│   │   │   ├── PageTree.tsx        # Visual page hierarchy
│   │   │   ├── ProgressTracker.tsx # Real-time progress display
│   │   │   ├── PageViewer.tsx      # Rendered translated page
│   │   │   └── PdfDownload.tsx     # PDF export controls
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts     # WebSocket connection hook
│   │   │   └── useTranslation.ts   # Translation job management
│   │   ├── services/
│   │   │   └── api.ts              # Backend API client
│   │   └── types/
│   │       └── index.ts            # TypeScript interfaces
│   ├── package.json
│   ├── vite.config.ts
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
├── PROJECT_PLAN.md
└── README.md
```

---

## 5. API Design

### REST Endpoints

```
POST   /api/auth/configure          # Save Confluence credentials (session)
POST   /api/jobs                    # Start a new translation job
GET    /api/jobs/{job_id}           # Get job status + results
GET    /api/jobs/{job_id}/pages     # List all pages in the job (tree)
GET    /api/pages/{page_id}         # Get a single translated page (HTML)
GET    /api/pages/{page_id}/pdf     # Download single page as PDF
GET    /api/jobs/{job_id}/pdf       # Download entire tree as PDF/ZIP
DELETE /api/jobs/{job_id}           # Cancel a running job
```

### WebSocket

```
WS /ws/jobs/{job_id}               # Real-time progress stream
   → { "type": "progress", "pages_found": 12, "pages_scraped": 5, "pages_translated": 3 }
   → { "type": "page_done", "page_id": "123", "title": "..." }
   → { "type": "complete" }
   → { "type": "error", "message": "..." }
```

### Key Request/Response Models

```python
# Start a job
POST /api/jobs
{
  "confluence_url": "https://mycompany.atlassian.net/wiki/spaces/PROJ/pages/12345",
  "include_children": true,
  "max_depth": -1,          # -1 = unlimited
  "translate_images": true,
  "target_language": "en",
  "export_pdf": true
}

# Job status response
{
  "job_id": "uuid",
  "status": "in_progress",  # pending | in_progress | completed | failed
  "total_pages": 15,
  "pages_scraped": 10,
  "pages_translated": 7,
  "page_tree": {
    "id": "12345",
    "title": "Parent Page (translated)",
    "children": [...]
  }
}
```

---

## 6. Key Implementation Details

### Confluence Scraping Strategy

1. **Prefer REST API** over web scraping — `GET /rest/api/content/{id}?expand=body.storage,children.page`
2. **Recursive crawl**: BFS/DFS through `children.page` with configurable depth limit
3. **Rate limiting**: Respect Confluence API limits (≈5 req/sec for Cloud)
4. **Image download**: Fetch all `<ac:image>` and `<img>` attachments via API

### Translation Strategy

1. **HTML-aware translation**: Parse HTML → extract text nodes → translate → reinsert
2. **Skip code blocks**: Don't translate `<code>`, `<pre>`, or code macro content
3. **Batch translation**: Group text segments to minimize API calls
4. **Preserve formatting**: Keep all HTML tags, attributes, and structure intact

### Image Translation (OCR) Strategy

1. **Tesseract OCR** to extract text + bounding boxes from images
2. **Translate extracted text** via same translation service
3. **Overlay approach**: Paint over original text region → render translated text
4. **Fallback**: If OCR confidence is low, add translation as a caption below image

### PDF Generation Strategy

1. **WeasyPrint** for high-fidelity HTML → PDF conversion
2. **Custom CSS** to replicate Confluence page styling
3. **Table of Contents** generated from page tree hierarchy
4. **Bookmarks/links** preserved between pages in combined PDF

---

## 7. Environment Variables

```env
# Confluence
CONFLUENCE_BASE_URL=https://mycompany.atlassian.net/wiki
CONFLUENCE_EMAIL=user@company.com
CONFLUENCE_API_TOKEN=your-api-token

# Translation
TRANSLATION_PROVIDER=google          # google | deepl | libre
DEEPL_API_KEY=                        # if using DeepL
LIBRE_TRANSLATE_URL=                  # if self-hosting LibreTranslate

# OCR
TESSERACT_PATH=/usr/bin/tesseract     # path to tesseract binary

# App
APP_SECRET_KEY=change-me
CACHE_DB_PATH=./data/cache.db
MAX_CONCURRENT_PAGES=5
```

---

## 8. Development Phases & Milestones

### Milestone 1 — Backend Scaffold + Single Page (Week 1)

- [ ] Project setup: FastAPI app, dependencies, Docker
- [ ] Confluence API client with auth
- [ ] URL parser (extract space key + page ID from any Confluence URL format)
- [ ] Single page fetch + HTML extraction
- [ ] Basic text translation (Google Translate via `deep-translator`)
- [ ] HTML-aware translation (preserve tags, skip code blocks)
- [ ] Serve translated HTML via API

### Milestone 2 — Page Tree + Frontend (Week 2)

- [ ] Recursive child page crawler with depth control
- [ ] Job system (create, track, cancel translation jobs)
- [ ] WebSocket progress updates
- [ ] React frontend: URL input, auth config, progress view
- [ ] Page tree visualization
- [ ] Translated page viewer (render HTML)

### Milestone 3 — PDF + Images (Week 3)

- [ ] WeasyPrint PDF generation for single pages
- [ ] Combined PDF with table of contents for page tree
- [ ] ZIP export of individual PDFs
- [ ] Tesseract OCR integration
- [ ] Image text translation + overlay
- [ ] Translation cache (SQLite)

### Milestone 4 — Polish & Advanced (Week 4)

- [ ] Language auto-detection (skip already-English pages)
- [ ] Side-by-side original/translated view
- [ ] Confluence macro handling (code blocks, Jira links, status macros)
- [ ] Error handling, retries, partial failure recovery
- [ ] Docker Compose for one-command deployment
- [ ] Documentation + README

---

## 9. Getting Started (Quick Commands)

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev        # → http://localhost:5173

# Full stack (Docker)
docker-compose up --build
```

---

## 10. Risks & Mitigations

| Risk                                   | Mitigation                                                 |
| -------------------------------------- | ---------------------------------------------------------- |
| Confluence API rate limits             | Request throttling + exponential backoff                   |
| Large page trees (100+ pages)          | Depth limit, pagination, background processing             |
| Translation API costs at scale         | Caching, batch requests, option to use free LibreTranslate |
| OCR accuracy on complex images         | Confidence threshold, fallback to caption approach         |
| Confluence Cloud vs. Data Center diffs | Abstract API client with adapter pattern                   |
| Non-Latin scripts in images            | Use language-specific Tesseract models                     |
