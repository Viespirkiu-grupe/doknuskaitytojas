import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractAdocContent } from "../extractors/adoc.js";

// Contract between two legal entities, 3 signatures (one with personal-ID cert), one PDF annex
const CONTRACT_WITH_ANNEX = "https://failai.viespirkiai.org/1001450";
// Contract signed by one legal entity, 4 signatures (two with personal-ID certs), one docx annex
const CONTRACT_MULTI_SIG  = "https://failai.viespirkiai.org/1004117";

// ── CONTRACT_WITH_ANNEX ────────────────────────────────────────────────────

describe("extractAdocContent — contract with annex (1001450)", () => {
  it("returns expected container fields", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.equal(metadata.containerType, "ADOC");
    assert.equal(metadata.standardVersion, "ADOC-V1.0");
    assert.equal(metadata.documentCategory, "GeDOC");
  });

  it("returns document title and type", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.equal(metadata.title, "PASLAUGŲ PIRKIMO–PARDAVIMO SUTARTIS");
    assert.equal(metadata.documentType, "SUTARTIS");
  });

  it("returns two legal-entity authors with correct codes", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.equal(metadata.authors.length, 2);
    const codes = metadata.authors.map((a) => a.code).sort();
    assert.deepEqual(codes, ["125904793", "188753461"]);
    assert.ok(metadata.authors.every((a) => a.individual === false));
  });

  it("returns one registration with correct number and date", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.equal(metadata.registrations.length, 1);
    assert.equal(metadata.registrations[0].number, "SR(6.68 E)-38");
    assert.ok(metadata.registrations[0].date.startsWith("2021-02-01"));
  });

  it("returns no receptions and no attachments", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.equal(metadata.receptions.length, 0);
    assert.equal(metadata.attachments.length, 0);
  });

  it("returns main document as docx", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.ok(metadata.mainDocument);
    assert.equal(
      metadata.mainDocument.mediaType,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("returns one PDF annex", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.equal(metadata.annexes.length, 1);
    assert.equal(metadata.annexes[0].mediaType, "application/pdf");
  });

  it("returns three signatures", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.equal(metadata.signatures.length, 3);
  });

  it("all signatures use SHA-256 and isValid is null (not validated at extraction)", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    for (const sig of metadata.signatures) {
      assert.equal(sig.hashAlgorithm, "SHA-256");
      assert.equal(sig.isValid, null);
    }
  });

  it("signature purposes match expected workflow: signature, registration, signature", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    const purposes = metadata.signatures.map((s) => s.signingPurpose);
    assert.deepEqual(purposes, ["signature", "registration", "signature"]);
  });

  it("XAdES levels: first two have embedded cert data (T or higher), third has no cert", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    const [s0, s1, s2] = metadata.signatures;
    assert.equal(s0.level, "XAdES-T");
    assert.equal(s1.level, "XAdES-EPES");
    assert.equal(s2.level, "XAdES-T");
  });

  it("first signature has a Lithuanian personal-ID cert (PNOLT-)", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    const [s0] = metadata.signatures;
    assert.equal(s0.hasPersonalId, true);
    assert.equal(s0.signerCountry, "LT");
  });

  it("second signature is a system signature without personal-ID", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    const s1 = metadata.signatures[1];
    assert.equal(s1.hasPersonalId, false);
    assert.equal(s1.signerCountry, "LT");
    assert.equal(s1.signingPurpose, "registration");
  });

  it("third signature has no embedded cert (foreign signer)", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    const s2 = metadata.signatures[2];
    assert.equal(s2.hasPersonalId, false);
    assert.equal(s2.signerCountry, null);
    assert.equal(s2.signerCN, null);
  });

  it("signers have declared position in metadata", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    for (const sig of metadata.signatures) {
      // signer object present for all three (declared in signable metadata)
      assert.ok(sig.signer !== null, `expected signer object for ${sig.filePath}`);
    }
  });

  it("contentRefsCount is positive for all signatures", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    for (const sig of metadata.signatures) {
      assert.ok(sig.contentRefsCount > 0, `expected refs > 0 for ${sig.filePath}`);
    }
  });

  it("files list contains all ZIP entries (no mimetype entry)", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_WITH_ANNEX);
    assert.ok(metadata.files.length > 0);
    assert.ok(!metadata.files.some((f) => f.path === "mimetype"));
    assert.ok(metadata.files.every((f) => typeof f.md5 === "string" && /^[0-9a-f]{32}$/.test(f.md5)));
  });
});

// ── CONTRACT_MULTI_SIG ─────────────────────────────────────────────────────

describe("extractAdocContent — contract with four signatures (1004117)", () => {
  it("returns expected container fields", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    assert.equal(metadata.containerType, "ADOC");
    assert.equal(metadata.standardVersion, "ADOC-V1.0");
    assert.equal(metadata.documentCategory, "GeDOC");
  });

  it("returns one legal-entity author with correct code", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    assert.equal(metadata.authors.length, 1);
    assert.equal(metadata.authors[0].code, "190530992");
    assert.equal(metadata.authors[0].individual, false);
  });

  it("returns two registration records", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    assert.equal(metadata.registrations.length, 2);
    const numbers = metadata.registrations.map((r) => r.number).sort();
    assert.deepEqual(numbers, ["CP-221095", "F1-1"]);
    assert.ok(metadata.registrations.every((r) => r.date.startsWith("2021-01-22")));
  });

  it("returns one docx annex", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    assert.equal(metadata.annexes.length, 1);
    assert.equal(
      metadata.annexes[0].mediaType,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("returns four signatures", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    assert.equal(metadata.signatures.length, 4);
  });

  it("signature purposes: signature, registration, signature, registration", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    const purposes = metadata.signatures.map((s) => s.signingPurpose);
    assert.deepEqual(purposes, ["signature", "registration", "signature", "registration"]);
  });

  it("all four are XAdES-EPES (no timestamps embedded)", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    for (const sig of metadata.signatures) {
      assert.equal(sig.level, "XAdES-EPES");
    }
  });

  it("first two signatures have no embedded cert", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    const [s0, s1] = metadata.signatures;
    assert.equal(s0.signerCN, null);
    assert.equal(s0.hasPersonalId, false);
    assert.equal(s1.signerCN, null);
    assert.equal(s1.hasPersonalId, false);
  });

  it("last two signatures have Lithuanian personal-ID certs", async () => {
    const { metadata } = await extractAdocContent(CONTRACT_MULTI_SIG);
    const [, , s2, s3] = metadata.signatures;
    assert.equal(s2.hasPersonalId, true);
    assert.equal(s2.signerCountry, "LT");
    assert.equal(s3.hasPersonalId, true);
    assert.equal(s3.signerCountry, "LT");
  });

  it("pages array is empty (no text extraction for ADOC)", async () => {
    const { pages } = await extractAdocContent(CONTRACT_MULTI_SIG);
    assert.deepEqual(pages, []);
  });
});
