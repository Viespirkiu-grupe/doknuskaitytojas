import fs from "fs";
import { execFile } from "child_process";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Buffer } from "buffer";
import { randomUUID } from "crypto";
import path from "path";
import { log } from "../utils/log.js";
import { gautiViskaIsTeksto } from "../parsers/viskas.js";

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

export async function extractPdfContent(input, options = {}) {
  let start = new Date();

  //// Get the PDF file
  let buffer;

  // Determine if input is a Buffer or URL
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else {
    // Assume input is a URL
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch ${input}: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }

  log(`1. Fetchpdf took ${((new Date() - start) / 1000).toFixed(3)}s`);

  //// Extract PDF Signatures
  start = new Date();

  let signatureInfo = null;
  const tmpFile = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    fs.writeFileSync(tmpFile, buffer);

    signatureInfo = await runPdfSig(tmpFile);
  } finally {
    fs.unlinkSync(tmpFile);
  }

  log(`2. Signpdf took ${((new Date() - start) / 1000).toFixed(3)}s`);

  //// Extract PDF content & metadata
  start = new Date();

  // Load PDF in memory
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    verbosity: 0,
  });
  const pdf = await loadingTask.promise;

  const pages = [];
  const linksMap = new Map(); // key: uri, value: Set of page numbers
  const emailsMap = new Map(); // key: email, value: Set of page numbers
  const sloppyRedactionsInPages = new Set();

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    // Text
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str).join(" ");
    const normalizedText = text.replace(/\s+/g, " ").trim();
    pages.push(normalizedText);

    // Links
    const annots = await page.getAnnotations();
    for (const annot of annots) {
      if (annot.subtype === "Link" && annot.url) {
        const uri = annot.url.trim();
        const set = linksMap.get(uri) || new Set();
        set.add(i);
        linksMap.set(uri, set);

        if (uri.toLowerCase().startsWith("mailto:")) {
          const email = uri.slice(7);
          const emailSet = emailsMap.get(email) || new Set();
          emailSet.add(i);
          emailsMap.set(email, emailSet);
        }
      }
    }
  }
  log(`3. PDFJS took ${((new Date() - start) / 1000).toFixed(3)}s`);

  /// Surašome metadata
  // Pridedame PDF metadata
  if (!options.skipPdfMetadata) {
    var meta = await pdf.getMetadata();
    var metadata = Object.fromEntries(
      Object.entries(meta.info).map(([key, value]) => {
        if (/date/i.test(key)) {
          const parsed = parsePdfDate(value);
          return [key, parsed || value];
        }
        return [key, value];
      }),
    );
  } else {
    var metadata = {};
  }

  let tekstoMetadata = gautiViskaIsTeksto(pages);
  metadata = { ...metadata, ...tekstoMetadata };

  // Sujungiame teksto + PDF dokumento link
  const pdfLink = Array.from(linksMap.entries()).map(([uri, pages]) => ({
    uri,
    pages: Array.from(pages).sort((a, b) => a - b),
  }));

  metadata.links = Array.from(
    (() => {
      const map = new Map();

      [...metadata.links, ...pdfLink].forEach(({ uri, pages }) => {
        if (!map.has(uri)) map.set(uri, new Set(pages));
        else pages.forEach((p) => map.get(uri).add(p));
      });

      return map;
    })(),
    ([uri, pagesSet]) => ({
      uri,
      pages: Array.from(pagesSet).sort((a, b) => a - b),
    }),
  );

  // Sujungiame teksto ir mailto: email
  let linkEmails = metadata.links
    .filter((l) => l.uri.toLowerCase().startsWith("mailto:"))
    .map((l) => ({
      email: l.uri.slice(7),
      pages: l.pages,
    }));

  metadata.emails = Array.from(
    (() => {
      const map = new Map();

      [...linkEmails, ...metadata.emails].forEach(({ email, pages }) => {
        if (!map.has(email)) map.set(email, new Set(pages));
        else pages.forEach((p) => map.get(email).add(p));
      });

      return map;
    })(),
    ([email, pagesSet]) => ({
      email,
      pages: Array.from(pagesSet).sort((a, b) => a - b),
    }),
  );

  metadata.sloppyRedactions = [...sloppyRedactionsInPages.values()];

  if (signatureInfo) {
    metadata.signatures = parsePdfSigOutput(signatureInfo).signatures;
  }

  /// Apvalome metadata
  metadata = cleanMetadata(metadata);

  return {
    pages,
    metadata,
  };
}

