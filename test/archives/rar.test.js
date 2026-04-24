import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractRarContent } from "../../extractors/archives/rar.js";

const TEST_URL = "https://failai.viespirkiai.org/449152";

describe("extractRarContent", () => {
  it("returns the expected result shape", async () => {
    const result = await extractRarContent(TEST_URL);

    assert.ok(Array.isArray(result.pages));
    assert.equal(result.pages.length, 0);
    assert.ok(result.metadata);
    assert.ok(Array.isArray(result.metadata.files));
    assert.ok(Array.isArray(result.metadata.filesTree));
  });

  it("finds 3 files", async () => {
    const { metadata } = await extractRarContent(TEST_URL);
    assert.equal(metadata.files.length, 3);
  });

  it("each file has required fields with correct types", async () => {
    const { metadata } = await extractRarContent(TEST_URL);
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
    const { metadata } = await extractRarContent(TEST_URL);
    assert.ok(metadata.files.every((f) => !f.isDirectory));
  });

  it("filesTree root has one directory node", async () => {
    const { metadata } = await extractRarContent(TEST_URL);
    assert.equal(metadata.filesTree.length, 1);
    assert.equal(metadata.filesTree[0].name, "Skirgesa  -pasiūl");
    assert.equal(metadata.filesTree[0].isDirectory, true);
    assert.ok(Array.isArray(metadata.filesTree[0].children));
    assert.equal(metadata.filesTree[0].children.length, 3);
  });

  it("decodes Lithuanian filenames correctly", async () => {
    const { metadata } = await extractRarContent(TEST_URL);
    const names = metadata.files.map((f) => f.name);
    assert.ok(names.includes("Prašymas dėl kainų.pdf"), "should contain Lithuanian ą, ė, ų");
  });

  it("matches exact file entries", async () => {
    const { metadata } = await extractRarContent(TEST_URL);
    const byPath = Object.fromEntries(metadata.files.map((f) => [f.path, f]));

    assert.deepEqual(byPath["Skirgesa  -pasiūl/1 Pasiūlymas.pdf"], {
      name: "1 Pasiūlymas.pdf",
      path: "Skirgesa  -pasiūl/1 Pasiūlymas.pdf",
      size: 1148767,
      compressedSize: null,
      extension: "pdf",
      lastModDate: new Date("2018-03-30T08:24:38.569Z"),
      isDirectory: false,
      md5: "dc734b4129ee4b7b5e5c67ab85d161e4",
      children: undefined,
    });

    assert.deepEqual(byPath["Skirgesa  -pasiūl/1.1. Pasiūlymas_kainos -v.xls"], {
      name: "1.1. Pasiūlymas_kainos -v.xls",
      path: "Skirgesa  -pasiūl/1.1. Pasiūlymas_kainos -v.xls",
      size: 187904,
      compressedSize: null,
      extension: "xls",
      lastModDate: new Date("2018-03-30T09:42:02.261Z"),
      isDirectory: false,
      md5: "91cae242558d34ccfcf8a3df0c210d37",
      children: undefined,
    });
  });
});
