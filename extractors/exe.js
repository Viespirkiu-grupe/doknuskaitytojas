import fs from "fs";
import { randomUUID } from "crypto";
import path from "path";
import { log } from "../utils/log.js";
import { gautiViskaIsTeksto } from "../parsers/viskas.js";

const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MACHINE_TYPES = {
  0x014c: "x86",
  0x8664: "x64",
  0xAA64: "ARM64",
  0x01C4: "ARM (Thumb-2)",
  0x01C0: "ARM",
  0x0200: "IA64",
  0x0EBC: "EFI Byte Code",
};

const SUBSYSTEMS = {
  1:  "Native",
  2:  "Windows GUI",
  3:  "Windows Console",
  5:  "OS/2 Console",
  7:  "POSIX Console",
  9:  "Windows CE GUI",
  10: "EFI Application",
  11: "EFI Boot Service Driver",
  12: "EFI Runtime Driver",
  13: "EFI ROM",
  14: "Xbox",
  16: "Windows Boot Application",
};

// ---------------------------------------------------------------------------
// PE header parsing
// ---------------------------------------------------------------------------

/**
 * Convert an RVA to a file offset using the section table.
 *
 * @param {number} rva
 * @param {{ vaddr: number, rawOff: number, rawSize: number }[]} sections
 * @returns {number | null}
 */
function rvaToOffset(rva, sections) {
  for (const s of sections) {
    if (rva >= s.vaddr && rva < s.vaddr + s.rawSize)
      return s.rawOff + (rva - s.vaddr);
  }
  return null;
}

/**
 * Parse the section table from a PE buffer.
 *
 * @param {Buffer} buf
 * @param {number} sectionTableOff  - File offset of the first section header
 * @param {number} count
 * @returns {{ name: string, vaddr: number, rawOff: number, rawSize: number }[]}
 */
function parseSections(buf, sectionTableOff, count) {
  const sections = [];
  for (let i = 0; i < count; i++) {
    const off = sectionTableOff + i * 40;
    sections.push({
      name:    buf.toString("ascii", off, off + 8).replace(/\0+$/, ""),
      vaddr:   buf.readUInt32LE(off + 12),
      rawSize: buf.readUInt32LE(off + 16),
      rawOff:  buf.readUInt32LE(off + 20),
    });
  }
  return sections;
}

/**
 * Parse the import directory and return the list of DLL names.
 *
 * @param {Buffer} buf
 * @param {number} importRVA
 * @param {object[]} sections
 * @returns {string[]}
 */
function parseImports(buf, importRVA, sections) {
  if (!importRVA) return [];
  let off = rvaToOffset(importRVA, sections);
  if (off === null) return [];

  const dlls = [];
  while (off + 20 <= buf.length) {
    const nameRVA     = buf.readUInt32LE(off + 12);
    const firstThunk  = buf.readUInt32LE(off + 16);
    if (nameRVA === 0 && firstThunk === 0) break;
    const nameOff = rvaToOffset(nameRVA, sections);
    if (nameOff !== null) {
      const end = buf.indexOf(0, nameOff);
      dlls.push(buf.toString("ascii", nameOff, end < 0 ? nameOff + 64 : end));
    }
    off += 20;
  }
  return dlls;
}

/**
 * Read a null-terminated UTF-16LE string from a buffer slice.
 *
 * @param {Buffer} slice
 * @param {number} off  - Byte offset within slice
 * @returns {{ str: string, len: number }}  len = bytes consumed including null terminator
 */
function readUtf16(slice, off) {
  let i = off;
  while (i + 1 < slice.length && (slice[i] !== 0 || slice[i + 1] !== 0)) i += 2;
  return { str: slice.slice(off, i).toString("utf16le"), len: i - off + 2 };
}

/** Align a byte offset to the next 4-byte boundary. */
function align4(n) { return (n + 3) & ~3; }

/**
 * Parse a VS_VERSION_INFO resource block and return version strings.
 *
 * @param {Buffer} slice  - Buffer starting at the version data
 * @returns {{ fileVersion: string|null, productVersion: string|null, strings: object }}
 */
