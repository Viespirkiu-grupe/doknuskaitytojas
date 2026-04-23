import { gautiViskaIsTeksto } from "../parsers/viskas.js";
import { detectEncoding }    from "../utils/detectEncoding.js";
import { fetchSafe } from "../utils/fetchSafe.js";

/**
 * Extract text and metadata from a plain-text file.
 *
 * The file is fetched as raw bytes and decoded using Lithuanian-aware encoding
 * detection ({@link detectEncoding}). The detected charset is stored in
 * `metadata.encoding` so callers can see which code page was chosen.
 *
 * `metadata.text` is the full decoded body, ready for full-text search.
 *
 * @param {string} url - URL of the .txt file to fetch
 * @returns {Promise<{
 *   pages: string[],
 *   metadata: {
 *     encoding: string,
 *     text: string,
 *     pageCount: number,
 *     characterCount: number,
 *     wordCount: number,
 *   }
 * }>}
 */
export async function extractTxtContent(url) {
  const buf = Buffer.isBuffer(url) ? url : Buffer.from(await fetchSafe(url));
  const { encoding, text: rawText } = detectEncoding(buf);

  const text = rawText.replace(/\r\n/g, "\n");

  const parsedFields = gautiViskaIsTeksto([text]);

  const metadata = {
    encoding,
    ...parsedFields,
    text,
    pageCount:      1,
    characterCount: text.length,
    wordCount:      text.trim().split(/\s+/).filter(Boolean).length,
  };

  return { pages: [text], metadata };
}

export const fileTypes = [
  { ext: "txt", mime: "text/plain" },
  { ext: "url", mime: "text/plain", normalizedAs: "txt" },
];

export { extractTxtContent as extract };
