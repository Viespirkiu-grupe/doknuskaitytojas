import { readFile, writeFile } from "fs/promises";
import path from "path";

const UNO_HOST     = process.env.UNOSERVER_HOST ?? "unoserver";
const UNO_PORT     = parseInt(process.env.UNOSERVER_PORT ?? "2004", 10);
const CONV_TIMEOUT = parseInt(process.env.LIBREOFFICE_TIMEOUT ?? "60", 10) * 1000;

export async function convertToPdf(inputPath, outputPath) {
  const fileBuffer = await readFile(inputPath);
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), path.basename(inputPath));
  formData.append("convert-to", "pdf");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONV_TIMEOUT);

  let response;
  try {
    response = await fetch(`http://${UNO_HOST}:${UNO_PORT}/request`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`unoserver conversion failed: ${response.status} ${response.statusText}`);
  }

  const pdfBuffer = await response.arrayBuffer();
  await writeFile(outputPath, Buffer.from(pdfBuffer));
}
