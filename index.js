import express from "express";
import fs from "fs";
import { execFile } from "child_process";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { Buffer } from "buffer";
import { randomUUID } from "crypto";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ quiet: true }); // Load .env

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

const versija = 3;

// GET /?url=...&apiKey=...
app.get("/", async (req, res) => {
    const { url, apiKey } = req.query;

    if (!url) {
        return res.status(400).json({ error: "Missing url parameter" });
    }

    if (apiKey !== API_KEY) {
        return res.status(403).json({ error: "Invalid API key" });
    }

    try {
        const result = await extractPdfContent(url);
        res.json({ success: true, result, versija });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

async function extractPdfContent(url) {
    let start = new Date();

    // Fetch PDF into memory
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(
        `1. Fetchpdf took ${((new Date() - start) / 1000).toFixed(3)}s`,
    );
    start = new Date();

    let signatureInfo = null;
    const tmpFile = path.join(TMP_DIR, `${randomUUID()}.pdf`);
    try {
        fs.writeFileSync(tmpFile, buffer);

        signatureInfo = await runPdfSig(tmpFile);
    } catch (e) {
        fs.unlinkSync(tmpFile);
    }

    console.log(`2. Signpdf took ${((new Date() - start) / 1000).toFixed(3)}s`);
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
    const jarKodaiSet = new Set();
    const ibanSet = new Set();
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
        foundCodes.forEach((code) => jarKodaiSet.add(code));

        // Extract IBANs (basic regex)
        const foundIbans =
            normalizedText.match(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g) || [];
        foundIbans.forEach((iban) => ibanSet.add(iban));

        // Emails in text
        const foundEmails =
            normalizedText.match(
                /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
            ) || [];
        for (const email of foundEmails) {
            const emailSet = emailsMap.get(email) || new Set();
            emailSet.add(i);
            emailsMap.set(email, emailSet);
        }

        try {
            const overlapTolerance = 5;
            const hasSloppyRedactions = await searchForSloppyRedactionsInPage(page, overlapTolerance, content.items, annots);

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

    const jarKodai = Array.from(jarKodaiSet);
    const ibanNumeriai = Array.from(ibanSet);

    console.log(`3. PDFJS took ${((new Date() - start) / 1000).toFixed(3)}s`);
    start = new Date();

    // Extract metadata
    const meta = await pdf.getMetadata();
    let metadata = Object.fromEntries(
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

    metadata.pageCount = pdf.numPages;
    metadata.links = links;
    metadata.emails = emails;
    metadata.jarKodai = jarKodai;
    metadata.ibanNumeriai = ibanNumeriai;
    if (signatureInfo) {
        metadata.signatures = parsePdfSigOutput(signatureInfo).signatures;
    }

    console.log(
        `4. Metadata took ${((new Date() - start) / 1000).toFixed(3)}s`,
    );
    start = new Date();

    metadata = cleanMetadata(metadata);

    return { pages, metadata, sloppyRedactions: [...sloppyRedactionsInPages.values()] };
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
                    .map((v) =>
                        v.replace(/\[|\]/g, "").split(" - ").map(Number),
                    );
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

async function searchForSloppyRedactionsInPage(pdfPage, tolerance, textContent, annotations) {
    const pageExtents = pdfPage.view;

    textContent ??= (await pdfPage.getTextContent()).items;

    annotations ??= await pdfPage.getAnnotations();

    const coveredAreas = annotations.reduce((areas, annot) => {
        // ignore TEXT | LINK | FREETEXT annotations
        if ([1, 2, 3].includes(annot.annotationType)) {
            return areas;
        }

        if (annot.rotation) {
            console.error(`Rotated annotations not supported 🙃`);
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

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