async function runPdfSig(filePath) {
  return new Promise((resolve, reject) => {
    execFile("pdfsig", [filePath, "-nocert"], (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

function parsePdfDate(pdfDate) {
  if (!pdfDate || !pdfDate.startsWith("D:")) return null;
  const match = pdfDate.match(
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z\+\-])?(\d{2})?'?(\d{2})?'?/,
  );
  if (!match) return null;
  let [_, year, month, day, hour, minute, second, zone, zHour, zMin] = match;
  month ||= "01";
  day ||= "01";
  hour ||= "00";
  minute ||= "00";
  second ||= "00";
  let iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (!zone || zone === "Z") iso += "Z";
  else if (zone === "+" || zone === "-") {
    zHour ||= "00";
    zMin ||= "00";
    iso += `${zone}${zHour}:${zMin}`;
  }
  return iso;
}

function parsePdfSigOutput(output) {
  const lines = output.split("\n").map((l) => l.trim());
  const signatures = [];
  let currentSig = null;

  for (let line of lines) {
    if (!line) continue;

    // Signature number
    const sigMatch = line.match(/^Signature #(\d+):$/);
    if (sigMatch) {
      if (currentSig) signatures.push(currentSig);
      currentSig = { signatureNumber: Number(sigMatch[1]) };
      continue;
    }

    // Key-Value pair
    const kvMatch = line.match(/^-\s*(.+?):\s*(.+)$/);
    if (kvMatch && currentSig) {
      let [_, key, value] = kvMatch;

      // Convert key to camelCase
      key = key
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .split(" ")
        .map((w, i) =>
          i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1),
        )
        .join("");

      // Special handling
      if (key === "signedRanges") {
        value = value
          .split("], [")
          .map((v) => v.replace(/\[|\]/g, "").split(" - ").map(Number));
      }

      if (key === "signingTime") {
        value = new Date(value);
      }

      currentSig[key] = value;
      continue;
    }

    // Total document signed (boolean)
    if (line.startsWith("- Total document signed") && currentSig) {
      currentSig.totalDocumentSigned = true;
      continue;
    }
  }

  if (currentSig) signatures.push(currentSig);
  return { signatures };
}

function cleanMetadata(obj) {
  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const value = obj[key];
    if (typeof value === "string") {
      // Remove null chars and trim
      obj[key] = value.replace(/\u0000/g, "").trim();
    } else if (typeof value === "object" && value !== null) {
      // Recursively clean nested objects
      cleanMetadata(value);
    }
  }
  return obj;
}

async function searchForSloppyRedactionsInPage(
  pdfPage,
  tolerance,
  textContent,
  annotations,
) {
  const pageExtents = pdfPage.view;

  textContent ??= (await pdfPage.getTextContent()).items;

  annotations ??= await pdfPage.getAnnotations();

  const coveredAreas = annotations.reduce((areas, annot) => {
    // ignore TEXT | LINK | FREETEXT annotations
    if ([1, 2, 3].includes(annot.annotationType)) {
      return areas;
    }

    if (annot.rotation) {
      log(`Rotated annotations not supported 🙃`);
      return areas;
    }

    areas.push({
      rotation: annot.rotation,
      extentsLTRB: annot.rect,
    });

    return areas;
  }, []);

  return textContent.some((item) => {
    const { str, width, height, transform } = item;
    if (!str?.trim()) {
      return false;
    }

    const extentL = transform[4];
    const extentT = transform[5];

    const extentsLTRB = [extentL, extentT, extentL + width, extentT + height];

    return coveredAreas.some((area) => {
      const testLTRB = area.extentsLTRB;

      if (testLTRB[0] - extentsLTRB[2] > tolerance) {
        return false;
      }
      if (testLTRB[1] - extentsLTRB[3] > tolerance) {
        return false;
      }

      if (testLTRB[2] - extentsLTRB[0] < tolerance) {
        return false;
      }
      if (testLTRB[3] - extentsLTRB[1] < tolerance) {
        return false;
      }

      return true;
    });
  });
}
