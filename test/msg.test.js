import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMsgContent } from "../extractors/msg.js";

const TEST_URL = "https://failai.viespirkiai.org/22586841";

describe("extractMsgContent", () => {
  it("returns the expected result shape", async () => {
    const result = await extractMsgContent(TEST_URL);

    assert.ok(Array.isArray(result.pages));
    assert.ok(result.metadata);
  });

  it("has one page (body text)", async () => {
    const { pages } = await extractMsgContent(TEST_URL);
    assert.equal(pages.length, 1);
    assert.equal(typeof pages[0], "string");
  });

  it("has correct email headers", async () => {
    const { metadata } = await extractMsgContent(TEST_URL);

    assert.equal(metadata.subject, "Dėl CVP IS 2025.01.21 užfiksuotų sutrikimų");
    assert.deepEqual(metadata.from, { name: "CVPIS", email: "cvpis@VPT.LT" });
    assert.deepEqual(metadata.to, [{ name: "CVPIS", email: "cvpis@VPT.LT" }]);
  });

  it("text starts with subject, from, to then body", async () => {
    const { pages, metadata } = await extractMsgContent(TEST_URL);

    assert.ok(metadata.text.startsWith("Subject: Dėl CVP IS 2025.01.21 užfiksuotų sutrikimų\n"));
    assert.ok(metadata.text.includes("From: CVPIS <cvpis@VPT.LT>\n"));
    assert.ok(metadata.text.includes("To: CVPIS <cvpis@VPT.LT>\n"));
    assert.ok(metadata.text.endsWith(pages[0]));
  });

  it("body is in sections, not top-level", async () => {
    const { metadata } = await extractMsgContent(TEST_URL);

    assert.ok("sections" in metadata);
    assert.equal(typeof metadata.sections.plain, "string");
    assert.ok(!("body"     in metadata), "body should not be at top level");
    assert.ok(!("bodyHtml" in metadata), "bodyHtml should not be at top level");
  });

  it("parses headers into a keyed object", async () => {
    const { metadata } = await extractMsgContent(TEST_URL);

    assert.equal(typeof metadata.headers, "object");
    assert.ok(!Array.isArray(metadata.headers));
    // Headers present in this message
    assert.equal(typeof metadata.headers["From"], "string");
    assert.equal(typeof metadata.headers["Subject"], "string");
    // Received appears multiple times → array
    assert.ok(Array.isArray(metadata.headers["Received"]));
  });

  it("has no internal msgreader fields at top level", async () => {
    const { metadata } = await extractMsgContent(TEST_URL);
    const internal = ["senderName", "senderEmail", "recipients", "compressedRtf",
                      "dataType", "normalizedSubject", "conversationTopic",
                      "messageFlags", "messageCodepage"];
    for (const key of internal) {
      assert.ok(!(key in metadata), `${key} should not be in metadata`);
    }
  });

  it("normalises attachments", async () => {
    const { metadata } = await extractMsgContent(TEST_URL);

    assert.equal(metadata.attachments.length, 1);
    assert.deepEqual(metadata.attachments[0], {
      name: "Outlook-Bangos for.png",
      contentType: "image/png",
      size: 11550,
    });
  });

  it("has parsed text fields", async () => {
    const { metadata } = await extractMsgContent(TEST_URL);

    assert.ok(Array.isArray(metadata.companyIds));
    assert.ok(Array.isArray(metadata.ibans));
    assert.ok(Array.isArray(metadata.phones));
    assert.ok(Array.isArray(metadata.links));
    assert.ok(Array.isArray(metadata.emails));
    assert.ok(Array.isArray(metadata.ipAddresses));
    assert.ok(Array.isArray(metadata.macAddresses));
    assert.ok(Array.isArray(metadata.domains));
  });

  it("has correct counts", async () => {
    const { metadata } = await extractMsgContent(TEST_URL);
    assert.equal(metadata.pageCount, 1);
    assert.equal(metadata.characterCount, 1152);
    assert.equal(metadata.wordCount, 148);
  });
});
