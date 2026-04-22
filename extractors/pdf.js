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

/**
 * Merge two arrays of `{ uri|email, pages }` objects, unioning the page sets
 * for entries that share the same key.
 *
 * @template {{ pages: number[] }} T
 * @param {string} keyField       - The property name to group by (e.g. "uri" or "email")
 * @param {...T[]} sources        - Two or more arrays to merge
 * @returns {T[]}
 */
function mergePagedItems(keyField, ...sources) {
  const map = new Map();
  for (const items of sources) {
    for (const item of items) {
      const key = item[keyField];
      if (!map.has(key)) map.set(key, new Set(item.pages));
      else item.pages.forEach((p) => map.get(key).add(p));
    }
  }
  return Array.from(map.entries()).map(([key, pagesSet]) => ({
    [keyField]: key,
    pages: Array.from(pagesSet).sort((a, b) => a - b),
  }));
}

/**
 * Parse a PDF date string (`D:YYYYMMDDHHmmSSOHH'mm'`) into an ISO 8601 string.
 *
 * Returns `null` when the input is absent or does not match the expected format.
 *
 * @param {string | null | undefined} pdfDate
 * @returns {string | null}
 */
function parsePdfDate(pdfDate) {
  if (!pdfDate || !pdfDate.startsWith("D:")) return null;
  const match = pdfDate.match(
    /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+\-])?(\d{2})?'?(\d{2})?'?/,
  );
  if (!match) return null;
  let [, year, month = "01", day = "01", hour = "00", minute = "00", second = "00", zone, zHour = "00", zMin = "00"] = match;
  let iso = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  if (!zone || zone === "Z") iso += "Z";
  else                        iso += `${zone}${zHour}:${zMin}`;
  return iso;
}

/**
 * Run `pdfsig -nocert` on a PDF file and return its stdout.
 *
 * @param {string} filePath - Absolute path to a temporary PDF file
 * @returns {Promise<string>}
 */
