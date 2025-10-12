import SevenZip from "7z-wasm";
import crypto from "crypto";
import path from "path";

export async function extract7zContent(url) {
  const sevenZip = await SevenZip();

  // Fetch 7z archive
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const archiveBuffer = new Uint8Array(await res.arrayBuffer());
  const archiveName = "/archive.7z";

  // Write archive to WASM FS
  const stream = sevenZip.FS.open(archiveName, "w+");
  sevenZip.FS.write(stream, archiveBuffer, 0, archiveBuffer.length);
  sevenZip.FS.close(stream);

  // Create dedicated extraction folder
  const extractDir = "/extracted";
  try {
    sevenZip.FS.mkdir(extractDir);
  } catch {}

  // Extract everything silently
  sevenZip.callMain([
    "x",
    archiveName,
    `-o${extractDir}`,
    "-bso0", // disable standard output
    "-bse0", // disable error output
  ]);

  // Recursively read only /extracted
  function readDir(dir = extractDir) {
    const entries = sevenZip.FS.readdir(dir).filter(
      (e) => e !== "." && e !== "..",
    );
    return entries.map((name) => {
      const fullPath = path.posix.join(dir, name);
      const stats = sevenZip.FS.stat(fullPath);
      const isDirectory = (stats.mode & 0o40000) === 0o40000;

      let md5 = null;
      if (!isDirectory) {
        const data = sevenZip.FS.readFile(fullPath);
        md5 = crypto.createHash("md5").update(data).digest("hex");
      }

      return {
        name,
        path: fullPath.slice(extractDir.length + 1), // relative to extraction dir
        size: stats.size,
        compressedSize: null,
        extension: isDirectory
          ? null
          : path.extname(name).slice(1).toLowerCase(),
        lastModDate: new Date(stats.mtime),
        isDirectory,
        md5,
        children: isDirectory ? readDir(fullPath) : undefined,
      };
    });
  }

  const filesTree = readDir();

  // Flatten tree
  const files = [];
  function flattenTree(nodes) {
    for (const node of nodes) {
      files.push({ ...node, children: undefined }); // remove children in flat list
      if (node.children) flattenTree(node.children);
    }
  }
  flattenTree(filesTree);

  return { files, filesTree };
}