function parseVersionInfo(slice) {
  let fileVersion   = null;
  let productVersion = null;
  const strings = {};

  try {
    const totalLen  = slice.readUInt16LE(0);
    const valueLen  = slice.readUInt16LE(2);
    let off = 6;

    const { str: rootKey, len: rootKeyLen } = readUtf16(slice, off);
    if (rootKey !== "VS_VERSION_INFO") return { fileVersion, productVersion, strings };
    off = align4(off + rootKeyLen);

    // VS_FIXEDFILEINFO
    if (valueLen >= 52 && slice.readUInt32LE(off) === 0xFEEF04BD) {
      const fvMS = slice.readUInt32LE(off + 8);
      const fvLS = slice.readUInt32LE(off + 12);
      const pvMS = slice.readUInt32LE(off + 16);
      const pvLS = slice.readUInt32LE(off + 20);
      fileVersion    = `${fvMS >>> 16}.${fvMS & 0xFFFF}.${fvLS >>> 16}.${fvLS & 0xFFFF}`;
      productVersion = `${pvMS >>> 16}.${pvMS & 0xFFFF}.${pvLS >>> 16}.${pvLS & 0xFFFF}`;
    }
    off = align4(off + valueLen);

    // StringFileInfo children
    while (off + 6 < totalLen) {
      const childLen = slice.readUInt16LE(off);
      if (childLen === 0) break;
      let cOff = off + 6;
      const { str: childKey, len: ckLen } = readUtf16(slice, cOff);
      cOff = align4(cOff + ckLen);

      if (childKey === "StringFileInfo") {
        // StringTable
        while (cOff < off + childLen) {
          const stLen = slice.readUInt16LE(cOff);
          if (stLen === 0) break;
          let stOff = cOff + 6;
          const { str: langKey, len: lkLen } = readUtf16(slice, stOff);
          stOff = align4(stOff + lkLen);

          // String entries
          while (stOff < cOff + stLen) {
            const sLen = slice.readUInt16LE(stOff);
            if (sLen === 0) break;
            const sValueLen = slice.readUInt16LE(stOff + 2);
            let sOff = stOff + 6;
            const { str: sKey, len: skLen } = readUtf16(slice, sOff);
            sOff = align4(sOff + skLen);
            if (sValueLen > 0 && sKey) {
              const raw = slice.slice(sOff, sOff + sValueLen * 2).toString("utf16le");
              strings[sKey] = raw.replace(/\0+$/, "").trim();
            }
            stOff = align4(stOff + sLen);
          }
          cOff = align4(cOff + stLen);
        }
      }
      off = align4(off + childLen);
    }
  } catch {
    // malformed version resource — return what we have
  }

  return { fileVersion, productVersion, strings };
}

/**
 * Parse a PE (Portable Executable) buffer and return structured metadata.
 *
 * @param {Buffer} buf
 * @returns {object}
 */
function parsePe(buf) {
  // Validate MZ signature
  if (buf.length < 0x40 || buf[0] !== 0x4D || buf[1] !== 0x5A)
    throw new Error("Not a valid PE file (missing MZ signature)");

  const peOff = buf.readUInt32LE(0x3C);
  if (peOff + 24 > buf.length || buf.toString("ascii", peOff, peOff + 4) !== "PE\0\0")
    throw new Error("Not a valid PE file (missing PE signature)");

  // COFF header (20 bytes, immediately after PE signature)
  const coffOff     = peOff + 4;
  const machine     = buf.readUInt16LE(coffOff);
  const numSections = buf.readUInt16LE(coffOff + 2);
  const timestamp   = buf.readUInt32LE(coffOff + 4);
  const optSize     = buf.readUInt16LE(coffOff + 16);
  const chars       = buf.readUInt16LE(coffOff + 18);

  // Optional header
  const optOff   = coffOff + 20;
  const optMagic = buf.readUInt16LE(optOff);
  const is64     = optMagic === 0x020B;
  const is32     = optMagic === 0x010B;

  let subsystem       = null;
  let dllChars        = 0;
  let importRVA       = 0;
  let resourceRVA     = 0;
  let securityOffset  = 0;
  let securitySize    = 0;

  if (is32 || is64) {
    subsystem      = buf.readUInt16LE(optOff + 68);
    dllChars       = buf.readUInt16LE(optOff + 70);
    // Data directories start at +96 (PE32) or +112 is wrong — both start at +96 for PE32, +112 for PE32+?
    // Actually: PE32 data dirs at optOff+96, PE32+ at optOff+112
    const ddBase   = is64 ? optOff + 112 : optOff + 96;
    // [0]=Export, [1]=Import, [2]=Resource, [4]=Security
    importRVA      = buf.readUInt32LE(ddBase + 8);   // DataDirectory[1].VirtualAddress
    resourceRVA    = buf.readUInt32LE(ddBase + 16);  // DataDirectory[2].VirtualAddress
    securityOffset = buf.readUInt32LE(ddBase + 32);  // DataDirectory[4] — file offset, not RVA
    securitySize   = buf.readUInt32LE(ddBase + 36);
  }

  // Section table
  const sectionTableOff = optOff + optSize;
  const sections = parseSections(buf, sectionTableOff, numSections);

  // Determine file type
  const isDll    = !!(chars & 0x2000);
  const isDriver = !!(chars & 0x1000);
  const type     = isDll ? "dll" : isDriver ? "sys" : "exe";

  // Imports
  const imports = parseImports(buf, importRVA, sections);

  // Version info from .rsrc
  let versionInfo = null;
  if (resourceRVA) {
    const rsrcOff = rvaToOffset(resourceRVA, sections);
    if (rsrcOff !== null) {
      try {
        versionInfo = extractVersionInfo(buf, rsrcOff, resourceRVA, sections);
      } catch {
        // non-fatal
      }
    }
  }

  // Security features
  const security = {
    aslr:                !!(dllChars & 0x0040),
    highEntropyAslr:     !!(dllChars & 0x0020),
    dep:                 !!(dllChars & 0x0100),
    noSeh:               !!(dllChars & 0x0400),
    cfg:                 !!(dllChars & 0x4000),
    terminalServerAware: !!(dllChars & 0x8000),
  };

  return {
    arch:        MACHINE_TYPES[machine] ?? `unknown (0x${machine.toString(16)})`,
    type,
    compiledAt:  timestamp ? new Date(timestamp * 1000).toISOString() : null,
    subsystem:   SUBSYSTEMS[subsystem] ?? null,
    sections:    sections.map((s) => s.name),
    imports,
    signed:      securitySize > 0,
    security,
    version:     versionInfo,
  };
}

