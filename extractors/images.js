import ExifReader from "exifreader";
import { log } from "../utils/log.js";
import { gautiViskaIsTeksto } from "../parsers/viskas.js";
import { fetchSafe } from "../utils/fetchSafe.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert an EXIF date string ("YYYY:MM:DD HH:MM:SS") to ISO 8601.
 *
 * @param {string | null | undefined} str
 * @returns {string | null}
 */
function parseExifDate(str) {
  if (!str) return null;
  const iso = str
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")
    .replace(" ", "T");
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso) ? iso : null;
}

/**
 * Detect the true image format from file magic bytes.
 *
 * ExifReader can misreport the format when a container format (e.g. HEIC)
 * embeds a JPEG preview — this function reads the actual file signature
 * instead. Returns null when the format cannot be determined.
 *
 * @param {ArrayBuffer} buffer
 * @returns {string | null}
 */
function detectFormatFromBytes(buffer) {
  if (buffer.byteLength < 12) return null;
  const b   = new Uint8Array(buffer);
  const str = (off, len) => String.fromCharCode(...b.slice(off, off + len));

  if (b[0] === 0xFF && b[1] === 0xD8)                   return "JPEG";
  if (str(0, 4) === "\x89PNG")                           return "PNG";
  if (str(0, 3) === "GIF")                               return "GIF";
  if (b[0] === 0x42 && b[1] === 0x4D)                   return "BMP";
  if (str(0, 2) === "II" || str(0, 2) === "MM")         return "TIFF";
  if (str(0, 4) === "RIFF" && str(8, 4) === "WEBP")     return "WebP";
  if (str(4, 4) === "ftyp") {
    const brand = str(8, 4);
    if (brand === "heic" || brand === "heis")            return "HEIC";
    if (brand === "mif1" || brand === "msf1")            return "HEIF";
    if (brand === "avif")                                return "AVIF";
    if (brand === "avis")                                return "AVIF";
  }
  return null;
}

/**
 * Extract canvas dimensions from a WebP file.
 *
 * Handles all three bitstream types: VP8 (lossy), VP8L (lossless),
 * and VP8X (extended). Returns null if the dimensions cannot be parsed.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ width: number, height: number } | null}
 */
function parseWebpDimensions(buffer) {
  if (buffer.byteLength < 12) return null;
  const view = new DataView(buffer);
  const str  = (off, len) => String.fromCharCode(...new Uint8Array(buffer, off, len));
  if (str(0, 4) !== "RIFF" || str(8, 4) !== "WEBP") return null;

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const id        = str(offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);

    if (id === "VP8 " && chunkSize >= 10) {
      // Lossy: sync code 9d 01 2a at bytes 3-5 of the bitstream
      if (view.getUint8(offset + 11) === 0x9d &&
          view.getUint8(offset + 12) === 0x01 &&
          view.getUint8(offset + 13) === 0x2a) {
        const w = view.getUint16(offset + 14, true) & 0x3FFF;
        const h = view.getUint16(offset + 16, true) & 0x3FFF;
        return { width: w, height: h };
      }
    } else if (id === "VP8L" && chunkSize >= 5) {
      // Lossless: signature 0x2f, then 14-bit width-1 and 14-bit height-1
      if (view.getUint8(offset + 8) === 0x2F) {
        const bits = view.getUint32(offset + 9, true);
        return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
      }
    } else if (id === "VP8X" && chunkSize >= 10) {
      // Extended: canvas width-1 and height-1 as 24-bit LE at offsets 4 and 7
      const w = (view.getUint8(offset + 12) | (view.getUint8(offset + 13) << 8) | (view.getUint8(offset + 14) << 16)) + 1;
      const h = (view.getUint8(offset + 15) | (view.getUint8(offset + 16) << 8) | (view.getUint8(offset + 17) << 16)) + 1;
      return { width: w, height: h };
    }

    offset += 8 + chunkSize + (chunkSize & 1); // chunks are word-aligned
  }
  return null;
}

