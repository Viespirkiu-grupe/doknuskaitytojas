# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Dokumentų Nuskaitytojas** — a REST API microservice that extracts text, metadata, and structured data from documents in 30+ file formats. Built with Node.js/Express (ES modules). Primarily used for Lithuanian public procurement document processing.

## Running the Service

```bash
# Docker (recommended)
cp env.example .env
# Set PORT and API_KEY in .env
docker compose up -d
docker compose up -d --build  # after code changes

# Local (requires LibreOffice and poppler-utils installed)
npm install
node index.js
```

Environment variables: `PORT` (default 3000), `API_KEY` (required for all requests), `LIBREOFFICE_TIMEOUT` (default 15 seconds), `MAX_CONCURRENT` (default 4), `PDF_MAX_PAGES` (default 10000).

## API Endpoints

All endpoints (except `/healthz`) require `Authorization: Bearer <API_KEY>` header.

- `GET /healthz` — health check (no auth)
- `GET /?url=<encoded_url>&extension=pdf` — extract document
- `POST /extract` — body: `{ url, extension?, mime?, puslapiai?: [] }` — `puslapiai` is an optional page filter array

All error responses have shape `{ success: false, error: "..." }`. Success responses have `{ success: true, result: {...}, version: N }`.

## Architecture

`index.js` is the entry point. It registers an extractor map (`extension → function`) and routes requests to the appropriate extractor.

### Extractor Pattern (`/extractors/*.js`)

Each extractor:
1. Downloads the file from a URL to `./tmp/`
2. Converts to PDF via LibreOffice if needed (hard-killed after `LIBREOFFICE_TIMEOUT` seconds using `tree-kill`)
3. Extracts text page-by-page using `pdfjs-dist`
4. Calls `viskas()` parser on the text
5. Returns a structured result object

Key extractors:
- `pdf.js` — core PDF extraction using `pdfjs-dist`; also extracts annotations, links, signatures (via `pdftotext` from poppler-utils)
- `docx.js`, `xlsx.js`, `pptx.js`, `doc.js`, `xls.js`, `ppt.js` — Office formats converted to PDF via LibreOffice
- `zip.js`, `7z.js`, `rar.js` — archives; each file inside is recursively processed
- `adoc.js` — ADoc/ODF container format; XML-parsed directly
- `msg.js`, `eml.js` — email formats
- `images.js` — EXIF data extraction only (no OCR)
- `txt.js` — plain text/URL fetch

### Parser Pipeline (`/parsers/*.js`)

`parsers/viskas.js` is the master parser called by all extractors. It combines:
- `emails.js` — email addresses
- `telefonai.js` — Lithuanian phone numbers
- `jarKodai.js` — 9-digit Lithuanian business registration codes
- `ibanNumeriai.js` — IBAN numbers
- `links.js` — URLs and mailto links
- `ipAdresai.js` — IPv4 addresses
- `macAdresai.js` — MAC addresses

Plus word/character counts.

### Utilities (`/utils/*.js`)

- `log.js` — colored timestamped logging with automatic caller identification; propagates request correlation IDs via `AsyncLocalStorage`
- `fetchSafe.js` — fetch wrapper with 30s timeout and 1 GB size limit; used by all extractors
- `mergeObject.js` — deep object merge used when combining results from archive entries
- `nustatytiKokybiskesniTeksta.js` — chooses the better-quality text between two extraction attempts

## Adding a New File Format

1. Create `extractors/<ext>.js` exporting an async function `extract<Ext>Content(url, options = {})`
2. Register it in the `extractors` map in `index.js`

## Notes

- The service is version-stamped (`version` constant in `index.js`); increment when making significant changes
- Temporary files are written to `./tmp/`; extractors should clean up after themselves, and `index.js` runs a periodic cleanup every 60 s that removes files older than 1 hour
- LibreOffice is run as a subprocess; `tree-kill` ensures cleanup of its child processes on timeout or error
- ZIP/RAR filename encoding is auto-detected with a Lithuanian character frequency heuristic
- `fetchSafe.js` enforces a 30 s timeout and 1 GB limit; size is checked against actual byte length (not character count)
- `telefonai.js` normalises all Lithuanian numbers to `+370XXXXXXXX`; international numbers are matched by country-code prefix but only when written without spaces
- `nustatytiKokybiskesniTeksta.js` scores text quality via 12 weighted criteria; all regex patterns are module-level constants to avoid repeated compilation
