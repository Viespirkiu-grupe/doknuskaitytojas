import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import { convertToPdf } from "../utils/libreoffice.js";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

export async function convertXlsToPdfBuffer(xlsPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(xlsPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

export async function extractXlsContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpXls = path.join(TMP_DIR, `${randomUUID()}.xls`);
  await fs.writeFile(tmpXls, buffer);

  try {
    // Convert XLS → PDF
    const pdfBuffer = await convertXlsToPdfBuffer(tmpXls);

    // Extract PDF content & metadata
    const result = await extractPdfContent(pdfBuffer, {
      skipPdfMetadata: true,
    });

    return result;
  } finally {
    await fs.unlink(tmpXls).catch(() => {});
  }
}

export const fileTypes = [
  { ext: "xls", mime: "application/vnd.ms-excel" },
  { ext: "csv", mime: "text/csv" },
];

export { extractXlsContent as extract };
