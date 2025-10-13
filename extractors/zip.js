import yauzl from "yauzl";
import crypto from "crypto";
import path from "path";
import iconv from "iconv-lite";

const candidateEncodings = ["utf8", "cp1257", "cp775", "latin1", "cp1252"];

const lithuanianChars = "ąčęėįšųūžĄČĘĖĮŠŲŪŽ";
const lithuanianSet = new Set(lithuanianChars.split(""));

function scoreLithuanian(str) {
  let score = 0;
  for (const ch of str) {
    if (lithuanianSet.has(ch))
      score += 3; // bonus for Lithuanian letters
    else if (/[\w ._()\-]/.test(ch)) score += 1;
    else if (ch === "�" || ch === "�") score -= 5;
    else if (/[\x00-\x1F\x7F]/.test(ch)) score -= 5;
    else score -= 1;
  }
  return score;
}

export function decodeFilename(buf, debugLabel = "") {
  let best = { encoding: null, text: null, score: -Infinity };

  for (const enc of candidateEncodings) {
    const text = iconv.decode(buf, enc);
    const score = scoreLithuanian(text);
    if (score > best.score || (score === best.score && enc === "utf8")) {
      best = { encoding: enc, text, score };
    }
  }

  return best.text;
}

export async function extractZipContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: false },
      (err, zipfile) => {
        if (err) return reject(err);

        const files = [];

        zipfile.readEntry();
        zipfile.on("entry", (entry) => {
          entry.fileName = decodeFilename(entry.fileName);
          const isDirectory = /\/$/.test(entry.fileName);
          const extension = isDirectory
            ? null
            : path.extname(entry.fileName).slice(1).toLowerCase();

          const processFile = (md5 = null) => {
            const fileMeta = {
              name: path.basename(entry.fileName),
              path: entry.fileName,
              size: entry.uncompressedSize,
              compressedSize: entry.compressedSize,
              extension,
              lastModDate: entry.getLastModDate(),
              isDirectory,
              compressionMethod: entry.compressionMethod,
              md5,
              children: isDirectory ? [] : undefined,
            };
            files.push(fileMeta);
          };

          if (isDirectory) {
            processFile();
            zipfile.readEntry();
          } else {
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) return reject(err);

              const hash = crypto.createHash("md5");
              readStream.on("data", (chunk) => hash.update(chunk));
              readStream.on("end", () => {
                processFile(hash.digest("hex"));
                zipfile.readEntry();
              });
            });
          }
        });

        zipfile.on("end", () => {
          // Build tree with full metadata on each node
          const root = [];

          for (const file of files) {
            const parts = file.path.split("/").filter(Boolean);
            let currentLevel = root;

            parts.forEach((part, i) => {
              let existing = currentLevel.find((f) => f.name === part);
              const isLast = i === parts.length - 1;

              if (!existing) {
                existing = {
                  ...(isLast
                    ? file
                    : {
                        name: part,
                        path: parts.slice(0, i + 1).join("/"),
                        size: 0,
                        compressedSize: 0,
                        extension: null,
                        lastModDate: null,
                        isDirectory: true,
                        compressionMethod: null,
                        md5: null,
                        children: [],
                      }),
                };
                currentLevel.push(existing);
              }

              currentLevel = existing.children || [];
            });
          }

          resolve({ pages: [], metadata: { files, filesTree: root } });
        });

        zipfile.on("error", reject);
      },
    );
  });
}
