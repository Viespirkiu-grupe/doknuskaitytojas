import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { parseStringPromise } from "xml2js";

const execFileAsync = promisify(execFile);

const TMP_DIR = path.resolve("./tmp");
try {
  await fs.mkdir(TMP_DIR, { recursive: true });
} catch (err) {
  console.error("Failed to create TMP_DIR:", err);
}

/**
 * Convert DOCX file to PDF buffer using LibreOffice
 * @param {string} docxPath
 */
async function convertDocxToPdfBuffer(docxPath) {
  await execFileAsync("libreoffice", [
    "--headless",
    "--convert-to",
    "pdf",
    "--outdir",
    TMP_DIR,
    docxPath,
  ]);

  // Read PDF into buffer and delete temp file
  const buffer = await fs.readFile(docxPath.replace(/\.docx$/i, ".pdf"));
  await fs.unlink(docxPath.replace(/\.docx$/i, ".pdf"));

  return buffer;
}

/**
 * Extract DOCX content using PDF pipeline
 * @param {string} url DOCX file URL
 */
export async function extractDocxContent(url) {
  // 1. Download DOCX
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  const docxBuffer = Buffer.from(arrayBuffer);

  const tmpDocx = path.join(TMP_DIR, `${randomUUID()}.docx`);

  await fs.writeFile(tmpDocx, docxBuffer);

  try {
    // Convert DOCX → PDF buffer
    const pdfBuffer = await convertDocxToPdfBuffer(tmpDocx);

    // Extract DOCX metadata
    const metadata = await extractDocxMetadata(tmpDocx);

    // Run PDF extractor
    let result = await extractPdfContent(pdfBuffer, { skipPdfMetadata: true });

    result.metadata = { ...result.metadata, ...metadata };

    return result;
  } finally {
    await fs.unlink(tmpDocx); // cleanup DOCX
  }
}

/**
 * Extract metadata from DOCX
 * @param {string} docxPath
 */
export async function extractDocxMetadata(docxPath) {
  const zip = new AdmZip(await fs.readFile(docxPath));
  let metadata = {};

  // 1. Core properties
  const coreXml = zip.readAsText("docProps/core.xml");
  if (coreXml) {
    const parsed = await parseStringPromise(coreXml);
    const props = parsed["cp:coreProperties"] || {};
    for (const key in props) {
      if (Array.isArray(props[key]) && props[key][0]) {
        metadata[stripPrefix(key)] = props[key][0];
      }
    }
  }

  // 2. Extended properties
  const appXml = zip.readAsText("docProps/app.xml");
  if (appXml) {
    const parsed = await parseStringPromise(appXml);
    const props = parsed.Properties || {};
    for (const key in props) {
      if (Array.isArray(props[key]) && props[key][0]) {
        metadata[stripPrefix(key)] = props[key][0];
      } else if (typeof props[key] === "string") {
        metadata[stripPrefix(key)] = props[key];
      }
    }
  }

  // 3. Custom properties
  const customXml = zip.readAsText("docProps/custom.xml");
  if (customXml) {
    const parsed = await parseStringPromise(customXml);
    const props = parsed.Properties?.property || [];
    for (const p of props) {
      if (p?.$.name && p?.vt?.[0]) {
        const valKey = Object.keys(p.vt)[0];
        metadata[stripPrefix(p.$.name)] = p.vt[valKey][0];
      }
    }
  }

  if (metadata.created && metadata.created._) {
    metadata.CreationDate = metadata.created._;
    delete metadata.created;
  }

  if (metadata.modified && metadata.modified._) {
    metadata.ModifiedDate = metadata.modified._;
    delete metadata.modified;
  }

  delete metadata.HeadingPairs;
  delete metadata.TitlesOfParts;
  metadata.Producer = metadata.Application || "";
  metadata.Title = metadata.title || "";
  delete metadata.title;
  delete metadata.HLinks;
  metadata.characterCount = metadata.Characters || 0;
  delete metadata.Characters;
  metadata.wordCount = metadata.Words || 0;
  delete metadata.Words;
  delete metadata.Pages;
  metadata.paragraphCount = metadata.Paragraphs || 0;
  delete metadata.Paragraphs;
  if (!metadata.Author) {
    metadata.Author = metadata.lastModifiedBy || "";
  }

  return metadata;
}

function stripPrefix(key) {
  return key.includes(":") ? key.split(":").pop() : key;
}
