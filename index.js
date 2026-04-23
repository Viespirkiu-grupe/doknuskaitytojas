import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { log, requestContext } from "./utils/log.js";
import pLimit from "p-limit";
import { randomUUID } from "crypto";

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

const limit = pLimit(Number(process.env.MAX_CONCURRENT) || 4);

const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
process.env.LIBREOFFICE_TIMEOUT = String(process.env.LIBREOFFICE_TIMEOUT || 15);

const version = 10;

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

  await requestContext.run(reqId, async () => {
    log(url);
    try {
      const result = await limit(() => extractors[extension](url));
      res.json({ success: true, result: annotateResult(result, extension), version });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      log(`Error processing ${url}:`, err);
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

  await requestContext.run(reqId, async () => {
    log(url);
    try {
      const result = await limit(() => extractors[ext](url, { puslapiai }));
      res.json({ success: true, result: annotateResult(result, ext), version });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
      log(`Error processing ${url}:`, err);
    }
  });
});

app.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
