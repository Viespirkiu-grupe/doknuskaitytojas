import yauzl from "yauzl";
import { XMLParser } from "fast-xml-parser";
import path from "path";
import crypto, { X509Certificate } from "crypto";
import { fetchSafe } from "../utils/fetchSafe.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,       // keep all element text as strings (prevents e.g. codes parsing as integers)
  allowBooleanAttributes: true,
  processEntities: false,     // prevent billion-laughs entity expansion attacks
});

const REL = "http://www.archyvai.lt/adoc/2008/relationships";

// ── ZIP helpers ────────────────────────────────────────────────────────────

/** Read every entry in the ZIP into memory. Returns Map<path, Buffer|null> (null = directory). */
function readAllEntries(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: false },
      (err, zipfile) => {
        if (err) return reject(err);

        /** @type {Map<string, {buf: Buffer|null, entry: object}>} */
        const entries = new Map();

        zipfile.readEntry();

        zipfile.on("entry", (entry) => {
          const name = entry.fileName.toString("utf8");
          const isDir = /\/$/.test(name);

          if (isDir) {
            entries.set(name, { buf: null, entry });
            zipfile.readEntry();
            return;
          }

          zipfile.openReadStream(entry, (err, rs) => {
            if (err) return reject(err);
            const chunks = [];
            rs.on("data", (c) => chunks.push(c));
            rs.on("end", () => {
              entries.set(name, { buf: Buffer.concat(chunks), entry });
              zipfile.readEntry();
            });
            rs.on("error", reject);
          });
        });

        zipfile.on("end", () => resolve(entries));
        zipfile.on("error", reject);
      },
    );
  });
}

// ── relations.xml ──────────────────────────────────────────────────────────

/**
 * Parse META-INF/relations.xml.
 * Returns a Map<filePath, roleSuffix> e.g. "content/main", "metadata/signable", "signatures".
 * Only relationships from the package root ("/") SourcePart are used for role assignment.
 */
function parseRelations(buf) {
  const roles = new Map(); // path → role suffix
  const parsed = xmlParser.parse(buf);
  const sourceParts = toArray(parsed?.Relationships?.SourcePart);

  for (const sp of sourceParts) {
    const sourcePath = sp["full-path"];
    const rels = toArray(sp?.Relationship);

    for (const rel of rels) {
      const type = rel?.type ?? "";
      const target = rel?.["full-path"];
      if (!type || !target) continue;

      const suffix = type.startsWith(REL + "/") ? type.slice(REL.length + 1) : null;
      if (!suffix) continue;

      if (sourcePath === "/") {
        // Package root declares: main doc, metadata files, signatures
        roles.set(target, suffix);
      } else if (suffix === "content/appendix" || suffix === "content/attachment") {
        // Annexes and attachments are declared on the main doc (or other annexes), not on "/"
        roles.set(target, suffix);
      }
    }
  }

  return roles;
}

// ── manifest.xml ───────────────────────────────────────────────────────────

/** Parse META-INF/manifest.xml. Returns Map<path, mimeType>. */
function parseManifest(buf) {
  const mimes = new Map();
  const parsed = xmlParser.parse(buf);
  const entries = toArray(parsed?.manifest?.["file-entry"]);
  for (const e of entries) {
    const p = e?.["full-path"];
    const m = e?.["media-type"] ?? null;
    if (p) mimes.set(p, m);
  }
  return mimes;
}

// ── Signable metadata ──────────────────────────────────────────────────────

/**
 * Extract human-readable fields from a signable metadata XML buffer.
 * Returns partial metadata to be merged into the document result.
 */
