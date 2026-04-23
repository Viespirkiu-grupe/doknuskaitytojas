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
 * Convert PPTX file to PDF buffer using LibreOffice with 1 min hard kill
 * @param {string} pptxPath
 */
export async function convertPptxToPdfBuffer(pptxPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(pptxPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

/**
 * Extract PPTX content using PDF pipeline
 * @param {string} url PPTX file URL
 */
export async function extractPptxContent(url) {
  // 1. Download PPTX
  const pptxBuffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const tmpPptx = path.join(TMP_DIR, `${randomUUID()}.pptx`);
  await fs.writeFile(tmpPptx, pptxBuffer);

  try {
    let t = Date.now();
    const pdfBuffer = await convertPptxToPdfBuffer(tmpPptx);
    log(`LibreOffice: ${((Date.now() - t) / 1000).toFixed(2)}s`);

    // Extract PPTX metadata
    const metadata = await extractPptxMetadata(tmpPptx);

    // Run PDF extractor
    let result = await extractPdfContent(pdfBuffer, { skipPdfMetadata: true });

    result.metadata = { ...result.metadata, ...metadata };

    return result;
  } finally {
    await fs.unlink(tmpPptx).catch(() => {});
  }
}

/**
 * Extract metadata from PPTX
 * @param {string} pptxPath
 */
export async function extractPptxMetadata(pptxPath) {
  const zip = new AdmZip(await fs.readFile(pptxPath));
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

  // Normalize metadata keys
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
  delete metadata.Slides;
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
  { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  { ext: "ppsx", mime: "application/vnd.openxmlformats-officedocument.presentationml.slideshow", normalizedAs: "pptx" },
];

export { extractPptxContent as extract };
