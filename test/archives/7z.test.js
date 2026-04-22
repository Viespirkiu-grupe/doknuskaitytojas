import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extract7zContent } from "../../extractors/archives/7z.js";

const TEST_URL = "https://failai.viespirkiai.org/22580823";

describe("extract7zContent", () => {
  it("returns the expected result shape", async () => {
    const result = await extract7zContent(TEST_URL);

    assert.ok(Array.isArray(result.pages));
    assert.equal(result.pages.length, 0);
    assert.ok(result.metadata);
    assert.ok(Array.isArray(result.metadata.files));
    assert.ok(Array.isArray(result.metadata.filesTree));
  });

  it("finds 9 files", async () => {
    const { metadata } = await extract7zContent(TEST_URL);
    assert.equal(metadata.files.length, 9);
  });

  it("each file has required fields with correct types", async () => {
    const { metadata } = await extract7zContent(TEST_URL);
    for (const file of metadata.files) {
      assert.equal(typeof file.name, "string");
      assert.equal(typeof file.path, "string");
      assert.equal(typeof file.size, "number");
      assert.equal(file.compressedSize, null);
      assert.equal(typeof file.extension, "string");
      assert.ok(file.lastModDate instanceof Date);
      assert.equal(file.isDirectory, false);
      assert.match(file.md5, /^[0-9a-f]{32}$/);
      assert.equal(file.children, undefined);
    }
  });

  it("flat files list contains no directories", async () => {
    const { metadata } = await extract7zContent(TEST_URL);
    assert.ok(metadata.files.every((f) => !f.isDirectory));
  });

  it("filesTree root has one directory node", async () => {
    const { metadata } = await extract7zContent(TEST_URL);
    assert.equal(metadata.filesTree.length, 1);
    assert.equal(metadata.filesTree[0].name, "Pirkimo dokumentai");
    assert.equal(metadata.filesTree[0].isDirectory, true);
    assert.ok(Array.isArray(metadata.filesTree[0].children));
  });

  it("matches exact file entries", async () => {
    const { metadata } = await extract7zContent(TEST_URL);
    const byPath = Object.fromEntries(metadata.files.map((f) => [f.path, f]));

    assert.deepEqual(byPath["Pirkimo dokumentai/1 priedas_techninė specifikacija/1 priedas_Techninė_specifikacija.pdf"], {
      name: "1 priedas_Techninė_specifikacija.pdf",
      path: "Pirkimo dokumentai/1 priedas_techninė specifikacija/1 priedas_Techninė_specifikacija.pdf",
      size: 244117,
      compressedSize: null,
      extension: "pdf",
      lastModDate: new Date("2025-01-13T06:17:08.000Z"),
      isDirectory: false,
      md5: "a7f7bf0aa2462f8f10fcf94044e4da1e",
      children: undefined,
    });

    assert.deepEqual(byPath["Pirkimo dokumentai/espd-request (2).zip"], {
      name: "espd-request (2).zip",
      path: "Pirkimo dokumentai/espd-request (2).zip",
      size: 88391,
      compressedSize: null,
      extension: "zip",
      lastModDate: new Date("2025-02-12T11:03:55.036Z"),
      isDirectory: false,
      md5: "c5e7ef9bd893f780879ed97c4211b8c5",
      children: undefined,
    });
  });
});
