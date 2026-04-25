import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractDocContent } from "../extractors/doc.js";

const URLS = {
  doc: "https://failai.viespirkiai.org/90400813",
};

describe("extractDocContent", () => {
  it("returns pages array and metadata", async () => {
    const r = await extractDocContent(URLS.doc);
    assert.ok(Array.isArray(r.pages));
    assert.ok(r.pages.length > 0);
    assert.ok(r.metadata);
  });

  it("has correct author and title", async () => {
    const { metadata: m } = await extractDocContent(URLS.doc);
    assert.equal(m.title,  'PERKANČIOJI ORGANIZACIJA: MPB “Geležinis Vilkas”');
    assert.equal(m.author, "Algis");
  });

  it("has parsed fields", async () => {
    const { metadata: m } = await extractDocContent(URLS.doc);
    assert.ok(Array.isArray(m.companyIds));
    assert.ok(Array.isArray(m.ibans));
    assert.ok(Array.isArray(m.phones));
    assert.ok(Array.isArray(m.links));
    assert.ok(Array.isArray(m.emails));
  });
});
