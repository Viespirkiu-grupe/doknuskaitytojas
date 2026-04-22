import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractImageContent } from "../extractors/images.js";

const URLS = {
  jpg:  "https://failai.viespirkiai.org/87441315",
  png:  "https://failai.viespirkiai.org/21985722",
  tif:  "https://failai.viespirkiai.org/1535363",
  bmp:  "https://failai.viespirkiai.org/1596222",
  gif:  "https://failai.viespirkiai.org/1680679",
  tif2: "https://failai.viespirkiai.org/282221",
  heic: "https://failai.viespirkiai.org/22735371",
  webp: "https://failai.viespirkiai.org/22600273",
};

// ---------------------------------------------------------------------------
// Shared shape assertions
// ---------------------------------------------------------------------------

function assertShape(result) {
  assert.ok(Array.isArray(result.pages));
  const m = result.metadata;
  assert.ok(m);
  assert.equal(typeof m.format, "string");
  assert.ok(m.width  > 0);
  assert.ok(m.height > 0);
  // parsed fields always present
  assert.ok(Array.isArray(m.companyIds));
  assert.ok(Array.isArray(m.ibans));
  assert.ok(Array.isArray(m.phones));
  assert.ok(Array.isArray(m.links));
  assert.ok(Array.isArray(m.emails));
  assert.ok(Array.isArray(m.ipAddresses));
  assert.ok(Array.isArray(m.macAddresses));
  assert.ok(Array.isArray(m.domains));
}

// ---------------------------------------------------------------------------
// JPEG with GPS
// ---------------------------------------------------------------------------

describe("extractImageContent — JPEG", () => {
  it("returns the expected result shape", async () => {
    assertShape(await extractImageContent(URLS.jpg));
  });

  it("has correct dimensions and format", async () => {
    const { metadata: m } = await extractImageContent(URLS.jpg);
    assert.equal(m.format, "JPEG");
    assert.equal(m.width,  4000);
    assert.equal(m.height, 3000);
    assert.equal(m.bitDepth, 8);
  });

  it("has camera metadata", async () => {
    const { metadata: m } = await extractImageContent(URLS.jpg);
    assert.ok(m.camera !== null);
    assert.equal(m.camera.make,  "samsung");
    assert.equal(m.camera.model, "Galaxy S24 Ultra");
    assert.equal(m.camera.iso,    50);
    assert.equal(m.camera.exposureTime, "1/1804");
    assert.equal(m.camera.focalLength, 2.2);
    assert.equal(m.camera.focalLength35mm, 13);
  });

  it("has capture dates", async () => {
    const { metadata: m } = await extractImageContent(URLS.jpg);
    assert.ok(m.dates !== null);
    assert.equal(m.dates.captured,  "2025-08-18T14:13:41");
    assert.equal(m.dates.digitized, "2025-08-18T14:13:41");
    assert.equal(m.dates.modified,  "2025-08-18T14:13:41");
  });

  it("has GPS location", async () => {
    const { metadata: m } = await extractImageContent(URLS.jpg);
    assert.ok(m.location !== null);
    assert.ok(Math.abs(m.location.latitude  - 54.9211) < 0.001);
    assert.ok(Math.abs(m.location.longitude - 23.9191) < 0.001);
    assert.equal(m.location.altitude, 117);
  });

  it("has ICC profile", async () => {
    const { metadata: m } = await extractImageContent(URLS.jpg);
    assert.ok(m.icc !== null);
    assert.ok(m.icc.description.includes("DCI-P3"));
    assert.equal(m.icc.colorSpace, "RGB");
  });

  it("has resolution", async () => {
    const { metadata: m } = await extractImageContent(URLS.jpg);
    assert.ok(m.resolution !== null);
    assert.equal(m.resolution.x, 72);
    assert.equal(m.resolution.unit, "inches");
  });
});

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

describe("extractImageContent — PNG", () => {
  it("returns the expected result shape", async () => {
    assertShape(await extractImageContent(URLS.png));
  });

  it("has correct dimensions and format", async () => {
    const { metadata: m } = await extractImageContent(URLS.png);
    assert.equal(m.format, "PNG");
    assert.equal(m.width,  1223);
    assert.equal(m.height, 514);
  });

  it("has PNG-specific fields", async () => {
    const { metadata: m } = await extractImageContent(URLS.png);
    assert.equal(m.colorType, "RGB with Alpha");
    assert.equal(m.interlaced, false);
  });

  it("has no camera, dates, location, icc, or iptc", async () => {
    const { metadata: m } = await extractImageContent(URLS.png);
    assert.equal(m.camera,   null);
    assert.equal(m.dates,    null);
    assert.equal(m.location, null);
    assert.equal(m.icc,      null);
    assert.equal(m.iptc,     null);
  });
});

// ---------------------------------------------------------------------------
// TIFF
// ---------------------------------------------------------------------------

describe("extractImageContent — TIFF", () => {
  it("returns the expected result shape", async () => {
    assertShape(await extractImageContent(URLS.tif));
  });

  it("has correct dimensions and format", async () => {
    const { metadata: m } = await extractImageContent(URLS.tif);
    assert.equal(m.format, "TIFF");
    assert.equal(m.width,  1654);
    assert.equal(m.height, 2340);
  });

  it("has software from scanner", async () => {
    const { metadata: m } = await extractImageContent(URLS.tif);
    assert.equal(m.software, "WorkCentre 7120");
  });

  it("has resolution", async () => {
    const { metadata: m } = await extractImageContent(URLS.tif);
    assert.ok(m.resolution !== null);
    assert.equal(m.resolution.x, 200);
    assert.equal(m.resolution.unit, "inches");
  });
});