function parseSignableMetadata(buf) {
  const parsed = xmlParser.parse(buf);
  const meta = parsed?.metadata ?? {};

  const doc = meta.document ?? null;
  const authorsEl = meta.authors ?? null;
  const registrationsEl = meta.registrations ?? null;
  const receptionsEl = meta.receptions ?? null;
  const sigsEl = meta.signatures ?? null;

  return {
    title: doc?.title ?? null,
    documentType: doc?.sort ?? null,
    authors: toArray(authorsEl?.author).map((a) => ({
      name: a.name ?? null,
      code: a.code ?? null,
      address: a.address ?? null,
      individual: a.individual === "true" || a.individual === true ? true
        : a.individual === "false" || a.individual === false ? false : null,
    })),
    registrations: toArray(registrationsEl?.registration).map((r) => ({
      date: r.date ?? null,
      number: r.number ?? null,
    })),
    receptions: toArray(receptionsEl?.reception).map((r) => ({
      date: r.date ?? null,
      number: r.number ?? null,
      receiver: r.receiver ? {
        name: r.receiver.name ?? null,
        code: r.receiver.code ?? null,
        address: r.receiver.address ?? null,
        individual: r.receiver.individual === "true" || r.receiver.individual === true ? true
          : r.receiver.individual === "false" || r.receiver.individual === false ? false : null,
      } : null,
    })),
    // signature metadata entries — keyed by signatureID for later merging
    signatureMeta: toArray(sigsEl?.signature).map((s) => {
      // signatureID is an IRI like "META-INF/signatures/sig.xml#SignatureElem_0"
      // strip the fragment to get the bare file path used as the lookup key
      const rawId = s.signatureID ?? null;
      const signatureFilePath = rawId ? rawId.split("#")[0] : null;
      return {
        signatureFilePath,
        signingTime: s.signingTime ?? null,
        signingPurpose: s.signingPurpose ?? null,
        signer: s.signer ? {
          name:     s.signer.individualName || null,
          position: s.signer.positionName   || null,
          unit:     s.signer.structuralSubdivision || null,
        } : null,
      };
    }),
  };
}

// ── Unsignable metadata ────────────────────────────────────────────────────

function parseUnsignableMetadata(buf) {
  const parsed = xmlParser.parse(buf);
  const meta = parsed?.metadata ?? {};
  const tech = meta?.Use?.technical_environment ?? {};
  return {
    standardVersion: tech.standardVersion ?? null,
    documentCategory: tech.documentCategory ?? null,
    generator: tech.generator ?? null,
  };
}

// ── XAdES signature file ───────────────────────────────────────────────────

/**
 * Parse a signature XML file.
 * Returns the fields we can determine from the XAdES structure alone;
 * signer name and purpose come from signable metadata and are merged later.
 */
function parseSignatureXml(buf, filePath) {
  const parsed = xmlParser.parse(buf);
  // ADOC signature files wrap the XAdES Signature in an ODF <document-signatures> root element
  const sig = parsed?.["document-signatures"]?.Signature ?? parsed?.Signature;
  if (!sig) return null;

  // sig.Object may be an array when multiple <ds:Object> elements exist
  const qualifyingProps = toArray(sig.Object)
    .find((o) => o?.QualifyingProperties)?.QualifyingProperties ?? {};
  const signedProps =
    qualifyingProps.SignedProperties?.SignedSignatureProperties ?? {};
  const unsignedProps =
    qualifyingProps.UnsignedProperties?.UnsignedSignatureProperties ?? {};

  // Determine XAdES level from which elements are present
  const level = xadesLevel(unsignedProps);

  // Extract signer certificate fields
  let certFields = { signerCN: null, signerEmail: null, signerCountry: null, hasPersonalId: false };
  try {
    const x509 = sig.KeyInfo?.X509Data?.X509Certificate;
    const certB64 = typeof x509 === "string" ? x509.replace(/[\r\n\s]/g, "") : null;
    if (certB64) {
      const cert = new X509Certificate(Buffer.from(certB64, "base64"));
      certFields = parseCertFields(cert);
    }
  } catch {
    // malformed or absent cert — leave defaults
  }

  const sigAlgorithmUri = sig.SignedInfo?.SignatureMethod?.Algorithm ?? null;

  // Content references: exclude the internal #fragment reference to SignedProperties
  const refs = toArray(sig.SignedInfo?.Reference);
  const contentRefsCount = refs.filter(
    (r) => !String(r?.URI ?? "").startsWith("#"),
  ).length;

  return {
    filePath,
    level,
    signingTime: signedProps.SigningTime ?? null,
    hashAlgorithm: hashAlgorithmFromUri(sigAlgorithmUri),
    contentRefsCount,
    ...certFields,
  };
}

/** Infer XAdES level from which UnsignedSignatureProperties children exist. */
function xadesLevel(usp) {
  if (!usp || typeof usp !== "object") return "XAdES-EPES";
  const keys = Object.keys(usp);
  if (keys.includes("ArchiveTimeStamp")) return "XAdES-A";
  if (keys.includes("CertificateValues") || keys.includes("RevocationValues")) return "XAdES-X-L";
  if (keys.includes("SigAndRefsTimeStamp")) return "XAdES-X";
  if (keys.includes("CompleteCertificateRefs")) return "XAdES-C";
  if (keys.includes("SignatureTimeStamp")) return "XAdES-T";
  return "XAdES-EPES";
}

// ── Certificate helpers ────────────────────────────────────────────────────

