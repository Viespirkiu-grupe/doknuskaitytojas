# Dokumentų nuskaitytojas

REST API microservice that extracts text, metadata, and structured data from documents in 30+ file formats. Built with Node.js/Express. Primarily used for Lithuanian public procurement document processing.

**Supported formats:** PDF, DOCX, XLSX, PPTX, DOC, XLS, PPT, ODG, RTF, PUB, MSG, EML, ZIP, 7Z, RAR, TXT, images, and more.

**Extracted data:** full text by page, word/character counts, emails, phone numbers, Lithuanian company codes (JAR), IBANs, URLs, IPv4, MAC addresses, PDF signatures, document metadata.

## Running in Docker

1. Copy [env.example](env.example) to `.env`

    ```shell
    cp env.example .env
    ```

2. Generate API key

    ```shell
    uuidgen | tr '[:upper:]' '[:lower:]' | sed 's/-//g'
    ```

3. Set `PORT` and `API_KEY` in `.env`

    ```shell
    PORT=3000        # defaults to 3000 if not set
    API_KEY=your_api_key_here
    ```

    Optional variables:

    ```shell
    LIBREOFFICE_TIMEOUT=15  # seconds before LibreOffice is killed (default 15)
    MAX_CONCURRENT=4        # parallel extraction limit (default 4)
    PDF_MAX_PAGES=10000     # page cap for PDF extraction (default 10000)
    ```

4. Run the service

    ```shell
    docker compose up -d
    ```

    On older systems: `docker-compose up -d`

5. Check that it works

    With PDF:

    ```shell
    curl -H 'Authorization: Bearer your_api_key_here' \
      'http://localhost:3000/?url=https%3A%2F%2Ffailai.viespirkiai.top%2F2007731419%2F2007731420&extension=pdf'
    ```

    With DOCX:

    ```shell
    curl -H 'Authorization: Bearer your_api_key_here' \
      'http://localhost:3000/?url=https%3A%2F%2Ffailai.viespirkiai.top%2F2007766532%2F2007766545&extension=docx'
    ```

## API

All endpoints except `/healthz` require an `Authorization: Bearer <API_KEY>` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check — no auth required |
| `GET` | `/?url=<encoded_url>&extension=<ext>` | Extract document by URL |
| `POST` | `/extract` | Extract document — body: `{ url, extension?, mime?, puslapiai?: [] }` |

`puslapiai` is an optional array of page numbers to return (all pages returned if omitted).

**Success response:** `{ success: true, result: { ... }, version: N }`  
**Error response:** `{ success: false, error: "..." }`

## Final notes

To stop the service: `docker compose down`

To rebuild after code changes: `docker compose up -d --build`

`docker` can be replaced with `podman` in all examples above — both work.

Temporary files are written to `./tmp/` and automatically cleaned up: extractors remove their own files after use, and a background job removes any files older than 1 hour.

## Get in touch

Exposing the service over the public internet is beyond the scope of this document, but do [reach out](https://viespirkiai.top/kontaktai) if you want to contribute a node and need help.
