import CFB from "cfb";
import { log } from "../utils/log.js";
import { fetchSafe } from "../utils/fetchSafe.js";

/**
 * @typedef {Object} ThumbsdbFile
 * @property {string}      hash          - 64-bit FNV hash of the original file path (hex, 16 chars)
 * @property {number}      thumbnailSize - Max dimension of the cached thumbnail in pixels
 * @property {number|null} width         - Actual JPEG width in pixels
 * @property {number|null} height        - Actual JPEG height in pixels
 * @property {number}      jpegSize      - Size of the JPEG thumbnail data in bytes
 * @property {Date|null}   lastModDate   - Modification time of the original file
 */

/**
 * Parse JPEG dimensions from the first SOF0–SOF3 marker in a JPEG buffer.
 *
 * @param {Buffer} buf - Raw JPEG data starting with FF D8
 * @returns {{ width: number, height: number } | null}
 */
function jpegDimensions(buf) {
  let i = 2; // skip FF D8
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const segLen = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + segLen;
  }
  return null;
}

/**
 * Extract thumbnail metadata from a Windows Thumbs.db file (Vista+ format).
 *
 * The file is an OLE Compound File Binary container. Each thumbnail is stored
 * as a stream named "{maxDim}_{hash64}" (e.g. "256_269932e798296a23"), where
 * the hash is a 64-bit FNV hash of the original file's uppercase path. There
 * is no Catalog stream in this format, so original filenames are not recoverable.
 *
 * Stream header layout (24 bytes):
 *   0–3   header size (always 24)
 *   4–7   version (always 3)
 *   8–11  JPEG data size
 *   12–15 unknown constant
 *   16–19 Unix timestamp (seconds since 1970) of the original file
 *   20–23 unknown
 *   24+   JPEG data
 *
 * @param {string} url - URL of the Thumbs.db file to fetch
 * @returns {Promise<{ pages: string[], metadata: { files: ThumbsdbFile[] } }>}
 */
export async function extractThumbsdbContent(url) {
  const buffer = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));

  const t = Date.now();
  const workbook = CFB.read(buffer, { type: "buffer" });
  const files = [];

  for (const entry of workbook.FileIndex) {
    if (entry.type !== 2 || !entry.name) continue;

    const match = entry.name.match(/^(\d+)_([0-9a-f]+)$/i);
    if (!match) continue;

    const content = Buffer.from(entry.content);
    if (content.length < 24) continue;

    const headerSize = content.readUInt32LE(0);
    const unixTs = content.readUInt32LE(16);
    const jpeg = content.subarray(headerSize);
    const dims = jpegDimensions(jpeg);

    files.push({
      hash: match[2],
      thumbnailSize: parseInt(match[1], 10),
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      jpegSize: jpeg.length,
      lastModDate: unixTs > 0 ? new Date(unixTs * 1000) : null,
    });
  }

  log(`Parsing: ${((Date.now() - t) / 1000).toFixed(2)}s`);
  return { pages: [], metadata: { files } };
}

export const fileTypes = [
  { ext: "db", mime: "application/octet-stream" },
];

export { extractThumbsdbContent as extract };
