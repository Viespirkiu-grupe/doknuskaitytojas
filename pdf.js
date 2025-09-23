import fs from "fs";
import { execFile } from "child_process";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Buffer } from "buffer";
import { randomUUID } from "crypto";
import path from "path";
import { log } from "./utils/log.js";

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

export async function extractPdfContent(input, options = {}) {
  let start = new Date();
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
  start = new Date();

  let signatureInfo = null;
  const tmpFile = path.join(TMP_DIR, `${randomUUID()}.pdf`);
  try {
    fs.writeFileSync(tmpFile, buffer);

    signatureInfo = await runPdfSig(tmpFile);
  } catch (e) {
    fs.unlinkSync(tmpFile);
  }

  log(`2. Signpdf took ${((new Date() - start) / 1000).toFixed(3)}s`);
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
  const jarKodaiMap = new Map(); // key: code, value: Set of page numbers
  const ibanMap = new Map(); // key: iban, value: Set of page numbers
  const telefonaiMap = new Map(); // key: phone, value: Set of page numbers
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

    // Extract 9-digit codes
    const foundCodes = normalizedText.match(/\b\d{9}\b/g) || [];
    // foundCodes.forEach((code) => jarKodaiSet.add(code));
    for (const code of foundCodes) {
      const codeSet = jarKodaiMap.get(code) || new Set();
      codeSet.add(i);
      jarKodaiMap.set(code, codeSet);
    }

    // Extract IBANs (basic regex)
    const foundIbans =
      normalizedText.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g) || [];
    // foundIbans.forEach((iban) => ibanSet.add(iban));
    for (const iban of foundIbans) {
      const ibanSet = ibanMap.get(iban) || new Set();
      ibanSet.add(i);
      ibanMap.set(iban, ibanSet);
    }

    // Emails in text
    const foundEmails =
      normalizedText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) || [];
    for (const email of foundEmails) {
      const emailSet = emailsMap.get(email) || new Set();
      emailSet.add(i);
      emailsMap.set(email, emailSet);
    }

    // Phone numbers
    let lithuanianNumberRegex =
      /((?:^|[^0-9])((?:[\(]*)(?:(?:\+370|370|8|0)[\s\-.\(\)]*)?(?:6(?:[\s\-.\(\)]*\d){7}|[2-7](?:[\s\-.\(\)]*\d){7}|[2-7]\d(?:[\s\-.\(\)]*\d){6}))(?!\d))/gm;
    const foundPhones = normalizedText.match(lithuanianNumberRegex) || [];

    // Loop over phones, clean them up and add to set
    // Convert all forms to +370XXXXXXX
    for (let phone of foundPhones) {
      let cleaned = phone.replace(/[\s\-\.\(\)]/g, "");
      cleaned = cleaned.replaceAll(":", "");
      if (cleaned.startsWith("+370")) {
        // do nothing
      } else if (cleaned.startsWith("370")) {
        cleaned = "+" + cleaned;
      } else if (cleaned.startsWith("8")) {
        cleaned = "+370" + cleaned.slice(1);
      } else if (cleaned.startsWith("0")) {
        cleaned = "+370" + cleaned.slice(1);
      } else if (cleaned.match(/^6\d{7}$/)) {
        cleaned = "+370" + cleaned;
      } else if (cleaned.match(/^[2-7]\d{7}$/)) {
        cleaned = "+370" + cleaned;
      } else if (cleaned.match(/^[2-7]\d{6}$/)) {
        cleaned = "+370" + cleaned;
      } else {
        continue; // skip unrecognized formats
      }

      const phoneSet = telefonaiMap.get(cleaned) || new Set();
      phoneSet.add(i);
      telefonaiMap.set(cleaned, phoneSet);
    }

    let internationalNumberRegex =
      /\+(9[976]\d|8[987530]\d|6[987]\d|5[90]\d|42\d|3[875]\d|2[98654321]\d|9[8543210]|8[6421]|6[6543210]|5[87654321]|4[987654310] | 3[9643210] | 2[70] | 7 | 1) \d{ 1, 14 } $/gm;

    const foundInternationalPhones =
      normalizedText.match(internationalNumberRegex) || [];

    for (let phone of foundInternationalPhones) {
      let cleaned = phone.replace(/[\s\-\.\(\)]/g, "");
      const phoneSet = telefonaiMap.get(cleaned) || new Set();
      phoneSet.add(i);
      telefonaiMap.set(cleaned, phoneSet);
    }

    // Sloppy redactions
    try {
      const overlapTolerance = 5;
      const hasSloppyRedactions = await searchForSloppyRedactionsInPage(
        page,
        overlapTolerance,
        content.items,
        annots,
      );

      if (hasSloppyRedactions) {
        sloppyRedactionsInPages.add(i);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Deduplicate
  const links = Array.from(linksMap.entries()).map(([uri, pages]) => ({
    uri,
    pages: Array.from(pages).sort((a, b) => a - b),
  }));
  const emails = Array.from(emailsMap.entries()).map(([email, pages]) => ({
    email,
    pages: Array.from(pages).sort((a, b) => a - b),
  }));

  // Domains from both emails and links
  const domains = new Set();
  for (const email of emails) {
    const domain = email.email.split("@")[1];
    if (domain) domains.add(domain.toLowerCase());
  }
  for (const link of links) {
    try {
      const url = new URL(link.uri);
      if (url.hostname)
        domains.add(url.hostname.toLowerCase().replace("www.", ""));
    } catch (e) {
      // ignore invalid URLs
    }
  }

  // Sort domains
  const sortedDomains = Array.from(domains).sort((a, b) => a.localeCompare(b));

  const jarKodai = Array.from(jarKodaiMap.entries()).map(([code, pages]) => ({
    code,
    pages: Array.from(pages).sort((a, b) => a - b),
  }));
  const ibanNumeriai = Array.from(ibanMap.entries()).map(([iban, pages]) => ({
    iban,
    pages: Array.from(pages).sort((a, b) => a - b),
  }));
  const telefonai = Array.from(telefonaiMap.entries()).map(
    ([phone, pages]) => ({
      phone,
      pages: Array.from(pages).sort((a, b) => a - b),
    }),
  );

  // const jarKodai = Array.from(jarKodaiSet);
  // const ibanNumeriai = Array.from(ibanSet);
  // const telefonai = Array.from(telefonaiSet);

  log(`3. PDFJS took ${((new Date() - start) / 1000).toFixed(3)}s`);
  start = new Date();

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

    metadata.characterCount = pages.reduce((acc, page) => acc + page.length, 0);
    metadata.wordCount = pages.reduce((acc, page) => {
      const words = page.trim().split(/\s+/).filter(Boolean); // remove empty strings
      return acc + words.length;
    }, 0);
  } else {
    var metadata = {};
  }

  metadata.pageCount = pdf.numPages;
  metadata.links = links;
  metadata.emails = emails;
  metadata.domains = sortedDomains;
  metadata.jarKodai = jarKodai;
  metadata.ibanNumeriai = ibanNumeriai;
  metadata.telefonai = telefonai;
  if (signatureInfo) {
    metadata.signatures = parsePdfSigOutput(signatureInfo).signatures;
  }
  metadata.sloppyRedactions = [...sloppyRedactionsInPages.values()];

  log(`4. Metadata took ${((new Date() - start) / 1000).toFixed(3)}s`);
  start = new Date();

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
