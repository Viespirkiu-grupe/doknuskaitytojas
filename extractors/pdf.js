import fs from "fs";
import { execFile } from "child_process";
import { getDocument, AnnotationType } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Buffer } from "buffer";
import { randomUUID } from "crypto";
import path from "path";
import { log } from "../utils/log.js";
import { gautiViskaIsTeksto } from "../parsers/viskas.js";
import { nustatytiKokybiskesniTeksta } from "../utils/nustatytiKokybiskesniTeksta.js";

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
  } catch (e) {
    // Eh....
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
  let sloppyRedactations = [];
  let annotations = [];
  // Make the array have the same length as number of pages
  sloppyRedactations = new Array(pdf.numPages).fill(null);
  annotations = new Array(pdf.numPages).fill(null);

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);

    // Text
    const content = await page.getTextContent();
    let text = content.items.map((item) => item.str).join(" ");

    if (
      options.puslapiai &&
      options.puslapiai.length > 0 &&
      options.puslapiai[i - 1]
    ) {
      text = await nustatytiKokybiskesniTeksta(text, options.puslapiai[i - 1]);
    }

    let normalizedText = text.replace(/\s+/g, " ").trim();
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

    // Sloppy redactions
    sloppyRedactations[i - 1] = await findSloppyRedactions(
      page,
      2,
      content.items,
    );

    // Annotations
    annotations[i - 1] = await getAllPageAnnotations(page);
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
  metadata.sloppyRedactations = sloppyRedactations;
  metadata.annotations = annotations;

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

async function findSloppyRedactions(pdfPage, tolerance, textContent) {
  textContent ??= (await pdfPage.getTextContent()).items;
  const annotations = await getAllPageAnnotations(pdfPage);

  // Filter only black/red opaque annotations
  const coveredAreas = annotations.filter(
    (annot) =>
      !["Text", "Link", "FreeText"].includes(
        String(annot.annotationType).toLowerCase(),
      ) &&
      annot.color &&
      annot.opacity !== 0 &&
      (annot.color.toLowerCase() === "#000000" ||
        annot.color.toLowerCase() === "#ff0000"),
  );

  const findingsMap = new Map(); // key = annotation rect string

  for (const item of textContent) {
    const { str, width, height, transform } = item;
    if (!str?.trim()) continue;

    const L = transform[4];
    const T = transform[5];
    const textRect = [L, T, L + width, T + height];

    for (const area of coveredAreas) {
      const a = area.rect;
      if (!a) continue;

      const fullyCovered =
        !(a[0] - textRect[2] > tolerance) &&
        !(a[1] - textRect[3] > tolerance) &&
        !(a[2] - textRect[0] < tolerance) &&
        !(a[3] - textRect[1] < tolerance);

      if (fullyCovered) {
        const key = a.join(","); // group by annotation rect
        if (!findingsMap.has(key)) {
          findingsMap.set(key, {
            text: str,
            textRect: [...textRect],
            annotationRect: [...a],
            annotationType: area.annotationType,
            color: area.color,
            opacity: area.opacity,
          });
        } else {
          findingsMap.get(key).text += " " + str;
        }
      }
    }
  }

  const findings = Array.from(findingsMap.values());

  return {
    hasCrappyRedactions: findings.length > 0,
    count: findings.length,
    findings,
  };
}

function decodeAnnotationFlags(flags) {
  flags = Number(flags);
  return {
    Invisible: Boolean(flags & 1),
    Hidden: Boolean(flags & 2),
    Print: Boolean(flags & 4),
    NoZoom: Boolean(flags & 8),
    NoRotate: Boolean(flags & 16),
    NoView: Boolean(flags & 32),
    ReadOnly: Boolean(flags & 64),
    Locked: Boolean(flags & 128),
    ToggleNoView: Boolean(flags & 256),
    LockedContents: Boolean(flags & 512),
  };
}

async function getAllPageAnnotations(pdfPage) {
  const annotations = await pdfPage.getAnnotations();

  const results = [];

  for (const annot of annotations) {
    const normalized = {
      ...annot,
      id: annot.id ?? null,
      type: annot.annotationType,
      typeName: annot.subtype ?? null,
      rect: annot.rect ?? null,
      rotation: annot.rotation ?? 0,
      color: pdfColorToRGBA(annot.color).hex,
      opacity: annot.opacity ?? null,
      contents: annot.contents ?? null,
      author: annot.title ?? null,
      created: annot.creationDate ? parsePdfDate(annot.creationDate) : null,
      modified: annot.modificationDate
        ? parsePdfDate(annot.modificationDate)
        : null,
      flags: annot.annotationFlags
        ? decodeAnnotationFlags(annot.annotationFlags)
        : null,
      title: annot.titleObj?.str ?? "",
      contents: annot.contentsObj?.str ?? "",
      annotationType: annotationTypeToString(annot.annotationType),
      borderStyle: borderStyleToCSS(annot.borderStyle),
    };

    delete normalized.annotationFlags;
    delete normalized.modificationDate;
    delete normalized.creationDate;
    delete normalized.titleObj;
    delete normalized.contentsObj;
    delete normalized.type;
    // delete normalized.annotationFlags;

    results.push(normalized);
  }

  return results;
}

function pdfColorToRGBA(color) {
  if (!color || typeof color !== "object" || typeof color.length !== "number")
    return null;

  const arr = Array.from(color); // convert Uint8ClampedArray or normal array to standard array

  if (arr.length === 1) {
    const g = Math.round(arr[0] * 255);
    return { r: g, g: g, b: g, a: 1, hex: rgbToHex(g, g, g) };
  }

  if (arr.length === 3) {
    const [r, g, b] = arr.map((v) => Math.round(v * 255));
    return { r, g, b, a: 1, hex: rgbToHex(r, g, b) };
  }

  if (arr.length === 4) {
    const [c, m, y, k] = arr;
    const r = Math.round(255 * (1 - c) * (1 - k));
    const g = Math.round(255 * (1 - m) * (1 - k));
    const b = Math.round(255 * (1 - y) * (1 - k));
    return { r, g, b, a: 1, hex: rgbToHex(r, g, b) };
  }

  return null;
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function annotationTypeToString(typeNumber) {
  for (const [key, value] of Object.entries(AnnotationType)) {
    if (value === typeNumber) return key;
  }
  return "Unknown";
}

function borderStyleToCSS(borderStyle) {
  if (!borderStyle) return null;

  const width = borderStyle.width ?? 1;

  const styleMap = {
    0: "solid",
    1: "dashed",
    2: "solid", // beveled approximation
    3: "inset",
    4: "none", // underline, handle separately
  };

  const style = styleMap[borderStyle.style] ?? "solid";

  return {
    borderWidth: `${width}px`,
    borderStyle: style,
  };
}