/**
 * Parse a BMP file header into basic image dimensions.
 *
 * Supports BITMAPCOREHEADER (12 bytes) and BITMAPINFOHEADER (40 bytes) DIB variants.
 * Returns `null` if the buffer is not a valid BMP.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ format: string, width: number, height: number, bitDepth: number } | null}
 */
function parseBmpHeader(buffer) {
  if (buffer.byteLength < 26) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== 0x42 || view.getUint8(1) !== 0x4D) return null; // "BM"

  const dibSize = view.getUint32(14, true);
  if (dibSize < 12) return null;

  const isCoreHeader = dibSize === 12;
  const width    = isCoreHeader ? view.getUint16(18, true) : view.getInt32(18, true);
  const height   = isCoreHeader ? view.getUint16(20, true) : Math.abs(view.getInt32(22, true));
  const bitDepth = view.getUint16(isCoreHeader ? 24 : 28, true);

  return { format: "BMP", width, height, bitDepth };
}

/**
 * Pull a description string from an ExifReader tag, or null.
 *
 * @param {object | undefined} tag
 * @returns {string | null}
 */
function desc(tag) {
  return tag?.description != null ? String(tag.description).trim() || null : null;
}

/**
 * Pull a numeric value from an ExifReader tag, or null.
 *
 * @param {object | undefined} tag
 * @returns {number | null}
 */
function num(tag) {
  const v = tag?.value;
  return v != null && !Number.isNaN(Number(v)) ? Number(v) : null;
}

// ---------------------------------------------------------------------------
// Structured metadata builder
// ---------------------------------------------------------------------------

/**
 * Build a normalised metadata object from an ExifReader `expanded: true` result.
 *
 * @param {object}      tags         - ExifReader expanded tag groups
 * @param {string|null} trueFormat   - Format detected from magic bytes (overrides ExifReader)
 * @param {ArrayBuffer} buffer       - Raw image bytes (used for WebP dimension fallback)
 * @returns {ImageMetadata}
 */