/**
 * Parse the common identity fields out of an X509Certificate.
 * Node.js returns cert.subject as a newline-separated "Key=Value" string.
 */
function parseCertFields(cert) {
  const subject = cert.subject ?? "";
  const fields = {};
  // Node.js X509Certificate.subject uses \n as RDN separator.
  // Values may contain RFC 4514 backslash-escaped characters (e.g. \, for a literal comma).
  for (const line of subject.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toUpperCase();
    const val = line.slice(eq + 1).trim().replace(/\\(.)/g, "$1"); // unescape \X → X
    if (!(key in fields)) fields[key] = val; // first occurrence wins
  }

  const serialNumber = fields["SERIALNUMBER"] ?? "";
  let signerEmail = fields["E"] ?? fields["EMAILADDRESS"] ?? null;
  if (!signerEmail && cert.subjectAltName) {
    const m = cert.subjectAltName.match(/email:([^\s,]+)/i);
    if (m) signerEmail = m[1];
  }

  return {
    signerCN:      fields["CN"] ?? null,
    signerEmail:   signerEmail,
    signerCountry: fields["C"] ?? null,
    hasPersonalId: /^(?:PNOLT-|\d{11}$)/.test(serialNumber),
  };
}

/** Map a ds:SignatureMethod URI to a friendly hash algorithm name. */
function hashAlgorithmFromUri(uri) {
  if (!uri) return null;
  const fragment = uri.split("#").pop();
  const map = {
    "rsa-sha256":    "SHA-256",
    "ecdsa-sha256":  "SHA-256",
    "rsa-sha384":    "SHA-384",
    "ecdsa-sha384":  "SHA-384",
    "rsa-sha512":    "SHA-512",
    "ecdsa-sha512":  "SHA-512",
    "sha256":        "SHA-256",
    "sha384":        "SHA-384",
    "sha512":        "SHA-512",
  };
  return map[fragment] ?? null;
}

// ── File listing ───────────────────────────────────────────────────────────

function buildFileList(entries) {
  const files = [];
  for (const [name, { buf, entry }] of entries) {
    if (name === "mimetype") continue;
    const isDirectory = /\/$/.test(name);
    const extension = isDirectory ? null : path.extname(name).slice(1).toLowerCase() || null;
    const md5 = buf ? crypto.createHash("md5").update(buf).digest("hex") : null;

    files.push({
      name: path.basename(name.replace(/\/$/, "")),
      path: name,
      size: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      extension,
      lastModDate: entry.getLastModDate(),
      isDirectory,
      compressionMethod: entry.compressionMethod,
      md5,
    });
  }
  return files;
}

function buildTree(files) {
  const root = [];
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let level = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let node = level.find((n) => n.name === part);
      if (!node) {
        node = isLast ? { ...file } : { name: part, isDirectory: true, children: [] };
        level.push(node);
      }
      level = node.children ?? [];
    });
  }
  return root;
}

// ── Main extractor ─────────────────────────────────────────────────────────

