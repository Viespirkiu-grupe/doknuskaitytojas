import ExifReader from "exifreader";
import { log } from "../utils/log.js";

export async function extractImageContent(input, options = {}) {
  // TODO: naudoti OCR tesktą duotą
  let start = new Date();
  //// Get the image file
  let arrayBuffer;

  // Determine if input is a Buffer or URL
  if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else if (input instanceof Uint8Array) {
    arrayBuffer = input.buffer;
  } else {
    // Assume input is a URL
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Failed to fetch ${input}: ${res.statusText}`);
    arrayBuffer = await res.arrayBuffer();
  }

  log(`1. Fetch image took ${((new Date() - start) / 1000).toFixed(3)}s`);

  //// Extract image metadata
  start = new Date();

  let tags = {};
  try {
    tags = ExifReader.load(arrayBuffer);
  } catch (e) {
    // Ignore EXIF read errors
  }

  const metadata = {
    exif: tags,
  };

  log(`2. EXIF read took ${((new Date() - start) / 1000).toFixed(3)}s`);

  metadata.width = tags["Image Width"] ? tags["Image Width"].value : null;
  if (!metadata.width) {
    metadata.width = tags["ImageWidth"] ? tags["ImageWidth"].value : null;
  }

  metadata.height = tags["Image Height"] ? tags["Image Height"].value : null;
  if (!metadata.height) {
    metadata.height = tags["ImageLength"] ? tags["ImageLength"].value : null;
  }

  if (tags["DateTime"]?.description) {
    const [datePart, timePart] = tags["DateTime"].description.split(" ");
    const [yyyy, mm, dd] = datePart.split("/"); // original is yyyy/mm/dd
    metadata.createdAt = `${yyyy}-${mm}-${dd} ${timePart}`;
  } else {
    metadata.createdAt = null;
  }
  metadata.creator = tags["Make"] ? tags["Make"].description : null;
  metadata.model = tags["Model"] ? tags["Model"].description : null;
  metadata.software = tags["Software"] ? tags["Software"].description : null;

  console.log(metadata);

  let pages = [];
  return {
    pages,
    metadata,
  };
}
