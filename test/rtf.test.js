import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractRtfContent } from "../extractors/rtf.js";

const URLS = {
  rtf:        "https://failai.viespirkiai.org/49906539",
  rtfShapes:  "https://failai.viespirkiai.org/82508865",
  rtfRawBytes: "https://failai.viespirkiai.org/1774931",
};

// ---------------------------------------------------------------------------
// Normal RTF (paragraph flow)
// ---------------------------------------------------------------------------

describe("extractRtfContent — paragraph flow", () => {
  it("returns pages array and metadata", async () => {
    const r = await extractRtfContent(URLS.rtf);
    assert.ok(Array.isArray(r.pages));
    assert.ok(r.pages.length > 0);
    assert.ok(r.metadata);
  });

  it("extracts Lithuanian text correctly", async () => {
    const { pages } = await extractRtfContent(URLS.rtf);
    const text = pages.join("\n");
    assert.ok(text.includes("MAŽEIKIŲ"));
    assert.ok(text.includes("VIEŠŲJŲ PIRKIMŲ"));
    assert.ok(text.length > 10000);
  });

  it("has document metadata", async () => {
    const { metadata: m } = await extractRtfContent(URLS.rtf);
    assert.equal(m.author,     "saulute");
    assert.equal(m.operator,   "saulute");
    assert.equal(m.createdAt,  "2012-12-17T15:12:00.000Z");
    assert.equal(m.modifiedAt, "2012-12-17T15:12:00.000Z");
    assert.ok(m.generator.includes("Microsoft Word"));
  });

  it("has word and character counts", async () => {
    const { metadata: m } = await extractRtfContent(URLS.rtf);
    assert.ok(m.wordCount      > 1000);
    assert.ok(m.characterCount > 10000);
  });

  it("has parsed fields", async () => {
    const { metadata: m } = await extractRtfContent(URLS.rtf);
    assert.ok(Array.isArray(m.companyIds));
    assert.ok(Array.isArray(m.ibans));
    assert.ok(Array.isArray(m.phones));
    assert.ok(Array.isArray(m.links));
    assert.ok(Array.isArray(m.emails));
    assert.ok(Array.isArray(m.ipAddresses));
    assert.ok(Array.isArray(m.macAddresses));
  });
});

// ---------------------------------------------------------------------------
// RTF with shape/text-box layout (\shptxt)
// ---------------------------------------------------------------------------

describe("extractRtfContent — shape text boxes", () => {
  it("extracts text from \\shptxt groups", async () => {
    const { pages } = await extractRtfContent(URLS.rtfShapes);
    const text = pages[0];
    assert.ok(text.includes("ŽEMĖS SKLYPO KADASTRO DUOMENYS"));
    assert.ok(text.includes("UAB GEOMETRA"));
    assert.ok(text.length > 500);
  });

  it("has document metadata", async () => {
    const { metadata: m } = await extractRtfContent(URLS.rtfShapes);
    assert.equal(m.author,    "Vartotojas");
    assert.equal(m.createdAt, "2013-06-13T09:43:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// RTF with raw high bytes and no \ansicpg declaration
// ---------------------------------------------------------------------------

describe("extractRtfContent — raw bytes, no \\ansicpg", () => {
  it("decodes Lithuanian characters correctly", async () => {
    const { pages } = await extractRtfContent(URLS.rtfRawBytes);
    const text = pages.join("\n");
    assert.ok(text.includes("ĮPRASTINĖ"));
    assert.ok(text.includes("PRIEMONIŲ"));
    assert.ok(text.includes("VALDYTOJŲ"));
    assert.ok(text.length > 5000);
  });
});
