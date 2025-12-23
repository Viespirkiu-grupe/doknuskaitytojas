import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import treeKill from "tree-kill";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

async function convertOdgToPdfBuffer(odgPath) {
  const pdfPath = path.join(TMP_DIR, path.basename(odgPath, ".odg") + ".pdf");

  let child;
  const promise = new Promise((resolve, reject) => {
    child = spawn("libreoffice", [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      TMP_DIR,
      odgPath,
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