/**
 * Walk the resource directory tree and extract the VS_VERSION_INFO data.
 *
 * @param {Buffer}   buf
 * @param {number}   rsrcOff      - File offset of the resource section start
 * @param {number}   rsrcRVA      - RVA of the resource section (for self-relative pointer fixup)
 * @param {object[]} sections
 * @returns {object | null}
 */
function extractVersionInfo(buf, rsrcOff, rsrcRVA, sections) {
  function readDir(off) {
    const named = buf.readUInt16LE(off + 12);
    const id    = buf.readUInt16LE(off + 14);
    const total = named + id;
    const entries = [];
    for (let i = 0; i < total; i++) {
      const eOff      = off + 16 + i * 8;
      const nameOrId  = buf.readUInt32LE(eOff);
      const dataOrDir = buf.readUInt32LE(eOff + 4);
      entries.push({
        id:    (nameOrId  & 0x80000000) ? null : nameOrId,
        isDir: (dataOrDir & 0x80000000) !== 0,
        offset: dataOrDir & 0x7FFFFFFF,
      });
    }
    return entries;
  }

  // Level 1: resource types. RT_VERSION = 16
  const l1 = readDir(rsrcOff);
  const vt = l1.find((e) => e.id === 16);
  if (!vt || !vt.isDir) return null;

  // Level 2: first named/id entry
  const l2 = readDir(rsrcOff + vt.offset);
  if (!l2.length || !l2[0].isDir) return null;

  // Level 3: first language
  const l3 = readDir(rsrcOff + l2[0].offset);
  if (!l3.length || l3[0].isDir) return null;

  // Data entry: RVA + size + codepage
  const dataEntryOff = rsrcOff + l3[0].offset;
  const dataRVA      = buf.readUInt32LE(dataEntryOff);
  const dataSize     = buf.readUInt32LE(dataEntryOff + 4);
  const dataOff      = rvaToOffset(dataRVA, sections);
  if (dataOff === null) return null;

  const { fileVersion, productVersion, strings } = parseVersionInfo(
    buf.slice(dataOff, dataOff + dataSize)
  );

  return {
    fileVersion:         fileVersion,
    productVersion:      productVersion,
    companyName:         strings.CompanyName         ?? null,
    productName:         strings.ProductName         ?? null,
    fileDescription:     strings.FileDescription     ?? null,
    fileVersionString:   strings.FileVersion         ?? null,
    productVersionString: strings.ProductVersion     ?? null,
    legalCopyright:      strings.LegalCopyright      ?? null,
    originalFilename:    strings.OriginalFilename     ?? null,
    internalName:        strings.InternalName         ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public extractor
// ---------------------------------------------------------------------------

/**
 * Extract PE metadata from a Windows executable or DLL at the given URL.
 *
 * @param {string} url
 * @returns {Promise<{ pages: string[], metadata: object }>}
 */
export async function extractExeContent(url) {
  const tmpFile = path.join(TMP_DIR, `${randomUUID()}.exe`);
  try {
    log(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpFile, buf);

    const peData = parsePe(buf);

    // Build a small text corpus for the pattern parsers
    const corpus = [
      peData.version?.companyName,
      peData.version?.productName,
      peData.version?.fileDescription,
      peData.version?.legalCopyright,
      peData.version?.originalFilename,
    ]
      .filter(Boolean)
      .join("\n");

    const parsedFields = gautiViskaIsTeksto([corpus]);

    return {
      pages: [],
      metadata: { ...peData, ...parsedFields },
    };
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

export const fileTypes = [
  { ext: "exe", mime: "application/x-msdownload" },
  { ext: "dll", mime: "application/x-msdownload", normalizedAs: "exe" },
  { ext: "sys", mime: "application/x-msdownload", normalizedAs: "exe" },
];

export { extractExeContent as extract };
