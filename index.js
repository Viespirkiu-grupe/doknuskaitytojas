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

dotenv.config({ quiet: true });

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;
process.env.LIBREOFFICE_TIMEOUT = String(process.env.LIBREOFFICE_TIMEOUT || 15);

const versija = 6;

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

  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  // Map extensions to their extraction functions
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
    xlsx: extractXlsxContent,
    xlsm: extractXlsxContent,
    xlsb: extractXlsxContent,
    xls: extractXlsContent,
    csv: extractXlsContent,
    pptx: extractPptxContent,
    ppsx: extractPptxContent,
    ppt: extractPptContent,
    zip: extractZipContent,
    txt: extractTxtContent,
    url: extractTxtContent,
    msg: extractMsgContent,
    eml: extractEmlContent,
    "7z": extract7zContent,
  };

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

app.listen(PORT, () => {
  log(`Server listening on port ${PORT}`);
});