function runPdfSig(filePath) {
  return new Promise((resolve, reject) => {
    execFile("pdfsig", [filePath, "-nocert"], (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
  });
}

/**
 * Parse the text output of `pdfsig` into a structured signature list.
 *
 * @param {string} output - Raw stdout from `pdfsig`
 * @returns {object[]}
 */
function parsePdfSigOutput(output) {
  const lines = output.split("\n").map((l) => l.trim());
  const signatures = [];
  let cur = null;

  for (const line of lines) {
    if (!line) continue;

    const sigMatch = line.match(/^Signature #(\d+):$/);
    if (sigMatch) {
      if (cur) signatures.push(cur);
      cur = { number: Number(sigMatch[1]), totalDocumentSigned: false };
      continue;
    }

    if (!cur) continue;

    if (line.startsWith("- Total document signed")) {
      cur.totalDocumentSigned = true;
      continue;
    }

    if (line.startsWith("- Not total document signed")) continue;

    const kvMatch = line.match(/^-\s*(.+?):\s*(.*)$/);
    if (!kvMatch) continue;

    const [, rawKey, rawValue] = kvMatch;
    const value = rawValue.trim();

    const keyMap = {
      "Signature Field Name":             "fieldName",
      "Signer Certificate Common Name":   "signerCN",
      "Signer full Distinguished Name":   "signerDN",
      "Signing Time":                     "signingTime",
      "Signing Hash Algorithm":           "hashAlgorithm",
      "Signature Type":                   "type",
      "Signed Ranges":                    "signedRanges",
      "Signature Validation":             "validation",
    };

    const key = keyMap[rawKey.trim()];
    if (!key) continue;

    if (key === "signedRanges") {
      cur[key] = value
        .split("], [")
        .map((v) => v.replace(/\[|\]/g, "").split(" - ").map(Number));
    } else if (key === "signingTime") {
      cur[key] = value ? new Date(value).toISOString() : null;
    } else if (key === "hashAlgorithm") {
      cur[key] = value && value !== "unknown" ? value : null;
    } else if (key === "validation") {
      cur.validation = value || null;
      cur.isValid =
        value === "Signature is Valid."   ? true  :
        value === "Signature is Invalid." ? false : null;
    } else if (key === "signerDN") {
      if (value) {
        cur.signerCountry = value.match(/(?:^|,)C=([A-Z]{2})(?:,|$)/)?.[1] ?? null;
        cur.hasPersonalId = /(?:^|,)serialNumber=(?:PNOLT-|\d{11})/.test(value);
        const emailMatch  = value.match(/(?:^|,)(?:E|emailAddress)=([^,]+)/i);
        cur.signerEmail   = emailMatch ? emailMatch[1].trim() : null;
      }
      // signerDN intentionally not stored — contains personal identity numbers
    } else {
      cur[key] = value || null;
    }
  }

  if (cur) signatures.push(cur);
  return signatures;
}

/**
 * Recursively strip null characters and trim strings in a metadata object.
 * Mutates and returns the object.
 *
 * @template {object} T
 * @param {T} obj
 * @returns {T}
 */
function cleanMetadata(obj) {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "string") {
      obj[key] = value.replace(/\u0000/g, "").trim();
    } else if (value !== null && typeof value === "object") {
      cleanMetadata(value);
    }
  }
  return obj;
}

/**
 * Decode a PDF annotation flags integer into a named boolean map.
 *
 * @param {number} flags
 * @returns {Record<string, boolean>}
 */
function decodeAnnotationFlags(flags) {
  flags = Number(flags);
  return {
    Invisible:      Boolean(flags & 1),
    Hidden:         Boolean(flags & 2),
    Print:          Boolean(flags & 4),
    NoZoom:         Boolean(flags & 8),
    NoRotate:       Boolean(flags & 16),
    NoView:         Boolean(flags & 32),
    ReadOnly:       Boolean(flags & 64),
    Locked:         Boolean(flags & 128),
    ToggleNoView:   Boolean(flags & 256),
    LockedContents: Boolean(flags & 512),
  };
}

/**
 * Convert a pdfjs-dist color array (greyscale, RGB, or CMYK) to an RGBA
 * object and CSS hex string.
 *
 * @param {number[] | Uint8ClampedArray | null} color
 * @returns {{ r: number, g: number, b: number, a: number, hex: string } | null}
 */
function pdfColorToRGBA(color) {
  if (!color || typeof color !== "object" || typeof color.length !== "number") return null;
  const arr = Array.from(color);

  if (arr.length === 1) {
    const g = Math.round(arr[0] * 255);
    return { r: g, g, b: g, a: 1, hex: rgbToHex(g, g, g) };
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

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

/**
 * Convert a pdfjs-dist {@link AnnotationType} integer to its string name.
 *
 * @param {number} typeNumber
 * @returns {string}
 */
function annotationTypeToString(typeNumber) {
  for (const [key, value] of Object.entries(AnnotationType)) {
    if (value === typeNumber) return key;
  }
  return "Unknown";
}

/**
 * Convert a pdfjs-dist border style object to a CSS-like descriptor.
 *
 * @param {{ width?: number, style?: number } | null} borderStyle
 * @returns {{ borderWidth: string, borderStyle: string } | null}
 */
function borderStyleToCSS(borderStyle) {
  if (!borderStyle) return null;
  const styleMap = { 0: "solid", 1: "dashed", 2: "solid", 3: "inset", 4: "none" };
  return {
    borderWidth: `${borderStyle.width ?? 1}px`,
    borderStyle: styleMap[borderStyle.style] ?? "solid",
  };
}

/**
 * Normalise all annotations on a PDF page into a consistent shape.
 *
 * Binary attachment content is stripped. Dates are parsed from PDF date
 * strings. Colours are converted to hex. Annotation flags are decoded.
 *
 * @param {import("pdfjs-dist").PDFPageProxy} pdfPage
 * @returns {Promise<object[]>}
 */
async function getAllPageAnnotations(pdfPage) {
  const annotations = await pdfPage.getAnnotations();
  return annotations.map((annot) => {
    if (annot.annotationType === AnnotationType.FILEATTACHMENT && annot.file) {
      delete annot.file.content;
    }

    const normalized = {
      ...annot,
      id:             annot.id ?? null,
      typeName:       annot.subtype ?? null,
      rect:           annot.rect ?? null,
      rotation:       annot.rotation ?? 0,
      color:          annot.color ? pdfColorToRGBA(annot.color)?.hex : null,
      opacity:        annot.opacity ?? null,
      author:         annot.title ?? null,
      created:        annot.creationDate ? parsePdfDate(annot.creationDate) : null,
      modified:       annot.modificationDate ? parsePdfDate(annot.modificationDate) : null,
      flags:          annot.annotationFlags ? decodeAnnotationFlags(annot.annotationFlags) : null,
      title:          annot.titleObj?.str ?? "",
      contents:       annot.contentsObj?.str ?? annot.contents ?? "",
      annotationType: annotationTypeToString(annot.annotationType),
      borderStyle:    borderStyleToCSS(annot.borderStyle),
    };

    delete normalized.annotationFlags;
    delete normalized.modificationDate;
    delete normalized.creationDate;
    delete normalized.titleObj;
    delete normalized.contentsObj;
    delete normalized.type;

    return normalized;
  });
}

/**
 * Detect "sloppy redactions": text items that are visually covered by a black
 * or red opaque annotation but remain in the PDF content stream.
 *
 * @param {import("pdfjs-dist").PDFPageProxy} pdfPage
 * @param {number} tolerance  - Pixel tolerance for overlap detection
 * @param {object[]} [textContent] - Pre-fetched text items (avoids a second fetch)
 * @returns {Promise<{ hasCrappyRedactions: boolean, count: number, findings: object[] }>}
 */
async function findSloppyRedactions(pdfPage, pageNumber, tolerance, textContent) {
  textContent ??= (await pdfPage.getTextContent()).items;
  const annotations = await getAllPageAnnotations(pdfPage);

  const EXCLUDED_TYPES = new Set(["TEXT", "LINK", "FREETEXT", "WIDGET"]);
  const coveredAreas = annotations.filter(
    (annot) =>
      !EXCLUDED_TYPES.has(String(annot.annotationType).toUpperCase()) &&
      annot.color &&
      annot.opacity !== 0 &&
      (annot.color === "#000000" || annot.color === "#ff0000"),
  );

  const findingsMap = new Map();

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
        const key = a.join(",");
        if (!findingsMap.has(key)) {
          findingsMap.set(key, {
            page: pageNumber,
            text: str,
            annotationRect: [...a],
            annotationType: area.annotationType,
            color: area.color,
          });
        } else {
          findingsMap.get(key).text += " " + str;
        }
      }
    }
  }

  return Array.from(findingsMap.values());
}

