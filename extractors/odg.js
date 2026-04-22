import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import { convertToPdf } from "../utils/libreoffice.js";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

async function convertOdgToPdfBuffer(odgPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(odgPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

export async function extractOdgContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpOdg = path.join(TMP_DIR, `${randomUUID()}.odg`);
  await fs.writeFile(tmpOdg, buffer);

  try {
    // Convert ODG → PDF
    const pdfBuffer = await convertOdgToPdfBuffer(tmpOdg);

    // Extract PDF content & metadata
    const result = await extractPdfContent(pdfBuffer, {
      skipPdfMetadata: true,
    });

    return result;
  } finally {
    await fs.unlink(tmpOdg).catch(() => {});
  }
}

export const fileTypes = [
  { ext: "odg", mime: "application/vnd.oasis.opendocument.graphics" },
];

export { extractOdgContent as extract };
