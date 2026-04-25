import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { log, requestContext } from "./utils/log.js";
import pLimit from "p-limit";
import { randomUUID } from "crypto";
import { fetchSafe, fetchSafeText } from "./utils/fetchSafe.js";

dotenv.config({ quiet: true });

const extractors = {};
const MIME_TYPES = {};
const NORMALIZED_EXT = {};
for (const dir of ["./extractors", "./extractors/archives"]) {
  for (const file of (await fs.promises.readdir(dir)).filter(f => f.endsWith(".js"))) {
    const mod = await import(`${dir}/${file}`);
    if (!mod.extract || !mod.fileTypes) continue;
    for (const { ext, mime, normalizedAs } of mod.fileTypes) {
      extractors[ext] = mod.extract;
      MIME_TYPES[ext] = mime;
      if (normalizedAs) NORMALIZED_EXT[ext] = normalizedAs;
    }
  }
}

// Reverse map: mime type → canonical extension (first match wins)
const MIME_TO_EXT = Object.fromEntries(
  Object.entries(MIME_TYPES)
    .filter(([ext]) => !(ext in NORMALIZED_EXT))
    .map(([ext, mime]) => [mime, ext])
);

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
for (const f of fs.readdirSync(TMP_DIR)) {
  fs.rmSync(path.join(TMP_DIR, f), { recursive: true, force: true });
}

const TMP_MAX_AGE_MS = 60 * 60 * 1000; // 1 valanda
function cleanTmp() {
  const now = Date.now();
  for (const f of fs.readdirSync(TMP_DIR)) {
    const fp = path.join(TMP_DIR, f);
    try {
      const { mtimeMs } = fs.statSync(fp);
      if (now - mtimeMs > TMP_MAX_AGE_MS) {
        fs.rmSync(fp, { recursive: true, force: true });
      }
    } catch {
      // failas jau pašalintas arba nepasiekiamas
    }
  }
}
setInterval(cleanTmp, 60_000).unref();

const limit = pLimit(Number(process.env.MAX_CONCURRENT) || 4);

// Kas sekundę logina eilės būseną (tik kai yra aktyvių užduočių)
setInterval(() => {
  const active = limit.activeCount;
  const pending = limit.pendingCount;
  if (active > 0 || pending > 0) {
    log(`Eilė: ${active} apdorojama, ${pending} laukia`);
  }
}, 1000).unref();

const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
process.env.LIBREOFFICE_TIMEOUT = String(process.env.LIBREOFFICE_TIMEOUT || 15);

const version = 11;

process.on("unhandledRejection", (err) => {
  log("Unhandled rejection:", err);
});

function requireAuth(req, res, next) {
  if (!API_KEY) return next();
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ") || auth.slice(7) !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const HOISTED_FIELDS = [
  "companyIds", "ibans", "phones", "links", "emails",
  "ipAddresses", "macAddresses", "domains",
  "pageCount", "characterCount", "wordCount",
];

function annotateResult(result, ext) {
  result.mimeType  = MIME_TYPES[ext] ?? "application/octet-stream";
  result.extension = NORMALIZED_EXT[ext] ?? ext;
  for (const key of HOISTED_FIELDS) {
    if (key in result.metadata) {
      result[key] = result.metadata[key];
      delete result.metadata[key];
    }
  }
  return result;
}

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

function resolveExt(extension, mime) {
  if (extension) return extension.toLowerCase();
  if (mime) return MIME_TO_EXT[mime] ?? mime;
  return "pdf";
}

// GET /?url=...&extension=pdf  (Authorization: Bearer <token>)
app.get("/", requireAuth, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ success: false, error: "Missing url parameter" });

  const reqId = randomUUID().slice(0, 8);
  const extension = resolveExt(req.query.extension, req.query.mime);

  if (!extractors[extension]) {
    return res.status(400).json({
      success: false,
      error: "Invalid extension/mime, must be one of: " + Object.keys(extractors).join(", "),
    });
  }

  const filename = decodeURIComponent(url).split("/").pop().split("?")[0] || url;
  await requestContext.run({ reqId, filename }, async () => {
    log(`↓ Atsisiunčiama [${extension}] ${url}`);
    try {
      let t = Date.now();
      const data = extension === "eml" ? await fetchSafeText(url) : Buffer.from(await fetchSafe(url));
      const downloadSec = ((Date.now() - t) / 1000).toFixed(2);
      log(`↓ Atsisiųsta: ${downloadSec}s`);

      t = Date.now();
      const result = await limit(() => {
        log(`⚙ Apdorojama`);
        return extractors[extension](data);
      });
      const processSec = ((Date.now() - t) / 1000).toFixed(2);
      log(`✓ Baigta: ${processSec}s`);

      res.json({ success: true, result: annotateResult(result, extension), version });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      log(`✗ Klaida:`, err.message);
    }
  });
});

// POST /extract  (Authorization: Bearer <token>)
// Body: { url, extension?, mime?, puslapiai? }
app.post("/extract", requireAuth, async (req, res) => {
  const { url, extension, mime, puslapiai = [] } = req.body;

  if (!url) return res.status(400).json({ success: false, error: "Missing url" });

  const reqId = randomUUID().slice(0, 8);
  const ext = resolveExt(extension, mime);

  if (!extractors[ext]) {
    return res.status(400).json({
      success: false,
      error: "Invalid extension/mime, must be one of: " + Object.keys(extractors).join(", "),
    });
  }

  const filename = decodeURIComponent(url).split("/").pop().split("?")[0] || url;
  await requestContext.run({ reqId, filename }, async () => {
    log(`↓ Atsisiunčiama [${ext}] ${url}`);
    try {
      let t = Date.now();
      const data = ext === "eml" ? await fetchSafeText(url) : Buffer.from(await fetchSafe(url));
      const downloadSec = ((Date.now() - t) / 1000).toFixed(2);
      log(`↓ Atsisiųsta: ${downloadSec}s`);

      t = Date.now();
      const result = await limit(() => {
        log(`⚙ Apdorojama`);
        return extractors[ext](data, { puslapiai });
      });
      const processSec = ((Date.now() - t) / 1000).toFixed(2);
      log(`✓ Baigta: ${processSec}s`);

      res.json({ success: true, result: annotateResult(result, ext), version });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      log(`✗ Klaida:`, err.message);
    }
  });
});

app.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