export async function extractAdocContent(url) {
  const buffer = Buffer.from(await fetchSafe(url));

  const entries = await readAllEntries(buffer);

  // ── Roles from relations.xml ──
  const rolesByPath = entries.has("META-INF/relations.xml")
    ? parseRelations(entries.get("META-INF/relations.xml").buf)
    : new Map();

  // ── MIME types from manifest.xml ──
  const mimeByPath = entries.has("META-INF/manifest.xml")
    ? parseManifest(entries.get("META-INF/manifest.xml").buf)
    : new Map();

  // ── Identify files by role ──
  let mainDocument = null;
  const annexes = [];
  const attachments = [];
  const signableMetaPaths = [];
  const unsignableMetaPaths = [];
  const signaturePaths = [];

  for (const [p, role] of rolesByPath) {
    switch (role) {
      case "content/main":
        mainDocument = { path: p, mediaType: mimeByPath.get(p) ?? null };
        break;
      case "content/appendix":
        annexes.push({ path: p, mediaType: mimeByPath.get(p) ?? null });
        break;
      case "content/attachment":
        attachments.push({ path: p, mediaType: mimeByPath.get(p) ?? null });
        break;
      case "metadata/signable":
        signableMetaPaths.push(p);
        break;
      case "metadata/unsignable":
        unsignableMetaPaths.push(p);
        break;
      case "signatures":
        signaturePaths.push(p);
        break;
    }
  }

  // Fallback: detect signature files by convention (META-INF, filename contains "signatures")
  if (signaturePaths.length === 0) {
    for (const p of entries.keys()) {
      if (
        p.startsWith("META-INF/") &&
        p.endsWith(".xml") &&
        p.toLowerCase().includes("signatures")
      ) {
        signaturePaths.push(p);
      }
    }
  }

  // ── Parse signable metadata files ──
  const signableMeta = {
    title: null,
    documentType: null,
    authors: [],
    registrations: [],
    receptions: [],
    signatureMeta: [],
  };

  for (const p of signableMetaPaths) {
    const e = entries.get(p);
    if (!e?.buf) continue;
    const parsed = parseSignableMetadata(e.buf);
    if (parsed.title && !signableMeta.title) signableMeta.title = parsed.title;
    if (parsed.documentType && !signableMeta.documentType) signableMeta.documentType = parsed.documentType;
    signableMeta.authors.push(...parsed.authors);
    signableMeta.registrations.push(...parsed.registrations);
    signableMeta.receptions.push(...parsed.receptions);
    signableMeta.signatureMeta.push(...parsed.signatureMeta);
  }

  // ── Parse unsignable metadata files ──
  const unsignableMeta = { standardVersion: null, documentCategory: null, generator: null };
  for (const p of unsignableMetaPaths) {
    const e = entries.get(p);
    if (!e?.buf) continue;
    const parsed = parseUnsignableMetadata(e.buf);
    if (parsed.standardVersion) unsignableMeta.standardVersion = parsed.standardVersion;
    if (parsed.documentCategory) unsignableMeta.documentCategory = parsed.documentCategory;
    if (parsed.generator) unsignableMeta.generator = parsed.generator;
  }

  // ── Parse XAdES signature files ──
  /** @type {Map<string, object>} filePath → XAdES data */
  const xadesMap = new Map();
  for (const p of signaturePaths) {
    const e = entries.get(p);
    if (!e?.buf) continue;
    const sigData = parseSignatureXml(e.buf, p);
    if (sigData) xadesMap.set(p, sigData);
  }

  // ── Merge signature metadata + XAdES data ──
  const sigMetaMap = new Map(); // file path → sig meta
  for (const sm of signableMeta.signatureMeta) {
    if (!sm.signatureFilePath) continue;
    sigMetaMap.set(sm.signatureFilePath, sm);
  }

  const signatures = [];

  for (const [filePath, xades] of xadesMap) {
    const meta = sigMetaMap.get(filePath) ?? {};
    signatures.push({
      filePath,
      level: xades.level,
      signingTime: xades.signingTime ?? meta.signingTime ?? null,
      signingPurpose: meta.signingPurpose ?? null,
      signer: meta.signer ?? null,
      signerCN:      xades.signerCN,
      signerEmail:   xades.signerEmail,
      signerCountry: xades.signerCountry,
      hasPersonalId: xades.hasPersonalId,
      hashAlgorithm: xades.hashAlgorithm,
      isValid:       null,
      contentRefsCount: xades.contentRefsCount,
    });
    sigMetaMap.delete(filePath);
  }

  // Metadata entries with no matching XAdES file (e.g. file referenced but absent from ZIP)
  for (const [, meta] of sigMetaMap) {
    signatures.push({
      filePath:      meta.signatureFilePath,
      level:         null,
      signingTime:   meta.signingTime ?? null,
      signingPurpose: meta.signingPurpose ?? null,
      signer:        meta.signer ?? null,
      signerCN:      null,
      signerEmail:   null,
      signerCountry: null,
      hasPersonalId: false,
      hashAlgorithm: null,
      isValid:       null,
      contentRefsCount: 0,
    });
  }

  // ── File listing ──
  const allFiles = buildFileList(entries);
  const flatFiles = allFiles.filter((f) => !f.isDirectory);
  const filesTree = buildTree(allFiles);

  return {
    pages: [],
    metadata: {
      containerType: "ADOC",
      standardVersion: unsignableMeta.standardVersion ?? "ADOC-V1.0",
      documentCategory: unsignableMeta.documentCategory ?? null,
      title: signableMeta.title,
      documentType: signableMeta.documentType,
      authors: signableMeta.authors,
      registrations: signableMeta.registrations,
      receptions: signableMeta.receptions,
      mainDocument,
      annexes,
      attachments,
      signatures,
      files: flatFiles,
      filesTree,
    },
  };
}

// ── Utility ────────────────────────────────────────────────────────────────

function toArray(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

export const fileTypes = [
  { ext: "adoc", mime: "application/vnd.lt.archyvai.adoc-2008" },
];

export { extractAdocContent as extract };
