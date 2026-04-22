import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";
import { parseStringPromise } from "xml2js";
import { log } from "../utils/log.js";
import { convertToPdf } from "../utils/libreoffice.js";

const TMP_DIR = path.resolve("./tmp");
try {
  await fs.mkdir(TMP_DIR, { recursive: true });
} catch (err) {
  log("Failed to create TMP_DIR:", err);
}

/**
 * Convert XLSX file to PDF buffer using LibreOffice with 1 min hard kill
 * @param {string} xlsxPath
 */
export async function convertXlsxToPdfBuffer(xlsxPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(xlsxPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

/**
 * Extract XLSX content using PDF pipeline
 * @param {string} url XLSX file URL
 */
export async function extractXlsxContent(url) {
  // 1. Download XLSX
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  const xlsxBuffer = Buffer.from(arrayBuffer);

  const tmpXlsx = path.join(TMP_DIR, `${randomUUID()}.xlsx`);
  await fs.writeFile(tmpXlsx, xlsxBuffer);

  try {
    // Convert XLSX → PDF buffer
    const pdfBuffer = await convertXlsxToPdfBuffer(tmpXlsx);

    // Extract XLSX metadata
    const metadata = await extractXlsxMetadata(tmpXlsx);

    // Run PDF extractor
    let result = await extractPdfContent(pdfBuffer, { skipPdfMetadata: true });

    result.metadata = { ...result.metadata, ...metadata };

    return result;
  } finally {
    await fs.unlink(tmpXlsx).catch(() => {});
  }
}

/**
 * Extract metadata from XLSX
 * @param {string} xlsxPath
 */
export async function extractXlsxMetadata(xlsxPath) {
  const zip = new AdmZip(await fs.readFile(xlsxPath));
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
  { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  { ext: "xlsm", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", normalizedAs: "xlsx" },
  { ext: "xlsb", mime: "application/vnd.ms-excel.sheet.binary.macroEnabled.12", normalizedAs: "xlsx" },
];

export { extractXlsxContent as extract };
