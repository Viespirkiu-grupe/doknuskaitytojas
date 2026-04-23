import fs from "fs/promises";
import path from "path";
import { extractPdfContent } from "./pdf.js";
import { randomUUID } from "crypto";
import { convertToPdf } from "../utils/libreoffice.js";
import { log } from "../utils/log.js";
import iconv from "iconv-lite";
import { fetchSafe } from "../utils/fetchSafe.js";

const TMP_DIR = path.resolve("./tmp");
await fs.mkdir(TMP_DIR, { recursive: true });

function parseRtfMetadata(buffer) {
  const rtf = buffer.toString("latin1");

  const ansicpg = rtf.match(/\\ansicpg(\d+)/)?.[1];
  const encoding = ansicpg ? `cp${ansicpg}` : "cp1252";

  function decodeRtfText(text) {
    // RTF Unicode escapes \uN? → actual character
    text = text.replace(/\\u(-?\d+)\??/g, (_, n) => {
      const cp = parseInt(n);
      return String.fromCodePoint(cp < 0 ? cp + 65536 : cp);
    });
    // Consecutive \'xx bytes → decode as a group using the codepage
    text = text.replace(/((?:\\'[0-9a-fA-F]{2})+)/g, (seq) => {
      const bytes = Buffer.from(
        seq.match(/\\'([0-9a-fA-F]{2})/g).map((h) => parseInt(h.slice(2), 16)),
      );
      return iconv.decode(bytes, encoding);
    });
    return text;
  }

  function extractGroupText(keyword) {
    const re = new RegExp(`\\{\\\\${keyword}\\s+([^}]*)\\}`, "i");
    const m = rtf.match(re);
    if (!m) return null;
    return decodeRtfText(m[1])
      .replace(/\\[a-z]+\d*[ ]?/gi, "")
      .replace(/[{}\\]/g, "")
      .trim() || null;
  }

  function extractDate(keyword) {
    const re = new RegExp(`\\{\\\\${keyword}([^}]*)\\}`, "i");
    const m = rtf.match(re);
    if (!m) return null;
    const part = m[1];
    const yr  = part.match(/\\yr(\d+)/)?.[1];
    const mo  = part.match(/\\mo(\d+)/)?.[1] ?? "1";
    const dy  = part.match(/\\dy(\d+)/)?.[1] ?? "1";
    const hr  = part.match(/\\hr(\d+)/)?.[1] ?? "0";
    const min = part.match(/\\min(\d+)/)?.[1] ?? "0";
    const sec = part.match(/\\sec(\d+)/)?.[1] ?? "0";
    if (!yr) return null;
    return new Date(Date.UTC(+yr, +mo - 1, +dy, +hr, +min, +sec)).toISOString();
  }

  const genM = rtf.match(/\{\\\*\\generator\s+([^}]*)\}/i);
  const generator = genM ? genM[1].trim().replace(/;$/, "").trim() || null : null;

  const result = {
    author:     extractGroupText("author"),
    operator:   extractGroupText("operator"),
    createdAt:  extractDate("creatim"),
    modifiedAt: extractDate("revtim"),
    generator,
  };

  return Object.fromEntries(Object.entries(result).filter(([, v]) => v != null));
}

export async function extractRtfContent(url) {
  const buffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const rtfMetadata = parseRtfMetadata(buffer);

  const tmpRtf = path.join(TMP_DIR, `${randomUUID()}.rtf`);
  await fs.writeFile(tmpRtf, buffer);

  const pdfPath = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    let t = Date.now();
    await convertToPdf(tmpRtf, pdfPath);
    const pdfBuffer = await fs.readFile(pdfPath);
    log(`LibreOffice: ${((Date.now() - t) / 1000).toFixed(2)}s`);
    const result = await extractPdfContent(pdfBuffer, { skipPdfMetadata: true });
    Object.assign(result.metadata, rtfMetadata);
    return result;
  } finally {
    await fs.unlink(tmpRtf).catch(() => {});
    await fs.unlink(pdfPath).catch(() => {});
  }
}

export const fileTypes = [
  { ext: "rtf", mime: "application/rtf" },
];

export { extractRtfContent as extract };
