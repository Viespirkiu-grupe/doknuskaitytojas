import crypto from "crypto";
import path from "path";

/**
 * @typedef {Object} ArchiveFile
 * @property {string}       name           - Filename (basename only)
 * @property {string}       path           - Path relative to the archive root
 * @property {number}       size           - Uncompressed size in bytes
 * @property {null}         compressedSize - Not available from the WASM FS; always null
 * @property {string|null}  extension      - Lowercase file extension, or null for directories
 * @property {Date}         lastModDate    - Last modification time
 * @property {boolean}      isDirectory    - True if this entry is a directory
 * @property {string|null}  md5            - MD5 of uncompressed content, or null for directories
 * @property {ArchiveFile[]} [children]    - Present only in the tree representation
 */

/**
 * Recursively read a directory from the 7z-wasm in-memory filesystem into a
 * tree of {@link ArchiveFile} nodes.
 *
 * @param {object} fs         - The Emscripten FS object from 7z-wasm
 * @param {string} dir        - Absolute path within the WASM FS to read
 * @param {string} extractDir - Root extraction path, used to compute relative paths
 * @returns {ArchiveFile[]}
 */
export function readDir(fs, dir, extractDir) {
  return fs
    .readdir(dir)
    .filter((e) => e !== "." && e !== "..")
    .map((name) => {
      const fullPath    = path.posix.join(dir, name);
      const stats       = fs.stat(fullPath);
      const isDirectory = (stats.mode & 0o40000) === 0o40000;

      const md5 = isDirectory
        ? null
        : crypto.createHash("md5").update(fs.readFile(fullPath)).digest("hex");

      return {
        name,
        path: fullPath.slice(extractDir.length + 1),
        size: stats.size,
        compressedSize: null,
        extension: isDirectory ? null : path.extname(name).slice(1).toLowerCase(),
        lastModDate: new Date(stats.mtime),
        isDirectory,
        md5,
        children: isDirectory ? readDir(fs, fullPath, extractDir) : undefined,
      };
    });
}

/**
 * Flatten a tree of {@link ArchiveFile} nodes into a list, omitting directories.
 *
 * @param {ArchiveFile[]} nodes
 * @returns {ArchiveFile[]}
 */
export function flattenFiles(nodes) {
  const result = [];
  for (const node of nodes) {
    if (!node.isDirectory) result.push({ ...node, children: undefined });
    if (node.children) result.push(...flattenFiles(node.children));
  }
  return result;
}
