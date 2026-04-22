import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { log } from "./utils/log.js";

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

const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
process.env.LIBREOFFICE_TIMEOUT = String(process.env.LIBREOFFICE_TIMEOUT || 15);

const version = 9;

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

// GET /?url=...&apiKey=...&extension=pdf||docx
app.get("/", async (req, res) => {
  const { url, apiKey } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  log(url);

  if (API_KEY && apiKey !== API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  const extension = (req.query.extension
    ? req.query.extension.toLowerCase()
    : req.query.mime
      ? (MIME_TO_EXT[req.query.mime] ?? req.query.mime)
      : "pdf");

  if (!extractors[extension]) {
    return res.status(400).json({
      error:
        "Invalid extension/mime parameter, should be one of: " +
        Object.keys(extractors).join(", "),
    });
  }

  try {
    const result = await extractors[extension](url);
    res.json({ success: true, result: annotateResult(result, extension), version });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    log(`Error processing ${url}:`);
    console.error(err);
  }
});

// POST /extract
// Body: { url: "...", apiKey: "...", extension: "pdf" || "docx" }
app.post("/extract", async (req, res) => {
  const { url, apiKey, extension, mime, puslapiai = [] } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  log(url);

  if (API_KEY && apiKey !== API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  const ext = extension
    ? extension.toLowerCase()
    : mime
      ? (MIME_TO_EXT[mime] ?? mime)
      : "pdf";

  if (!extractors[ext]) {
    return res.status(400).json({
      error:
        "Invalid extension/mime parameter, should be one of: " +
        Object.keys(extractors).join(", "),
    });
  }

  try {
    const options = {
      puslapiai,
    };
    const result = await extractors[ext](url, options);
    res.json({ success: true, result: annotateResult(result, ext), version });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    log(`Error processing ${url}:`);
    console.error(err);
  }
});

app.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
