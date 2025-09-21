import express from "express";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import { extractPdfContent } from "./pdf.js";
import { extractDocxContent } from "./docx.js";

dotenv.config({ quiet: true }); // Load .env

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

const versija = 4;

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// GET /?url=...&apiKey=...&extension=pdf||docx
app.get("/", async (req, res) => {
  const { url, apiKey } = req.query;

  if (!url) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  // Check extension parameter to be either pdf or docx
  const extension = (req.query.extension || "pdf").toLowerCase();
  if (!["pdf", "docx"].includes(extension)) {
    return res
      .status(400)
      .json({ error: "Invalid extension parameter, should be pdf or docx" });
  }

  if (extension === "docx") {
    try {
      const result = await extractDocxContent(url);
      res.json({ success: true, result, versija });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  } else if (extension === "pdf") {
    try {
      const result = await extractPdfContent(url);
      res.json({ success: true, result, versija });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
