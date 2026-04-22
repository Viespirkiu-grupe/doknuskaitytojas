import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractZipContent } from "../../extractors/archives/zip.js";

const TEST_URL = "https://failai.viespirkiai.org/68702628";

describe("extractZipContent", () => {
  it("returns the expected result shape", async () => {
    const result = await extractZipContent(TEST_URL);

    assert.ok(Array.isArray(result.pages));
    assert.equal(result.pages.length, 0);
    assert.ok(result.metadata);
    assert.ok(Array.isArray(result.metadata.files));
    assert.ok(Array.isArray(result.metadata.filesTree));
  });

  it("finds 7 files", async () => {
    const { metadata } = await extractZipContent(TEST_URL);
    assert.equal(metadata.files.length, 7);
  });

  it("each file has required fields with correct types", async () => {
    const { metadata } = await extractZipContent(TEST_URL);
    for (const file of metadata.files) {
      assert.equal(typeof file.name, "string");
      assert.equal(typeof file.path, "string");
      assert.equal(typeof file.size, "number");
      assert.equal(typeof file.compressedSize, "number");
      assert.equal(typeof file.extension, "string");
      assert.ok(file.lastModDate instanceof Date);
      assert.equal(file.isDirectory, false);
      assert.equal(typeof file.compressionMethod, "number");
      assert.match(file.md5, /^[0-9a-f]{32}$/);
      assert.equal(file.children, undefined);
    }
  });

  it("flat files list contains no directories", async () => {
    const { metadata } = await extractZipContent(TEST_URL);
    assert.ok(metadata.files.every((f) => !f.isDirectory));
  });

  it("filesTree root has two nodes (one file, one directory)", async () => {
    const { metadata } = await extractZipContent(TEST_URL);
    assert.equal(metadata.filesTree.length, 2);
    const dir = metadata.filesTree.find((n) => n.isDirectory);
    assert.ok(dir);
    assert.equal(dir.name, "Priedai");
    assert.ok(Array.isArray(dir.children));
    assert.equal(dir.children.length, 6);
  });

  it("decodes Lithuanian filenames correctly", async () => {
    const { metadata } = await extractZipContent(TEST_URL);
    const names = metadata.files.map((f) => f.name);
    assert.ok(names.includes("Techninė specifikacija.docx"), "should contain Lithuanian ė");
  });

  it("matches exact file entries", async () => {
    const { metadata } = await extractZipContent(TEST_URL);
    const byPath = Object.fromEntries(metadata.files.map((f) => [f.path, f]));

    assert.deepEqual(byPath["0. Rinkos konsultacija.docx"], {
      name: "0. Rinkos konsultacija.docx",
      path: "0. Rinkos konsultacija.docx",
      size: 43880,
      compressedSize: 37781,
      extension: "docx",
      lastModDate: new Date("2026-03-16T09:48:10.000Z"),
      isDirectory: false,
      compressionMethod: 8,
      md5: "7ee470613f463fd32621f0f35d757449",
    });

    assert.deepEqual(byPath["Priedai/Techninė specifikacija.docx"], {
      name: "Techninė specifikacija.docx",
      path: "Priedai/Techninė specifikacija.docx",
      size: 58671,
      compressedSize: 52541,
      extension: "docx",
      lastModDate: new Date("2026-03-16T09:46:05.000Z"),
      isDirectory: false,
      compressionMethod: 8,
      md5: "635c05d30060b88da9d58c46732fff6e",
    });
  });
});
