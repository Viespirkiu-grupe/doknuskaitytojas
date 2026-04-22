import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractPdfContent } from "../extractors/pdf.js";

// PDF with a single CAdES signature, no text, empty signer cert fields
const SIGNED_PDF = "https://failai.viespirkiai.org/1780965";
// PDF with two valid CAdES signatures with Lithuanian signer certificates
const MULTI_SIGNED_PDF = "https://failai.viespirkiai.org/89128016";

describe("extractPdfContent — digital signatures", () => {
  it("returns a signatures array", async () => {
    const { metadata } = await extractPdfContent(SIGNED_PDF);
    assert.ok(Array.isArray(metadata.signatures));
    assert.equal(metadata.signatures.length, 1);
  });

  it("signature has required schema fields", async () => {
    const [sig] = (await extractPdfContent(SIGNED_PDF)).metadata.signatures;
    assert.equal(typeof sig.number, "number");
    assert.equal(typeof sig.fieldName, "string");
    assert.equal(typeof sig.type, "string");
    assert.equal(typeof sig.totalDocumentSigned, "boolean");
    assert.ok(Array.isArray(sig.signedRanges));
    assert.equal(typeof sig.validation, "string");
  });

  it("has correct known values", async () => {
    const [sig] = (await extractPdfContent(SIGNED_PDF)).metadata.signatures;
    assert.equal(sig.number, 1);
    assert.equal(sig.fieldName, "Signature1");
    assert.equal(sig.type, "ETSI.CAdES.detached");
    assert.equal(sig.signingTime, "2024-03-19T10:56:41.000Z");
    assert.equal(sig.totalDocumentSigned, false);
    assert.equal(sig.hashAlgorithm, null);
  });

  it("signedRanges are pairs of non-negative integers", async () => {
    const [sig] = (await extractPdfContent(SIGNED_PDF)).metadata.signatures;
    for (const range of sig.signedRanges) {
      assert.equal(range.length, 2);
      assert.ok(range[0] >= 0);
      assert.ok(range[1] > range[0]);
    }
  });

  it("does not include PDF-specific fields for converted docs", async () => {
    const { metadata } = await extractPdfContent(SIGNED_PDF, { skipPdfMetadata: true });
    assert.ok(!("signatures" in metadata));
    assert.ok(!("sloppyRedactions" in metadata));
    assert.ok(!("annotations" in metadata));
  });
});

describe("extractPdfContent — multiple valid signatures", () => {
  it("returns two signatures", async () => {
    const { metadata } = await extractPdfContent(MULTI_SIGNED_PDF);
    assert.equal(metadata.signatures.length, 2);
  });

  it("both signatures are valid", async () => {
    const { metadata } = await extractPdfContent(MULTI_SIGNED_PDF);
    for (const sig of metadata.signatures) {
      assert.equal(sig.isValid, true);
      assert.equal(sig.validation, "Signature is Valid.");
    }
  });

  it("signatures have correct non-personal fields", async () => {
    const [s1, s2] = (await extractPdfContent(MULTI_SIGNED_PDF)).metadata.signatures;

    assert.equal(s1.number, 1);
    assert.equal(s1.fieldName, "Signature1");
    assert.equal(s1.type, "ETSI.CAdES.detached");
    assert.equal(s1.hashAlgorithm, "SHA-256");
    assert.equal(s1.signerCountry, "LT");
    assert.equal(s1.hasPersonalId, true);
    assert.equal(s1.totalDocumentSigned, false);
    assert.equal(s1.signingTime, "2026-03-31T07:01:31.000Z");
    assert.equal(s1.signerEmail, "direktorius@tauragesligonine.lt");

    assert.equal(s2.number, 2);
    assert.equal(s2.fieldName, "Signature2");
    assert.equal(s2.signerCountry, "LT");
    assert.equal(s2.hasPersonalId, true);
    assert.equal(s2.signingTime, "2026-03-31T08:27:27.000Z");
    assert.equal(s2.signerEmail, null);
  });

  it("signerCN present but not asserted (GDPR), signerDN not stored", async () => {
    const { metadata } = await extractPdfContent(MULTI_SIGNED_PDF);
    for (const sig of metadata.signatures) {
      assert.equal(typeof sig.signerCN, "string");
      assert.ok(!("signerDN" in sig), "signerDN must not be stored — contains personal ID numbers");
    }
  });
});
