import SevenZip from "7z-wasm";
import { readDir, flattenFiles } from "./wasm.js";
import { fetchSafe } from "../../utils/fetchSafe.js";

/**
 * Extract the file listing from a 7z archive.
 *
 * Uses 7z-wasm (Emscripten port) to decompress the archive entirely into an
 * in-memory WASM filesystem, then walks the result to produce a flat file list
 * and a directory tree. Compressed sizes are not available through the WASM FS
 * and are always null. No text extraction is performed; content of individual
 * files must be processed separately by their own extractors.
 *
 * @param {string} url - URL of the .7z archive to fetch
 * @returns {Promise<{
 *   pages: string[],
 *   metadata: { files: import("./wasm.js").ArchiveFile[], filesTree: import("./wasm.js").ArchiveFile[] }
 * }>}
 */
export async function extract7zContent(url) {
  const sevenZip = await SevenZip();

  const archiveBuffer = new Uint8Array(await fetchSafe(url));
  if (archiveBuffer.byteLength > 1_000_000_000)
    throw new Error(`7z archive too large: ${archiveBuffer.byteLength} bytes (limit 1 GB)`);

  const archiveName = "/archive.7z";
  const extractDir  = "/extracted";

  const stream = sevenZip.FS.open(archiveName, "w+");
  sevenZip.FS.write(stream, archiveBuffer, 0, archiveBuffer.length);
  sevenZip.FS.close(stream);

  try { sevenZip.FS.mkdir(extractDir); } catch {}

  sevenZip.callMain([
    "x", archiveName,
    `-o${extractDir}`,
    "-bso0", // suppress stdout
    "-bse0", // suppress stderr
  ]);

  const filesTree = readDir(sevenZip.FS, extractDir, extractDir);

  return {
    pages: [],
    metadata: {
      files: flattenFiles(filesTree),
      filesTree,
    },
  };
}

export const fileTypes = [
  { ext: "7z", mime: "application/x-7z-compressed" },
];

export { extract7zContent as extract };
