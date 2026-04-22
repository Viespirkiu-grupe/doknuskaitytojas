import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractTxtContent } from "../extractors/txt.js";

// Lithuanian plain-text file encoded in CP1257
const TEST_URL = "https://failai.viespirkiai.org/22789074";

describe("extractTxtContent", () => {
  it("returns the expected result shape", async () => {
    const result = await extractTxtContent(TEST_URL);

    assert.ok(Array.isArray(result.pages));
    assert.ok(result.metadata);
  });

  it("has one page (the decoded text)", async () => {
    const { pages } = await extractTxtContent(TEST_URL);
    assert.equal(pages.length, 1);
    assert.equal(typeof pages[0], "string");
  });

  it("detects a non-UTF-8 encoding for a CP1257 file", async () => {
    const { metadata } = await extractTxtContent(TEST_URL);
    assert.notEqual(metadata.encoding, "utf8");
    assert.equal(typeof metadata.encoding, "string");
  });

  it("decodes Lithuanian characters correctly", async () => {
    const { pages } = await extractTxtContent(TEST_URL);
    // The file contains Lithuanian letters — at least one must survive decoding
    const hasLithuanian = /[ąčęėįšųūžĄČĘĖĮŠŲŪŽ]/.test(pages[0]);
    assert.ok(hasLithuanian, "decoded text should contain Lithuanian characters");
  });

  it("text field equals pages[0]", async () => {
    const { pages, metadata } = await extractTxtContent(TEST_URL);
    assert.equal(metadata.text, pages[0]);
  });

  it("normalises line endings to LF", async () => {
    const { pages } = await extractTxtContent(TEST_URL);
    assert.ok(!pages[0].includes("\r\n"), "CRLF should be normalised to LF");
  });

  it("has correct counts", async () => {
    const { metadata } = await extractTxtContent(TEST_URL);
    assert.equal(metadata.pageCount, 1);
    assert.equal(metadata.characterCount, metadata.text.length);
    assert.ok(metadata.wordCount > 0);
  });

  it("has parsed text fields", async () => {
    const { metadata } = await extractTxtContent(TEST_URL);

    assert.ok(Array.isArray(metadata.companyIds));
    assert.ok(Array.isArray(metadata.ibans));
    assert.ok(Array.isArray(metadata.phones));
    assert.ok(Array.isArray(metadata.links));
    assert.ok(Array.isArray(metadata.emails));
    assert.ok(Array.isArray(metadata.ipAddresses));
    assert.ok(Array.isArray(metadata.macAddresses));
    assert.ok(Array.isArray(metadata.domains));
  });
});
