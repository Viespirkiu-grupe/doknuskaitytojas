import SevenZip from "7z-wasm";
import crypto from "crypto";
import path from "path";

export async function extractRarContent(url) {
  const sevenZip = await SevenZip();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const archiveBuffer = new Uint8Array(await res.arrayBuffer());
  const archiveName = "/archive.rar";

  const stream = sevenZip.FS.open(archiveName, "w+");
  sevenZip.FS.write(stream, archiveBuffer, 0, archiveBuffer.length);
  sevenZip.FS.close(stream);

  const extractDir = "/extracted";
  try {
    sevenZip.FS.mkdir(extractDir);
  } catch {}

  sevenZip.callMain(["x", archiveName, `-o${extractDir}`, "-bso0", "-bse0"]);

  function readDir(dir = extractDir) {
    return sevenZip.FS.readdir(dir)
      .filter((e) => e !== "." && e !== "..")
      .map((name) => {
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
          path: fullPath.slice(extractDir.length + 1),
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
  const files = [];
  (function flatten(nodes) {
    for (const n of nodes) {
      files.push({ ...n, children: undefined });
      if (n.children) flatten(n.children);
    }
  })(filesTree);

  return { pages: [], metadata: { files, filesTree } };
}
