import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import { convertToPdf } from "../utils/libreoffice.js";
import { fetchSafe } from "../utils/fetchSafe.js";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

export async function convertPptToPdfBuffer(pptPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(pptPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

export async function extractPptContent(url) {
  const buffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const tmpPpt = path.join(TMP_DIR, `${randomUUID()}.ppt`);
  await fs.writeFile(tmpPpt, buffer);

  try {
    // Convert PPT → PDF
    let t = Date.now();
    const pdfBuffer = await convertPptToPdfBuffer(tmpPpt);
    log(`LibreOffice: ${((Date.now() - t) / 1000).toFixed(2)}s`);

    // Extract PDF content & metadata
    const result = await extractPdfContent(pdfBuffer, {
      skipPdfMetadata: true,
    });

    return result;
  } finally {
    await fs.unlink(tmpPpt).catch(() => {});
  }
}

export const fileTypes = [
  { ext: "ppt", mime: "application/vnd.ms-powerpoint" },
];

export { extractPptContent as extract };
