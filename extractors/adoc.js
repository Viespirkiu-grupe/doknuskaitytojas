import yauzl from "yauzl";
import { XMLParser } from "fast-xml-parser";
import path from "path";
import crypto from "crypto";
import { deepMerge } from "../utils/mergeObject.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  parseAttributeValue: false,
  allowBooleanAttributes: true,
});

function readEntryText(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, rs) => {
      if (err) return reject(err);
      const chunks = [];
      rs.on("data", (c) => chunks.push(c));
      rs.on("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

export async function extractAdocContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: false },
      (err, zipfile) => {
        if (err) return reject(err);

        const metadata = {
          containerType: "ADOC",
          documents: [],
          authors: [],
          signatures: [],
          files: [],
          filesTree: [],
        };

        const files = [];

        zipfile.readEntry();

        zipfile.on("entry", async (entry) => {
          try {
            const name = entry.fileName.toString();
            const isDirectory = /\/$/.test(name);
            const extension = isDirectory
              ? null
              : path.extname(name).slice(1).toLowerCase();

            // ---------- MANIFEST ----------
            if (name === "META-INF/manifest.xml") {
              const xmlBuffer = await readEntryText(zipfile, entry);
              const parsed = parser.parse(xmlBuffer);
              const filesList = Array.isArray(parsed.manifest?.["file-entry"])
                ? parsed.manifest["file-entry"]
                : [parsed.manifest?.["file-entry"]].filter(Boolean);

              for (const f of filesList) {
                const fullPath = f["full-path"];
                if (
                  fullPath &&
                  !fullPath.startsWith("META-INF/") &&
                  !fullPath.startsWith("metadata/")
                ) {
                  metadata.documents.push({
                    path: fullPath,
                    mediaType: f["media-type"] ?? null,
                  });
                }
              }
            }
            // ---------- SIGNATURE FILES ----------
            else if (
              name.startsWith("META-INF/signatures/") &&
              name.endsWith(".xml")
            ) {
              const xmlBuffer = await readEntryText(zipfile, entry);
              const parsed = parser.parse(xmlBuffer);
              const sigs = parsed["document-signatures"]?.Signature;
              if (sigs) {
                const sigList = Array.isArray(sigs) ? sigs : [sigs];
                for (const s of sigList) {
                  metadata.signatures.push(parseSignatureNode(s));
                }
              }
            }
            // ---------- SIGNABLE METADATA ----------
            else if (
              name.startsWith("metadata/signableMetadata") &&
              name.endsWith(".xml")
            ) {
              const xmlBuffer = await readEntryText(zipfile, entry);
              const parsed = parser.parse(xmlBuffer);
              const doc = parsed.metadata?.document;
              const authors = parsed.metadata?.authors?.author;
              const sigs = parsed.metadata?.signatures?.signature;

              if (doc) {
                metadata.documents.push({
                  title: doc.title ?? null,
                  id: doc.ID ?? null,
                });
              }

              if (authors) {
                const authorList = Array.isArray(authors) ? authors : [authors];
                for (const a of authorList) {
                  metadata.authors.push({
                    name: a.name ?? null,
                    code: a.code ?? null,
                    address: a.address ?? null,
                    individual: a.individual ?? null,
                    id: a.ID ?? null,
                  });
                }
              }

              if (sigs) {
                const sigList = Array.isArray(sigs) ? sigs : [sigs];
                for (const s of sigList) {
                  metadata.signatures.push({
                    signatureID: s.signatureID ?? null,
                    signingTime: s.signingTime ?? null,
                    signingPurpose: s.signingPurpose ?? null,
                    signer: s.signer ?? null,
                    id: s.ID ?? null,
                  });
                }
              }
            }

            // ---------- FILES METADATA LIKE ZIP ----------
            if (
              name !== "mimetype" &&
              !name.startsWith("META-INF/") &&
              !name.startsWith("metadata/")
            ) {
              let md5 = null;
              if (!isDirectory) {
                const content = await readEntryText(zipfile, entry);
                md5 = crypto.createHash("md5").update(content).digest("hex");
              }

              files.push({
                name: path.basename(name),
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

            zipfile.readEntry();
          } catch (e) {
            zipfile.close();
            return reject(e);
          }
        });

        zipfile.on("end", () => {
          // build filesTree like ZIP extractor
          const root = [];
          for (const file of files) {
            const parts = file.path.split("/").filter(Boolean);
            let level = root;
            parts.forEach((part, i) => {
              const isLast = i === parts.length - 1;
              let node = level.find((n) => n.name === part);
              if (!node) {
                node = isLast
                  ? { ...file }
                  : { name: part, isDirectory: true, children: [] };
                level.push(node);
              }
              level = node.children ?? [];
            });
          }

          const flatFiles = files.filter((f) => !f.isDirectory);

          const sigMap = new Map();
          for (const sig of metadata.signatures) {
            const id = sig.signatureID;
            if (!id) continue;
            if (sigMap.has(id)) {
              sigMap.set(id, deepMerge(sigMap.get(id), sig));
            } else {
              sigMap.set(id, sig);
            }
          }
          metadata.signatures = Array.from(sigMap.values());

          resolve({
            pages: [],
            metadata: {
              ...metadata,
              files: flatFiles,
              filesTree: root,
            },
          });
        });

        zipfile.on("error", reject);
      },
    );
  });
}

import { X509Certificate } from "crypto";

function parseSignatureNode(sig) {
  const signedProps =
    sig.Object?.QualifyingProperties?.SignedProperties
      ?.SignedSignatureProperties;

  const signedDataObjs =
    sig.Object?.QualifyingProperties?.SignedProperties
      ?.SignedDataObjectProperties?.DataObjectFormat;

  const digestAlgorithm =
    sig.SignedInfo?.Reference?.DigestMethod?.Algorithm ?? null;

  const certificates = [];
  const signerInfo = {};

  try {
    const x509Data = sig.KeyInfo?.X509Data;
    if (x509Data) {
      const rawCerts = Array.isArray(x509Data.X509Certificate)
        ? x509Data.X509Certificate
        : x509Data.X509Certificate
          ? [x509Data.X509Certificate]
          : [];

      for (const c of rawCerts) {
        if (!c) continue;
        try {
          // Remove whitespace/newlines
          const base64 = c.replace(/[\r\n\s]/g, "");
          // Decode base64 into DER buffer
          const derBuffer = Buffer.from(base64, "base64");

          // Wrap in try/catch because some certificates may be malformed
          const cert = new X509Certificate(derBuffer);
          certificates.push(cert);
        } catch (err) {}
      }

      signerInfo.issuerName = x509Data.X509IssuerName ?? null;
      signerInfo.serialNumber = x509Data.X509SerialNumber ?? null;
    }
  } catch (e) {
    console.warn("Malformed KeyInfo, skipping", e.message);
  }

  return {
    signatureID: sig.Id ?? null,
    signingTime: signedProps?.SigningTime ?? null,
    signerRole: signedProps?.SignerRole?.ClaimedRoles?.ClaimedRole ?? null,
    digestAlgorithm,
    certificates, // now contains X509Certificate objects
    signerInfo,
    signedDataObjects: Array.isArray(signedDataObjs)
      ? signedDataObjs
      : signedDataObjs
        ? [signedDataObjs]
        : [],
  };
}
