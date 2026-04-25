import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import { convertToPdf } from "../utils/libreoffice.js";
import { fetchSafe } from "../utils/fetchSafe.js";
import { log } from "../utils/log.js";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

async function convertPubToPdfBuffer(pubPath) {
  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    await convertToPdf(pubPath, pdfPath);
    return await fs.readFile(pdfPath);
  } finally {
    await fs.unlink(pdfPath).catch(() => {});
  }
}

export async function extractPubContent(url) {
  const buffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const tmpPub = path.join(TMP_DIR, `${randomUUID()}.pub`);
  await fs.writeFile(tmpPub, buffer);

  try {
    // Convert PUB → PDF
    let t = Date.now();
    const pdfBuffer = await convertPubToPdfBuffer(tmpPub);
    const result = await extractPdfContent(pdfBuffer, { docPropsOnly: true });
    log(`${((Date.now() - t) / 1000).toFixed(2)}s`);
    return result;
  } finally {
    await fs.unlink(tmpPub).catch(() => {});
  }
}

export const fileTypes = [
  { ext: "pub", mime: "application/x-mspublisher" },
];

export { extractPubContent as extract };
