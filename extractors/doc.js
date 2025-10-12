import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import treeKill from "tree-kill";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

/**
 * Convert a .doc file to PDF using LibreOffice and return the PDF as a Buffer.
 * @param {string} docPath - Path to the .doc file.
 * @returns {Promise<Buffer>} - Promise that resolves to the PDF file as a Buffer.
 */
export async function convertDocToPdfBuffer(docPath) {
  const pdfPath = path.join(TMP_DIR, path.basename(docPath, ".doc") + ".pdf");

  let child;
  const promise = new Promise((resolve, reject) => {
    child = spawn("libreoffice", [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      TMP_DIR,
      docPath,
    ]);

    child.on("error", reject);

    child.on("exit", async (code) => {
      try {
        if (code !== 0)
          return reject(new Error(`LibreOffice exited with code ${code}`));
        const buffer = await fs.readFile(pdfPath);
        await fs.unlink(pdfPath).catch(() => {});
        resolve(buffer);
      } catch (err) {
        reject(err);
      }
    });
  });

  const timer = setTimeout(
    () => {
      if (child?.pid) treeKill(child.pid, "SIGKILL");
    },
    parseInt(process.env.LIBREOFFICE_TIMEOUT ?? "15", 10) * 1000,
  );

  try {
    return await promise;
  } finally {
    clearTimeout(timer);
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
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  const tmpDoc = path.join(TMP_DIR, `${randomUUID()}.doc`);
  await fs.writeFile(tmpDoc, buffer);

  try {
    // Convert DOC → PDF
    const pdfBuffer = await convertDocToPdfBuffer(tmpDoc);

    // Extract PDF content & metadata
    const result = await extractPdfContent(pdfBuffer, {
      skipPdfMetadata: true,
    });

    return result;
  } finally {
    await fs.unlink(tmpDoc).catch(() => {});
  }
}
