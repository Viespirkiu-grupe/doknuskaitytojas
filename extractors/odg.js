import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import { convertToPdf } from "../utils/libreoffice.js";
import { fetchSafe } from "../utils/fetchSafe.js";
import { log } from "../utils/log.js";

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
  const buffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const tmpOdg = path.join(TMP_DIR, `${randomUUID()}.odg`);
  await fs.writeFile(tmpOdg, buffer);

  try {
    // Convert ODG → PDF
    let t = Date.now();
    const pdfBuffer = await convertOdgToPdfBuffer(tmpOdg);
    const result = await extractPdfContent(pdfBuffer, { docPropsOnly: true });
    log(`${((Date.now() - t) / 1000).toFixed(2)}s`);
    return result;
  } finally {
    await fs.unlink(tmpOdg).catch(() => {});
  }
}

export const fileTypes = [
  { ext: "odg", mime: "application/vnd.oasis.opendocument.graphics" },
];

export { extractOdgContent as extract };
