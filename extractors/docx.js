import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { parseStringPromise } from "xml2js";
import { log } from "../utils/log.js";
import { convertToPdf } from "../utils/libreoffice.js";
import { fetchSafe } from "../utils/fetchSafe.js";

const stripDoctype = (xml) => xml.replace(/<!DOCTYPE\b[\s\S]*?(?:\[[\s\S]*?])?\s*>/i, "");

const TMP_DIR = path.resolve("./tmp");
try {
  await fs.mkdir(TMP_DIR, { recursive: true });
} catch (err) {
  log("Failed to create TMP_DIR:", err);
}

/**
 * Convert DOCX file to PDF buffer using LibreOffice with 1 min hard kill
 * Cleans up temp PDF on failure or timeout
 * @param {string} docxPath
 */
export async function convertDocxToPdfBuffer(docxPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(docxPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

/**
 * Extract DOCX content using PDF pipeline
 * @param {string} url DOCX file URL
 */
export async function extractDocxContent(url) {
  // 1. Download DOCX
  const docxBuffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const tmpDocx = path.join(TMP_DIR, `${randomUUID()}.docx`);

  await fs.writeFile(tmpDocx, docxBuffer);

  try {
    let t = Date.now();
    const pdfBuffer = await convertDocxToPdfBuffer(tmpDocx);
    const metadata = await extractDocxMetadata(tmpDocx);
    let result = await extractPdfContent(pdfBuffer, { skipPdfMetadata: true });
    log(`${((Date.now() - t) / 1000).toFixed(2)}s`);
    result.metadata = { ...result.metadata, ...metadata };
    return result;
  } finally {
    await fs.unlink(tmpDocx).catch(() => {});
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
    const parsed = await parseStringPromise(stripDoctype(coreXml));
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
    const parsed = await parseStringPromise(stripDoctype(appXml));
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
    const parsed = await parseStringPromise(stripDoctype(customXml));
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

export const fileTypes = [
  { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  { ext: "docm", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", normalizedAs: "docx" },
  { ext: "dotx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", normalizedAs: "docx" },
  { ext: "odt",  mime: "application/vnd.oasis.opendocument.text", normalizedAs: "docx" },
];

export { extractDocxContent as extract };