function buildStructuredMetadata(tags, trueFormat, buffer) {
  const file = tags.file     ?? {};
  const exif = tags.exif     ?? {};
  const gps  = tags.gps      ?? null;
  const icc  = tags.icc      ?? {};
  const iptc = tags.iptc     ?? {};
  const png  = tags.png      ?? tags.pngFile ?? {};
  const gif  = tags.gif      ?? {};

  // --- Format ---
  // Prefer magic-byte detection; ExifReader can report "JPEG" for HEIC containers.
  const format = trueFormat ?? desc(file.FileType) ?? null;

  // --- Dimensions ---
  // WebP dimensions live in the bitstream chunks, not in EXIF tags.
  const webpDims = format === "WebP" ? parseWebpDimensions(buffer) : null;

  const width =
    webpDims?.width           ??
    num(file["Image Width"])  ??
    num(png["Image Width"])   ??
    num(gif["Image Width"])   ??
    num(exif.ImageWidth)      ??
    num(exif.PixelXDimension) ??
    null;

  const height =
    webpDims?.height          ??
    num(file["Image Height"]) ??
    num(file["ImageLength"])  ??
    num(png["Image Height"])  ??
    num(gif["Image Height"])  ??
    num(exif.ImageLength)     ??
    num(exif.PixelYDimension) ??
    null;

  const bitDepth =
    num(file["Bits Per Sample"]) ??
    num(png["Bit Depth"])        ??
    num(gif["Bits Per Pixel"])   ??
    num(exif.BitsPerSample)      ??
    null;

  // --- Camera ---
  const make  = desc(exif.Make);
  const model = desc(exif.Model);
  const camera = (make || model) ? {
    make,
    model,
    exposureTime:     desc(exif.ExposureTime),
    fNumber:          exif.FNumber?.description != null ? parseFloat(exif.FNumber.description) : null,
    iso:              num(exif.ISOSpeedRatings),
    focalLength:      exif.FocalLength?.description != null ? parseFloat(exif.FocalLength.description) : null,
    focalLength35mm:  num(exif.FocalLengthIn35mmFilm),
    flash:            desc(exif.Flash),
    whiteBalance:     desc(exif.WhiteBalance),
    exposureMode:     desc(exif.ExposureMode),
    exposureProgram:  desc(exif.ExposureProgram),
    meteringMode:     desc(exif.MeteringMode),
    sceneCaptureType: desc(exif.SceneCaptureType),
  } : null;

  // --- Dates ---
  const captured  = parseExifDate(desc(exif.DateTimeOriginal));
  const digitized = parseExifDate(desc(exif.DateTimeDigitized));
  const modified  = parseExifDate(desc(exif.DateTime));
  const dates = (captured || digitized || modified)
    ? { captured, digitized, modified }
    : null;

  // --- GPS ---
  const location = gps?.Latitude != null && gps?.Longitude != null
    ? {
        latitude:  gps.Latitude,
        longitude: gps.Longitude,
        altitude:  gps.Altitude ?? null,
      }
    : null;

  // --- Resolution ---
  const resX    = exif.XResolution?.description    != null ? parseFloat(exif.XResolution.description)    : null;
  const resY    = exif.YResolution?.description    != null ? parseFloat(exif.YResolution.description)    : null;
  const resUnit = desc(exif.ResolutionUnit);
  // PNG stores resolution as pixels-per-unit integers
  const pngResX    = num(png["Pixels Per Unit X"]);
  const pngResY    = num(png["Pixels Per Unit Y"]);
  const pngResUnit = desc(png["Pixel Units"]);
  const resolution = (resX || pngResX)
    ? { x: resX ?? pngResX, y: resY ?? pngResY, unit: resUnit ?? pngResUnit }
    : null;

  // --- ICC ---
  const iccData = Object.keys(icc).length > 0
    ? {
        description: desc(icc["ICC Description"]),
        copyright:   desc(icc["ICC Copyright"]),
        colorSpace:  desc(icc["Color Space"]),
      }
    : null;

  // --- IPTC ---
  const keywords = iptc["Keywords"]
    ? (Array.isArray(iptc["Keywords"])
        ? iptc["Keywords"].map((k) => k.description).filter(Boolean)
        : [desc(iptc["Keywords"])].filter(Boolean))
    : [];
  const iptcData = Object.keys(iptc).length > 0
    ? {
        headline:  desc(iptc["Headline"]),
        caption:   desc(iptc["Caption/Abstract"]),
        credit:    desc(iptc["Credit"]),
        byline:    desc(iptc["By-line"]),
        copyright: desc(iptc["Copyright Notice"]),
        keywords,
        city:      desc(iptc["City"]),
        country:   desc(iptc["Country/Primary Location Name"]),
      }
    : null;

  // --- Misc ---
  const orientation = num(exif.Orientation);
  const software    = desc(exif.Software);
  const colorSpace  = desc(exif.ColorSpace);

  // PNG-specific
  const colorType = desc(png["Color Type"]);
  const interlaced = png["Interlace"]
    ? desc(png["Interlace"]) !== "Noninterlaced"
    : null;

  // GIF-specific — ExifReader returns "89a", prefix to get "GIF89a"
  const gifVersionRaw = desc(gif["GIF Version"]);
  const gifVersion    = gifVersionRaw
    ? (gifVersionRaw.startsWith("GIF") ? gifVersionRaw : `GIF${gifVersionRaw}`)
    : null;

  return {
    format,
    width,
    height,
    bitDepth,
    orientation,
    software,
    colorSpace,
    ...(colorType  != null && { colorType }),
    ...(interlaced != null && { interlaced }),
    ...(gifVersion != null && { gifVersion }),
    camera,
    dates,
    location,
    resolution,
    icc: iccData,
    iptc: iptcData,
  };
}

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ImageMetadata
 * @property {string | null}  format           - Image format (JPEG, PNG, TIFF, GIF, WebP, HEIC, BMP, …)
 * @property {number | null}  width            - Image width in pixels
 * @property {number | null}  height           - Image height in pixels
 * @property {number | null}  bitDepth         - Bits per sample/channel
 * @property {number | null}  [orientation]    - EXIF orientation value (1–8)
 * @property {string | null}  [software]       - Software tag from EXIF
 * @property {string | null}  [colorSpace]     - Color space (e.g. "sRGB")
 * @property {string | null}  [colorType]      - PNG color type description
 * @property {boolean | null} [interlaced]     - PNG interlacing
 * @property {string | null}  [gifVersion]     - GIF version string ("GIF89a")
 * @property {boolean | null} [gifAnimated]    - True when GIF contains multiple frames
 * @property {{ make, model, exposureTime, fNumber, iso, focalLength, focalLength35mm, flash, whiteBalance, exposureMode, exposureProgram, meteringMode, sceneCaptureType } | null} camera
 * @property {{ captured, digitized, modified } | null} dates
 * @property {{ latitude, longitude, altitude } | null} location
 * @property {{ x, y, unit } | null} resolution
 * @property {{ description, copyright, colorSpace } | null} icc
 * @property {{ headline, caption, credit, byline, copyright, keywords, city, country } | null} iptc
 */

