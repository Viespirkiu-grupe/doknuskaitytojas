import yauzl from "yauzl";
import crypto from "crypto";
import path from "path";
import { detectEncoding } from "../../utils/detectEncoding.js";
import { fetchSafe } from "../../utils/fetchSafe.js";
import { log } from "../../utils/log.js";

/**
 * @typedef {Object} ArchiveFile
 * @property {string}       name              - Filename (basename only), decoded via Lithuanian-aware encoding detection
 * @property {string}       path              - Path relative to the archive root
 * @property {number}       size              - Uncompressed size in bytes
 * @property {number}       compressedSize    - Compressed size in bytes
 * @property {string|null}  extension         - Lowercase file extension, or null for directories
 * @property {Date}         lastModDate       - Last modification time from the ZIP local file header
 * @property {boolean}      isDirectory       - True if this entry is a directory
 * @property {number}       compressionMethod - ZIP compression method code (0 = stored, 8 = deflate)
 * @property {string|null}  md5               - MD5 of uncompressed content, or null for directories
 * @property {ArchiveFile[]} [children]       - Present only in the tree representation
 */

/**
 * Build a directory tree from a flat list of {@link ArchiveFile} entries.
 *
 * Path segments of each entry are split on `/` and walked to find or create
 * the correct node at each level. Leaf nodes carry the full file metadata.
 *
 * @param {ArchiveFile[]} files
 * @returns {ArchiveFile[]}
 */
function buildTree(files) {
  const root = [];
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let level = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let node = level.find((n) => n.name === part);
      if (!node) {
        node = isLast
          ? { ...file }
          : { name: part, isDirectory: true, children: [] };
        level.push(node);
      }
      level = node.children ?? [];
    });
  }
  return root;
}

/**
 * Extract the file listing from a ZIP archive.
 *
 * Filenames are decoded from raw bytes using Lithuanian-aware encoding
 * detection (yauzl is invoked with `decodeStrings: false` to get the raw
 * Buffer). An MD5 hash of each file's uncompressed content is computed by
 * streaming the entry through yauzl's decompressor.
 *
 * @param {string} url - URL of the .zip archive to fetch
 * @returns {Promise<{
 *   pages: string[],
 *   metadata: { files: ArchiveFile[], filesTree: ArchiveFile[] }
 * }>}
 */
const MAX_ENTRY_BYTES = 1_000_000_000; // 1 GB per entry
const MAX_TOTAL_BYTES = 2_000_000_000; // 2 GB cumulative uncompressed

export async function extractZipContent(url) {
  const buffer = Buffer.from(await fetchSafe(url));

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: false },
      (err, zipfile) => {
        if (err) return reject(err);

        const files = [];
        let totalUncompressed = 0;

        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          const fileName   = detectEncoding(entry.fileName).text;
          const isDirectory = /\/$/.test(fileName);
          const extension   = isDirectory
            ? null
            : path.extname(fileName).slice(1).toLowerCase();

          if (!isDirectory) {
            if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
              log(`ZIP: skipping oversized entry ${fileName} (${entry.uncompressedSize} bytes)`);
              zipfile.readEntry();
              return;
            }
            totalUncompressed += entry.uncompressedSize;
            if (totalUncompressed > MAX_TOTAL_BYTES) {
              zipfile.close();
              return reject(new Error(`ZIP total uncompressed size exceeds ${MAX_TOTAL_BYTES} bytes`));
            }
          }

          const pushEntry = (md5 = null) => {
            files.push({
              name: path.basename(fileName),
              path: fileName,
              size: entry.uncompressedSize,
              compressedSize: entry.compressedSize,
              extension,
              lastModDate: entry.getLastModDate(),
              isDirectory,
              compressionMethod: entry.compressionMethod,
              md5,
              children: isDirectory ? [] : undefined,
            });
          };

          if (isDirectory) {
            pushEntry();
            zipfile.readEntry();
          } else {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) return reject(err);
              const hash = crypto.createHash("md5");
              readStream.on("data", (chunk) => hash.update(chunk));
              readStream.on("end", () => {
                pushEntry(hash.digest("hex"));
                zipfile.readEntry();
              });
            });
          }
        });

        zipfile.on("end", () => {
          const filesTree = buildTree(files);
          const flatFiles = files
            .filter((f) => !f.isDirectory)
            .map(({ children, ...rest }) => rest);

          resolve({ pages: [], metadata: { files: flatFiles, filesTree } });
        });

        zipfile.on("error", reject);
      },
    );
  });
}

export const fileTypes = [
  { ext: "zip", mime: "application/zip" },
];

export { extractZipContent as extract };
