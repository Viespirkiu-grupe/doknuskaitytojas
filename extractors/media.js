import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import path from "path";
import { log } from "../utils/log.js";
import { gautiViskaIsTeksto } from "../parsers/viskas.js";

const execFileAsync = promisify(execFile);
const TMP_DIR = path.resolve("./tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run ffprobe on a file and return the parsed JSON output.
 *
 * @param {string} filePath
 * @returns {Promise<object>}
 */
async function runFfprobe(filePath) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "quiet",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  return JSON.parse(stdout);
}

/**
 * Format a rational string ("num/den") as a decimal, or return null.
 *
 * @param {string | null | undefined} rational
 * @returns {number | null}
 */
function parseRational(rational) {
  if (!rational) return null;
  const [num, den] = rational.split("/").map(Number);
  if (!den || den === 0) return num ?? null;
  const result = num / den;
  return Number.isFinite(result) ? Math.round(result * 1000) / 1000 : null;
}

/**
 * Round a float to a reasonable number of decimal places, or return null.
 *
 * @param {string | number | null | undefined} val
 * @param {number} decimals
 * @returns {number | null}
 */
function toFloat(val, decimals = 3) {
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

/**
 * Convert an integer-or-string bit rate to kilobits per second, or null.
 *
 * @param {string | number | null | undefined} val
 * @returns {number | null}
 */
function toBitrateKbps(val) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n / 1000);
}

/**
 * Build a structured stream descriptor from a raw ffprobe stream object.
 *
 * @param {object} s  - Raw ffprobe stream
 * @returns {object}
 */
function buildStream(s) {
  const base = {
    index: s.index ?? null,
    type: s.codec_type ?? null,
    codec: s.codec_name ?? null,
    codecLong: s.codec_long_name ?? null,
    profile: s.profile ?? null,
    bitrateKbps: toBitrateKbps(s.bit_rate),
    language: s.tags?.language ?? null,
    title: s.tags?.title ?? null,
  };

  if (s.codec_type === "video") {
    const [fpsNum, fpsDen] = (s.r_frame_rate ?? "").split("/").map(Number);
    const fps =
      fpsNum && fpsDen
        ? Math.round((fpsNum / fpsDen) * 1000) / 1000
        : null;
    return {
      ...base,
      width: s.width ?? null,
      height: s.height ?? null,
      pixelFormat: s.pix_fmt ?? null,
      aspectRatio: s.display_aspect_ratio ?? null,
      fps,
      rotation: toFloat(s.tags?.rotate) ?? toFloat(s.side_data_list?.[0]?.rotation) ?? null,
    };
  }

  if (s.codec_type === "audio") {
    return {
      ...base,
      sampleRate: s.sample_rate ? parseInt(s.sample_rate, 10) : null,
      channels: s.channels ?? null,
      channelLayout: s.channel_layout ?? null,
      sampleFormat: s.sample_fmt ?? null,
    };
  }

  return base;
}

/**
 * Build the structured metadata object from raw ffprobe output.
 *
 * @param {object} probe  - Parsed ffprobe JSON (has .format and .streams[])
 * @returns {object}
 */
function buildMetadata(probe) {
  const fmt = probe.format ?? {};

  const format = {
    name: fmt.format_name ?? null,
    longName: fmt.format_long_name ?? null,
    durationSec: toFloat(fmt.duration),
    sizeBytes: fmt.size ? parseInt(fmt.size, 10) : null,
    bitrateKbps: toBitrateKbps(fmt.bit_rate),
    streamCount: fmt.nb_streams ?? null,
  };

  const rawTags = fmt.tags ?? {};
  const tags = Object.keys(rawTags).length
    ? Object.fromEntries(
        Object.entries(rawTags).map(([k, v]) => [k.toLowerCase(), v])
      )
    : null;

  const streams = (probe.streams ?? []).map(buildStream);
  const videoStream = streams.find((s) => s.type === "video") ?? null;
  const audioStream = streams.find((s) => s.type === "audio") ?? null;

  return { format, streams, videoStream, audioStream, tags };
}

// ---------------------------------------------------------------------------
// Public extractor
// ---------------------------------------------------------------------------

/**
 * Extract structured media metadata from a video or audio file URL using
 * the system `ffprobe` binary.
 *
 * @param {string} url
 * @returns {Promise<{ pages: string[], metadata: object }>}
 */
export async function extractMediaContent(url) {
  const tmpFile = path.join(TMP_DIR, `${randomUUID()}.media`);
  try {
    log(url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(tmpFile, buf);

    const probe = await runFfprobe(tmpFile);
    const metadata = buildMetadata(probe);

    const parsedFields = gautiViskaIsTeksto([]);
    return {
      pages: [],
      metadata: { ...metadata, ...parsedFields },
    };
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
}

export const fileTypes = [
  { ext: "mp4",  mime: "video/mp4" },
  { ext: "mov",  mime: "video/quicktime" },
  { ext: "avi",  mime: "video/x-msvideo" },
  { ext: "mkv",  mime: "video/x-matroska" },
  { ext: "webm", mime: "video/webm" },
  { ext: "3gp",  mime: "video/3gpp" },
  { ext: "mp3",  mime: "audio/mpeg" },
  { ext: "wav",  mime: "audio/wav" },
  { ext: "flac", mime: "audio/flac" },
  { ext: "aac",  mime: "audio/aac" },
  { ext: "ogg",  mime: "audio/ogg" },
  { ext: "opus", mime: "audio/opus" },
  { ext: "wma",  mime: "audio/x-ms-wma" },
  { ext: "m4a",  mime: "audio/mp4" },
];

export { extractMediaContent as extract };
