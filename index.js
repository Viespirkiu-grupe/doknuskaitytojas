import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { log } from "./utils/log.js";

import { extractPdfContent } from "./extractors/pdf.js";
import { extractDocxContent } from "./extractors/docx.js";
import { extractXlsxContent } from "./extractors/xlsx.js";
import { extractPptxContent } from "./extractors/pptx.js";
import { extractDocContent } from "./extractors/doc.js";
import { extractXlsContent } from "./extractors/xls.js";
import { extractPptContent } from "./extractors/ppt.js";
import { extractZipContent } from "./extractors/zip.js";
import { extractTxtContent } from "./extractors/txt.js";
import { extractMsgContent } from "./extractors/msg.js";
import { extractEmlContent } from "./extractors/eml.js";
import { extract7zContent } from "./extractors/7z.js";
import { extractImageContent } from "./extractors/images.js";
import { extractOdgContent } from "./extractors/odg.js";
import { extractPubContent } from "./extractors/pub.js";
import { extractRarContent } from "./extractors/rar.js";

dotenv.config({ quiet: true });

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: "50mb" }));
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
process.env.LIBREOFFICE_TIMEOUT = String(process.env.LIBREOFFICE_TIMEOUT || 15);

const versija = 8;

// Health check endpoint
app.get("/healthz", (req, res) => {
  res.status(200).send("OK");
});

const extractors = {
  pdf: extractPdfContent,
  prn: extractPdfContent,
  docx: extractDocxContent,
  odt: extractDocxContent,
  docm: extractDocxContent,
  dotx: extractDocxContent,
  doc: extractDocContent,
  dot: extractDocContent,
  rtf: extractDocContent,
  pages: extractDocContent,
  xlsx: extractXlsxContent,
  xlsm: extractXlsxContent,
  xlsb: extractXlsxContent,
  xls: extractXlsContent,
  csv: extractXlsContent,
  pptx: extractPptxContent,
  ppsx: extractPptxContent,
  ppt: extractPptContent,
  zip: extractZipContent,
  adoc: extractZipContent, // Kolkas laikysime kaip zip
  bdoc: extractZipContent, // Kolkas laikysime kaip zip
  edoc: extractZipContent, // Kolkas laikysime kaip zip
  txt: extractTxtContent,
  url: extractTxtContent,
  msg: extractMsgContent,
  eml: extractEmlContent,
  "7z": extract7zContent,
  jpg: extractImageContent,
  jpeg: extractImageContent,
  png: extractImageContent,
  tif: extractImageContent,
  tiff: extractImageContent,
  jfif: extractImageContent,
  odg: extractOdgContent,
  pub: extractPubContent,
  rar: extractRarContent,
};

// GET /?url=...&apiKey=...&extension=pdf||docx
app.get("/", async (req, res) => {
  const { url, apiKey } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  log(url);

  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  const extension = (req.query.extension || "pdf").toLowerCase();

  if (!extractors[extension]) {
    return res.status(400).json({
      error:
        "Invalid extension parameter, should be one of: " +
        Object.keys(extractors).join(", "),
    });
  }

  try {
    const result = await extractors[extension](url);
    res.json({ success: true, result, versija });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    log(`Error processing ${url}:`);
    console.error(err);
  }
});

// POST /extract
// Body: { url: "...", apiKey: "...", extension: "pdf" || "docx" }
app.post("/extract", async (req, res) => {
  const { url, apiKey, extension = "pdf", puslapiai = [] } = req.body;

  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  log(url);

  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  const ext = extension.toLowerCase();

  if (!extractors[ext]) {
    return res.status(400).json({
      error:
        "Invalid extension parameter, should be one of: " +
        Object.keys(extractors).join(", "),
    });
  }

  try {
    const options = {
      puslapiai,
    };
    const result = await extractors[ext](url, options);
    res.json({ success: true, result, versija });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
    log(`Error processing ${url}:`);
    console.error(err);
  }
});

app.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