/**
 * Extract structured metadata from an image file.
 *
 * Supports JPEG, PNG, TIFF, GIF, WebP, HEIC/HEIF, AVIF, and BMP. EXIF, GPS,
 * ICC, and IPTC data are extracted when present and normalised into a flat,
 * consistently-typed metadata object. BMP is parsed via a manual header reader
 * since ExifReader does not support that format.
 *
 * When `options.puslapiai` is provided (e.g. OCR output), the text is run
 * through the standard parser pipeline and merged into the result.
 *
 * @param {string | ArrayBuffer | Uint8Array} input - URL to fetch, or raw image bytes
 * @param {{ puslapiai?: string[] }} [options]
 * @returns {Promise<{ pages: string[], metadata: ImageMetadata & import("../parsers/viskas.js") }>}
 */
export async function extractImageContent(input, options = {}) {
  let start = new Date();
  let arrayBuffer;

  if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else if (input instanceof Uint8Array) {
    arrayBuffer = input.buffer;
  } else {
    arrayBuffer = await fetchSafe(input);
  }
  log(`1. Fetch image took ${((new Date() - start) / 1000).toFixed(3)}s`);

  start = new Date();
  const trueFormat = detectFormatFromBytes(arrayBuffer);
  let imageMetadata;
  try {
    const tags = ExifReader.load(arrayBuffer, { expanded: true });
    imageMetadata = buildStructuredMetadata(tags, trueFormat, arrayBuffer);
  } catch {
    // ExifReader does not support BMP — fall back to manual header parsing
    const bmp = parseBmpHeader(arrayBuffer);
    if (!bmp) throw new Error("Unsupported or invalid image format");
    imageMetadata = {
      format: bmp.format,
      width:  bmp.width,
      height: bmp.height,
      bitDepth: bmp.bitDepth,
      orientation: null,
      software:    null,
      colorSpace:  null,
      camera:      null,
      dates:       null,
      location:    null,
      resolution:  null,
      icc:         null,
      iptc:        null,
    };
  }
  log(`2. Metadata read took ${((new Date() - start) / 1000).toFixed(3)}s`);

  const pages       = Array.isArray(options.puslapiai) ? options.puslapiai : [];
  const parsedFields = gautiViskaIsTeksto(pages);

  return {
    pages,
    metadata: { ...imageMetadata, ...parsedFields },
  };
}

export const fileTypes = [
  { ext: "jpg",  mime: "image/jpeg" },
  { ext: "jpeg", mime: "image/jpeg", normalizedAs: "jpg" },
  { ext: "jfif", mime: "image/jpeg", normalizedAs: "jpg" },
  { ext: "png",  mime: "image/png" },
  { ext: "gif",  mime: "image/gif" },
  { ext: "tif",  mime: "image/tiff" },
  { ext: "tiff", mime: "image/tiff", normalizedAs: "tif" },
  { ext: "bmp",  mime: "image/bmp" },
  { ext: "webp", mime: "image/webp" },
  { ext: "heic", mime: "image/heic" },
  { ext: "heif", mime: "image/heif" },
  { ext: "avif", mime: "image/avif" },
];

export { extractImageContent as extract };
