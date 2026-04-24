import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractMediaContent } from "../extractors/media.js";

const URLS = {
  mp4: "https://failai.viespirkiai.org/22746852",
};

// ---------------------------------------------------------------------------
// Shared shape assertions
// ---------------------------------------------------------------------------

function assertShape(result) {
  assert.ok(Array.isArray(result.pages));
  const m = result.metadata;
  assert.ok(m);
  assert.ok(m.format);
  assert.ok(Array.isArray(m.streams));
  // parsed fields always present
  assert.ok(Array.isArray(m.companyIds));
  assert.ok(Array.isArray(m.ibans));
  assert.ok(Array.isArray(m.phones));
  assert.ok(Array.isArray(m.links));
  assert.ok(Array.isArray(m.emails));
  assert.ok(Array.isArray(m.ipAddresses));
  assert.ok(Array.isArray(m.macAddresses));
}

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

describe("extractMediaContent — MP4", () => {
  it("returns the expected result shape", async () => {
    assertShape(await extractMediaContent(URLS.mp4));
  });

  it("has correct format info", async () => {
    const { metadata: m } = await extractMediaContent(URLS.mp4);
    assert.ok(m.format.name.includes("mp4"));
    assert.equal(m.format.longName, "QuickTime / MOV");
    assert.ok(Math.abs(m.format.durationSec - 9.4) < 0.1);
    assert.equal(m.format.sizeBytes, 2148061);
    assert.ok(Math.abs(m.format.bitrateKbps - 1830) < 10);
    assert.equal(m.format.streamCount, 2);
  });

  it("has container tags", async () => {
    const { metadata: m } = await extractMediaContent(URLS.mp4);
    assert.ok(m.tags !== null);
    assert.equal(m.tags.major_brand, "mp42");
  });

  it("has a video stream", async () => {
    const { metadata: m } = await extractMediaContent(URLS.mp4);
    assert.ok(m.videoStream !== null);
    assert.equal(m.videoStream.type,       "video");
    assert.equal(m.videoStream.codec,      "h264");
    assert.equal(m.videoStream.profile,    "High");
    assert.equal(m.videoStream.width,      1280);
    assert.equal(m.videoStream.height,     720);
    assert.equal(m.videoStream.fps,        30);
    assert.equal(m.videoStream.pixelFormat, "yuv420p");
    assert.equal(m.videoStream.rotation,   -180);
    assert.equal(m.videoStream.bitrateKbps, 1771);
  });

  it("has an audio stream", async () => {
    const { metadata: m } = await extractMediaContent(URLS.mp4);
    assert.ok(m.audioStream !== null);
    assert.equal(m.audioStream.type,          "audio");
    assert.equal(m.audioStream.codec,         "aac");
    assert.equal(m.audioStream.profile,       "LC");
    assert.equal(m.audioStream.sampleRate,    44100);
    assert.equal(m.audioStream.channels,      2);
    assert.equal(m.audioStream.channelLayout, "stereo");
    assert.equal(m.audioStream.sampleFormat,  "fltp");
    assert.equal(m.audioStream.bitrateKbps,   65);
  });

  it("streams array contains both streams in order", async () => {
    const { metadata: m } = await extractMediaContent(URLS.mp4);
    assert.equal(m.streams.length, 2);
    assert.equal(m.streams[0].type, "video");
    assert.equal(m.streams[1].type, "audio");
  });
});