// ---------------------------------------------------------------------------
// BMP (manual header parsing)
// ---------------------------------------------------------------------------

describe("extractImageContent — BMP", () => {
  it("returns the expected result shape", async () => {
    assertShape(await extractImageContent(URLS.bmp));
  });

  it("has correct dimensions and format from manual parsing", async () => {
    const { metadata: m } = await extractImageContent(URLS.bmp);
    assert.equal(m.format, "BMP");
    assert.equal(m.width,  2480);
    assert.equal(m.height, 3507);
    assert.equal(m.bitDepth, 1);
  });

  it("has all optional groups as null", async () => {
    const { metadata: m } = await extractImageContent(URLS.bmp);
    assert.equal(m.camera,     null);
    assert.equal(m.dates,      null);
    assert.equal(m.location,   null);
    assert.equal(m.resolution, null);
    assert.equal(m.icc,        null);
    assert.equal(m.iptc,       null);
  });
});

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

describe("extractImageContent — GIF", () => {
  it("returns the expected result shape", async () => {
    assertShape(await extractImageContent(URLS.gif));
  });

  it("has correct dimensions and format", async () => {
    const { metadata: m } = await extractImageContent(URLS.gif);
    assert.equal(m.format, "GIF");
    assert.equal(m.width,  595);
    assert.equal(m.height, 739);
  });

  it("has GIF version", async () => {
    const { metadata: m } = await extractImageContent(URLS.gif);
    assert.equal(m.gifVersion, "GIF89a");
  });

  it("has no camera, dates, location", async () => {
    const { metadata: m } = await extractImageContent(URLS.gif);
    assert.equal(m.camera,   null);
    assert.equal(m.dates,    null);
    assert.equal(m.location, null);
  });
});

// ---------------------------------------------------------------------------
// TIFF (300 DPI scanner output)
// ---------------------------------------------------------------------------

describe("extractImageContent — TIFF (300 DPI)", () => {
  it("has correct dimensions, format, and resolution", async () => {
    const { metadata: m } = await extractImageContent(URLS.tif2);
    assert.equal(m.format, "TIFF");
    assert.equal(m.width,  2550);
    assert.equal(m.height, 4200);
    assert.equal(m.bitDepth, 1);
    assert.ok(m.resolution !== null);
    assert.equal(m.resolution.x, 300);
    assert.equal(m.resolution.y, 300);
    assert.equal(m.resolution.unit, "inches");
  });

  it("has no camera, dates, or location", async () => {
    const { metadata: m } = await extractImageContent(URLS.tif2);
    assert.equal(m.camera,   null);
    assert.equal(m.dates,    null);
    assert.equal(m.location, null);
  });
});

// ---------------------------------------------------------------------------
// HEIC
// ---------------------------------------------------------------------------

describe("extractImageContent — HEIC", () => {
  it("has correct format and dimensions", async () => {
    const { metadata: m } = await extractImageContent(URLS.heic);
    assert.equal(m.format, "HEIC");
    assert.equal(m.width,  2560);
    assert.equal(m.height, 1440);
  });

  it("has camera metadata", async () => {
    const { metadata: m } = await extractImageContent(URLS.heic);
    assert.ok(m.camera !== null);
    assert.equal(m.camera.make,  "samsung");
    assert.equal(m.camera.model, "Galaxy A15");
    assert.equal(m.camera.iso,   50);
    assert.equal(m.camera.exposureTime, "1/769");
    assert.equal(m.camera.focalLength35mm, 17);
  });

  it("has capture dates", async () => {
    const { metadata: m } = await extractImageContent(URLS.heic);
    assert.ok(m.dates !== null);
    assert.equal(m.dates.captured, "2025-08-25T17:31:33");
  });

  it("has no GPS location", async () => {
    const { metadata: m } = await extractImageContent(URLS.heic);
    assert.equal(m.location, null);
  });
});

// ---------------------------------------------------------------------------
// WebP
// ---------------------------------------------------------------------------

describe("extractImageContent — WebP", () => {
  it("has correct dimensions parsed from VP8 bitstream", async () => {
    const { metadata: m } = await extractImageContent(URLS.webp);
    assert.equal(m.format, "WebP");
    assert.equal(m.width,  1200);
    assert.equal(m.height, 1380);
  });

  it("has ICC profile", async () => {
    const { metadata: m } = await extractImageContent(URLS.webp);
    assert.ok(m.icc !== null);
    assert.equal(m.icc.colorSpace, "RGB");
  });

  it("has resolution", async () => {
    const { metadata: m } = await extractImageContent(URLS.webp);
    assert.ok(m.resolution !== null);
    assert.equal(m.resolution.x, 100);
    assert.equal(m.resolution.unit, "inches");
  });

  it("has no camera, dates, or location", async () => {
    const { metadata: m } = await extractImageContent(URLS.webp);
    assert.equal(m.camera,   null);
    assert.equal(m.dates,    null);
    assert.equal(m.location, null);
  });
});
