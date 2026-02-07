import ExifReader from "exifreader";
import { log } from "../utils/log.js";
import { gautiViskaIsTeksto } from "../parsers/viskas.js";

export async function extractImageContent(input, options = {}) {
  let start = new Date();
  let arrayBuffer;

  // Determine if input is a Buffer/ArrayBuffer or URL
  if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else if (input instanceof Uint8Array) {
    arrayBuffer = input.buffer;
  } else {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch ${input}: ${res.statusText}`);
    arrayBuffer = await res.arrayBuffer();
  }

  log(`1. Fetch image took ${((new Date() - start) / 1000).toFixed(3)}s`);

  //// Extract EXIF metadata
  start = new Date();
  let tags = {};
  try {
    tags = ExifReader.load(arrayBuffer);
  } catch (e) {
    log(`Failed to read EXIF: ${e.message}`);
  }

  const exifMetadata = {
    exif: tags,
    width: tags["Image Width"]?.value ?? tags["ImageWidth"]?.value ?? null,
    height: tags["Image Height"]?.value ?? tags["ImageLength"]?.value ?? null,
    createdAt: tags["DateTime"]?.description
      ? tags["DateTime"].description.replace(/\//g, "-")
      : null,
    creator: tags["Make"]?.description ?? null,
    model: tags["Model"]?.description ?? null,
    software: tags["Software"]?.description ?? null,
  };

  log(`2. EXIF read took ${((new Date() - start) / 1000).toFixed(3)}s`);

  //// Use pre-given text if provided
  const pages = Array.isArray(options.puslapiai) ? options.puslapiai : [];

  //// Derive text-based metadata
  const textMetadata = gautiViskaIsTeksto(pages);

  //// Merge EXIF + text metadata
  const metadata = {
    ...exifMetadata,
    ...textMetadata,
    pageCount: pages.length,
    characterCount: pages.reduce((acc, page) => acc + page.length, 0),
    wordCount: pages.reduce(
      (acc, page) => acc + page.trim().split(/\s+/).filter(Boolean).length,
      0,
    ),
  };

  return {
    pages,
    metadata,
  };
}
