import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractThumbsdbContent } from "../extractors/thumbsdb.js";

const TEST_URL = "https://failai.viespirkiai.org/22159552";

describe("extractThumbsdbContent", () => {
  it("returns the expected result shape", async () => {
    const result = await extractThumbsdbContent(TEST_URL);

    assert.ok(Array.isArray(result.pages), "pages should be an array");
    assert.equal(result.pages.length, 0, "pages should be empty");
    assert.ok(result.metadata, "metadata should exist");
    assert.ok(Array.isArray(result.metadata.files), "metadata.files should be an array");
  });

  it("finds 4 thumbnails", async () => {
    const { metadata } = await extractThumbsdbContent(TEST_URL);
    assert.equal(metadata.files.length, 4);
  });

  it("each file has required fields", async () => {
    const { metadata } = await extractThumbsdbContent(TEST_URL);
    for (const file of metadata.files) {
      assert.equal(typeof file.hash, "string", "hash should be a string");
      assert.match(file.hash, /^[0-9a-f]{16}$/i, "hash should be 16 hex chars");
      assert.equal(typeof file.thumbnailSize, "number");
      assert.equal(typeof file.width, "number");
      assert.equal(typeof file.height, "number");
      assert.equal(typeof file.jpegSize, "number");
      assert.ok(file.lastModDate instanceof Date || file.lastModDate === null);
    }
  });

  it("all thumbnails are 256px max dimension", async () => {
    const { metadata } = await extractThumbsdbContent(TEST_URL);
    for (const file of metadata.files) {
      assert.equal(file.thumbnailSize, 256);
      assert.ok(
        file.width === 256 || file.height === 256,
        `at least one dimension should equal thumbnailSize (got ${file.width}x${file.height})`
      );
    }
  });

  it("matches exact file entries", async () => {
    const { metadata } = await extractThumbsdbContent(TEST_URL);

    const byHash = Object.fromEntries(metadata.files.map((f) => [f.hash, f]));

    assert.deepEqual(byHash["269932e798296a23"], {
      hash: "269932e798296a23",
      thumbnailSize: 256,
      width: 256,
      height: 152,
      jpegSize: 14276,
      lastModDate: new Date("2019-05-19T14:17:18.000Z"),
    });

    assert.deepEqual(byHash["cb477da1e7505f65"], {
      hash: "cb477da1e7505f65",
      thumbnailSize: 256,
      width: 192,
      height: 256,
      jpegSize: 13048,
      lastModDate: new Date("2007-12-26T21:16:52.000Z"),
    });

    assert.deepEqual(byHash["186879d64f115b32"], {
      hash: "186879d64f115b32",
      thumbnailSize: 256,
      width: 192,
      height: 256,
      jpegSize: 12247,
      lastModDate: new Date("2073-04-25T18:36:17.000Z"),
    });

    assert.deepEqual(byHash["151aa20c31b7a876"], {
      hash: "151aa20c31b7a876",
      thumbnailSize: 256,
      width: 256,
      height: 157,
      jpegSize: 13729,
      lastModDate: new Date("2025-08-04T05:28:08.000Z"),
    });
  });
});
