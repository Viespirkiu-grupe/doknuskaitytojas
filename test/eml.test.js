import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractEmlContent } from "../extractors/eml.js";

const TEST_URL = "https://failai.viespirkiai.org/49879964";

describe("extractEmlContent", () => {
  it("returns the expected result shape", async () => {
    const result = await extractEmlContent(TEST_URL);

    assert.ok(Array.isArray(result.pages));
    assert.ok(result.metadata);
  });

  it("has one page (body text)", async () => {
    const { pages } = await extractEmlContent(TEST_URL);
    assert.equal(pages.length, 1);
    assert.equal(typeof pages[0], "string");
  });

  it("has correct email headers", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);

    assert.equal(metadata.subject, "pirkimo_taisyklės_ir_įsakymas");
    assert.deepEqual(metadata.date, new Date("2008-12-30T13:56:00.000Z"));
    assert.deepEqual(metadata.from, { name: "Gadūnavo_sen._finansai", email: "gadunavo.finansai@telsiai.lt" });
    assert.deepEqual(metadata.to, { email: "luokes.finansai@telsiai.lt" });
  });

  it("text starts with subject, from, to then body", async () => {
    const { pages, metadata } = await extractEmlContent(TEST_URL);

    assert.ok(metadata.text.startsWith("Subject: pirkimo_taisyklės_ir_įsakymas\n"));
    assert.ok(metadata.text.includes("From: Gadūnavo_sen._finansai <gadunavo.finansai@telsiai.lt>\n"));
    assert.ok(metadata.text.includes("To: <luokes.finansai@telsiai.lt>\n"));
    // body text is appended after the header lines
    assert.ok(metadata.text.endsWith(pages[0]));
  });

  it("body parts are in sections, not top-level", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);

    assert.ok("sections" in metadata);
    assert.equal(typeof metadata.sections.plain, "string");
    assert.equal(typeof metadata.sections.html, "string");
    assert.ok(!("html" in metadata), "html should not be at top level");
  });

  it("picks plain text over empty HTML body", async () => {
    const { pages, metadata } = await extractEmlContent(TEST_URL);

    // HTML body of this email is an empty <DIV>&nbsp;</DIV> — plain text wins
    assert.equal(pages[0], metadata.sections.plain);
    assert.ok(metadata.characterCount > 0);
  });

  it("lists attachments without binary data", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);

    assert.equal(metadata.attachments.length, 2);
    assert.ok(!metadata.attachments.some((a) => "data"    in a), "data should be stripped");
    assert.ok(!metadata.attachments.some((a) => "content" in a), "content should be stripped");
  });

  it("decodes RFC 2047 encoded attachment filenames", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);
    const names = metadata.attachments.map((a) => a.name);
    assert.deepEqual(names, [
      "pirkimo taisyklės.doc",
      "Įsakymas dėl viešųjų pirkimų.doc",
    ]);
  });

  it("has parsed text fields", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);

    assert.ok(Array.isArray(metadata.companyIds));
    assert.ok(Array.isArray(metadata.ibans));
    assert.ok(Array.isArray(metadata.phones));
    assert.ok(Array.isArray(metadata.links));
    assert.ok(Array.isArray(metadata.emails));
    assert.ok(Array.isArray(metadata.ipAddresses));
    assert.ok(Array.isArray(metadata.macAddresses));
    assert.ok(Array.isArray(metadata.domains));
  });

  it("does not produce false positive IP matches from timestamps", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);
    assert.equal(metadata.ipAddresses.length, 0);
  });

  it("finds both email addresses", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);
    const found = metadata.emails.map((e) => e.email).sort();
    assert.deepEqual(found, [
      "gadunavo.finansai@telsiai.lt",
      "luokes.finansai@telsiai.lt",
    ]);
  });

  it("has correct counts", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);
    assert.equal(metadata.pageCount, 1);
    assert.equal(metadata.characterCount, 140);
    assert.equal(metadata.wordCount, 21);
  });

  it("has no binary data in metadata", async () => {
    const { metadata } = await extractEmlContent(TEST_URL);
    const json = JSON.stringify(metadata);
    assert.ok(!json.includes('"data"'), "raw binary data should not be present");
  });
});
