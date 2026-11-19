# FlipDown — FlipHTML5 Downloader Web Application

**Live Web App (GitHub Pages):** https://sanciao4456.github.io/HTML5DOWNLOADER/

Full-stack web application for inspecting public **FlipHTML5** publications and archiving them into **PDF documents (`.pdf`)** or **standalone Offline HTML5 Flipbook packages (`.zip`)**, powered by an Express + TypeScript backend, Node.js built-in SQLite (`node:sqlite`), and a React + Vite frontend with built-in zero-server browser studio support.

## Modes

- **Browser Studio (works directly on GitHub Pages with no server):** Drop page images directly in your browser to compile a **PDF** or **Offline HTML5 Flipbook `.zip`** locally using `pdf-lib` and `JSZip` (nothing leaves your device).
- **Full Backend Mode (FlipHTML5 URL scraping + SQLite history):** Run locally (`npm start`) or deploy `Dockerfile` / `render.yaml` to Render/Railway, then enter your backend URL in the top-right **Static Mode / Backend Settings** button on GitHub Pages.

## Features

- **FlipHTML5 Publication Inspector**: Validates and normalizes `fliphtml5.com` / `online.fliphtml5.com` URLs, parses `config.js` and HTML OpenGraph manifests, and previews cover art, sample pages, page count, and dimensions.
- **PDF Document Generator**: Downloads pages concurrently, normalizes WebP/PNG/JPEG pages with `sharp`, and compiles properly proportioned multi-page PDFs with `pdf-lib`.
- **Standalone Offline HTML5 Package (`.zip`)**: Bundles normalized page images with an embedded zero-dependency offline flipbook reader (`index.html`) supporting single-page & two-page spread view, zoom controls, thumbnail drawer, fullscreen, and keyboard navigation — opens directly via `file://` with no local server needed.
- **Custom Page Ranges & Quality Presets**: Select `all` or custom ranges (e.g. `1-10, 15, 20-25`) and choose between `Original`, `High`, `Medium`, or `Compact` resolution presets.
- **Live SSE Progress & SQLite Archive**: Streams page-by-page download and packaging progress over Server-Sent Events (`/api/jobs/:id/events`), supports job cancellation, and persists inspection & download history in SQLite (`backend/data/flipdown.db`).
- **SSRF-Safe Host Validation**: Strictly restricts remote fetches and cover thumbnail proxying to verified `fliphtml5.com` subdomains.

## Tech Stack

- **Backend**: Node.js (`>=22.5` with built-in `node:sqlite`), Express 5, TypeScript (`tsx`), `sharp`, `pdf-lib`, `archiver`
- **Frontend**: React 19, Vite, TypeScript, Vanilla CSS, `lucide-react`

## Project Structure

```text
HTML5DOWNLOADER/
├── package.json              # Root scripts for install, dev, build, start, test
├── backend/
│   ├── src/
│   │   ├── config.ts         # Ports, paths, concurrency & FlipHTML5 host allowlist
│   │   ├── server.ts         # Express server + static frontend serving
│   │   ├── db/database.ts    # node:sqlite schema & job/inspection repository
│   │   ├── routes/api.ts     # REST API, SSE stream, file download & image proxy
│   │   └── services/
│   │       ├── fliphtml5.ts  # URL normalizer, config.js/HTML parser, page fetcher
│   │       ├── pageRange.ts  # Custom page range parser & formatter
│   │       ├── pdfBuilder.ts # sharp + pdf-lib PDF builder
│   │       ├── html5Builder.ts # Offline HTML5 flipbook ZIP bundler
│   │       └── jobManager.ts # Concurrent job runner, AbortController cancel, pub/sub
│   └── tests/
│       └── core.test.ts      # Automated node:test unit & integration suite
└── frontend/
    ├── index.html
    ├── vite.config.ts        # Proxies /api -> http://localhost:3001
    └── src/
        ├── App.tsx
        ├── index.css
        ├── types.ts
        ├── api/client.ts
        └── components/
            ├── Header.tsx
            ├── UrlInspector.tsx
            ├── BookPreviewCard.tsx
            ├── ActiveJobsPanel.tsx
            └── HistoryList.tsx
```

## Getting Started

### Prerequisites

- **Node.js 22.5+** (Node 24 LTS recommended; uses built-in `node:sqlite`)
- **npm 10+**

### Installation

```bash
npm run install:all
```

### Development Mode

Run both the backend API (`http://localhost:3001`) and Vite frontend (`http://localhost:5173`) concurrently:

```bash
npm run dev
```

Or run them in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

### Production Build & Single-Port Server

Build the frontend bundle and serve both the web app and API from `http://localhost:3001`:

```bash
npm run build
npm start
```

### Running Tests & Type Checks

```bash
npm run typecheck
npm test
```

## API Endpoints

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Service health check |
| `POST` | `/api/inspect` | Inspect a FlipHTML5 book URL (`{ "url": "..." }`) |
| `GET` | `/api/inspections` | List recently inspected books |
| `GET` | `/api/jobs` | List download history from SQLite |
| `POST` | `/api/jobs` | Start a new PDF or Offline HTML5 job |
| `GET` | `/api/jobs/:id` | Fetch single job status |
| `GET` | `/api/jobs/:id/events` | Stream live job progress via Server-Sent Events |
| `POST` | `/api/jobs/:id/cancel` | Cancel an active job |
| `GET` | `/api/jobs/:id/download` | Download completed `.pdf` or `.zip` archive |
| `DELETE` | `/api/jobs/:id` | Delete job record and output file from disk |
| `GET` | `/api/proxy/image?url=...` | Proxy FlipHTML5 cover/sample thumbnails safely |

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Backend HTTP server port |
| `FLIPDOWN_CONCURRENCY` | `4` | Max parallel page fetches (1–8) |
| `FLIPDOWN_TIMEOUT_MS` | `25000` | Per-request network timeout in milliseconds |
| `FLIPDOWN_DATA_DIR` | `backend/data` | Directory for SQLite database and generated outputs |

## Responsible Use

FlipDown is intended for archiving **publicly accessible** FlipHTML5 documents that you own or have permission to save offline. Please respect copyright and publisher terms of service.