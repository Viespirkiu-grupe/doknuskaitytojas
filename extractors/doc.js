import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import { convertToPdf } from "../utils/libreoffice.js";
import { fetchSafe } from "../utils/fetchSafe.js";
import { log } from "../utils/log.js";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

/**
 * Convert a .doc file to PDF using LibreOffice and return the PDF as a Buffer.
 * @param {string} docPath - Path to the .doc file.
 * @returns {Promise<Buffer>} - Promise that resolves to the PDF file as a Buffer.
 */
export async function convertDocToPdfBuffer(docPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(docPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

/**
 * Extract text content and metadata from a .doc file at the given URL.
 * Converts the .doc file to PDF using LibreOffice, then extracts content from the PDF.
 * @param {string} url - URL of the .doc file.
 * @returns {Promise<{ text: string, metadata: object }>} - Promise that resolves to an object containing extracted text and metadata.
 */
export async function extractDocContent(url) {
  const buffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const tmpDoc = path.join(TMP_DIR, `${randomUUID()}.doc`);
  await fs.writeFile(tmpDoc, buffer);

  try {
    let t = Date.now();
    const pdfBuffer = await convertDocToPdfBuffer(tmpDoc);
    const result = await extractPdfContent(pdfBuffer, { skipPdfMetadata: true });
    log(`${((Date.now() - t) / 1000).toFixed(2)}s`);
    return result;
  } finally {
    await fs.unlink(tmpDoc).catch(() => {});
  }
}

export const fileTypes = [
  { ext: "doc",   mime: "application/msword" },
  { ext: "dot",   mime: "application/msword", normalizedAs: "doc" },
  { ext: "pages", mime: "application/vnd.apple.pages", normalizedAs: "doc" },
];

export { extractDocContent as extract };