/**
 * Extract text, metadata, annotations, and signature information from a PDF.
 *
 * Accepts either a URL string or a pre-loaded Buffer. When `options.puslapiai`
 * is provided, each page's pdfjs-dist text is compared against the supplied
 * alternative (e.g. from pdftotext) and the higher-quality version is kept.
 *
 * Extracted links and emails from PDF annotation objects are merged with those
 * found by the text parser so neither source is lost.
 *
 * @param {string | Buffer} input      - URL of the PDF to fetch, or a Buffer
 * @param {{
 *   puslapiai?: string[],
 *   skipPdfMetadata?: boolean,
 * }} [options]
 * @returns {Promise<{ pages: string[], metadata: object }>}
 */
export async function extractPdfContent(input, options = {}) {
  let start = new Date();

  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch ${input}: ${res.statusText}`);
    buffer = Buffer.from(await res.arrayBuffer());
  }
  log(`1. Fetchpdf took ${((new Date() - start) / 1000).toFixed(3)}s`);

  // Extract digital signatures via pdfsig (poppler-utils) — skip for converted docs
  start = new Date();
  let signatureInfo = null;
  if (!options.skipPdfMetadata) {
    const tmpFile = path.join(TMP_DIR, `${randomUUID()}.pdf`);
    try {
      fs.writeFileSync(tmpFile, buffer);
      signatureInfo = await runPdfSig(tmpFile);
    } catch {
      // pdfsig may not be installed or the PDF may have no signatures
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }
  log(`2. Signpdf took ${((new Date() - start) / 1000).toFixed(3)}s`);

  // Extract page text, links, and annotations via pdfjs-dist
  start = new Date();
  const pdf = await getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;

  const pages          = [];
  const linksMap       = new Map();
  const emailsMap      = new Map();
  const allRedactions  = [];

  const skipPdfSpecific = options.skipPdfMetadata === true;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    let text      = content.items.map((item) => item.str).join(" ");

    if (options.puslapiai?.length > 0 && options.puslapiai[i - 1]) {
      text = await nustatytiKokybiskesniTeksta(text, options.puslapiai[i - 1]);
    }

    pages.push(text.replace(/\s+/g, " ").trim());

    if (!skipPdfSpecific) {
      // Collect links and mailto: emails from annotation objects
      const annots = (await page.getAnnotations()).filter(
        (annot) => annot.annotationType !== AnnotationType.FILEATTACHMENT,
      );
      for (const annot of annots) {
        if (annot.subtype !== "Link" || !annot.url) continue;
        const uri = annot.url.trim();
        const pageSet = linksMap.get(uri) ?? new Set();
        pageSet.add(i);
        linksMap.set(uri, pageSet);

        if (uri.toLowerCase().startsWith("mailto:")) {
          const email = uri.slice(7);
          const emailSet = emailsMap.get(email) ?? new Set();
          emailSet.add(i);
          emailsMap.set(email, emailSet);
        }
      }

      const pageFindings = await findSloppyRedactions(page, i, 2, content.items);
      allRedactions.push(...pageFindings);
    }
  }
  log(`3. PDFJS took ${((new Date() - start) / 1000).toFixed(3)}s`);

  // Build metadata from PDF info dict
  let metadata;
  if (!options.skipPdfMetadata) {
    const KEY_MAP = {
      PDFFormatVersion:    "pdfVersion",
      Language:            "language",
      EncryptFilterName:   "encryptFilter",
      IsLinearized:        "isLinearized",
      IsAcroFormPresent:   "isAcroFormPresent",
      IsXFAPresent:        "isXfaPresent",
      IsCollectionPresent: "isCollectionPresent",
      IsSignaturesPresent: "isSignaturesPresent",
      Title:               "title",
      Author:              "author",
      Subject:             "subject",
      Keywords:            "keywords",
      Creator:             "creator",
      CreationDate:        "createdAt",
      ModDate:             "modifiedAt",
      Producer:            "producer",
      Trapped:             "trapped",
    };
    const meta = await pdf.getMetadata();
    metadata = {};
    for (const [raw, value] of Object.entries(meta.info)) {
      const key = KEY_MAP[raw] ?? raw[0].toLowerCase() + raw.slice(1);
      const isDate = key === "createdAt" || key === "modifiedAt";
      metadata[key] = isDate ? (parsePdfDate(value) ?? value) : value;
    }
  } else {
    metadata = {};
  }

  // Merge text-parser results
  const parsedFields = gautiViskaIsTeksto(pages);
  Object.assign(metadata, parsedFields);

  // Convert annotation link maps to arrays, then merge with text-parser links/emails
  const annotLinks = Array.from(linksMap.entries()).map(([uri, pages]) => ({
    uri,
    pages: Array.from(pages).sort((a, b) => a - b),
  }));
  const annotEmails = Array.from(emailsMap.entries()).map(([email, pages]) => ({
    email,
    pages: Array.from(pages).sort((a, b) => a - b),
  }));

  metadata.links  = mergePagedItems("uri",   metadata.links,  annotLinks);
  metadata.emails = mergePagedItems("email", annotEmails,     metadata.emails);

  if (!options.skipPdfMetadata) {
    if (allRedactions.length > 0) metadata.sloppyRedactions = allRedactions;

    if (signatureInfo) {
      const sigs = parsePdfSigOutput(signatureInfo);
      if (sigs.length > 0) metadata.signatures = sigs;
    }
  }

  return { pages, metadata: cleanMetadata(metadata) };
}

export const fileTypes = [
  { ext: "pdf",  mime: "application/pdf" },
  { ext: "prn",  mime: "application/pdf", normalizedAs: "pdf" },
];

export { extractPdfContent as extract };
