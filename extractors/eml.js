import { gautiViskaIsTeksto } from "../parsers/viskas.js";
import { deepMerge } from "../utils/mergeObject.js";
import emlformat from "eml-format";

export async function extractEmlContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);

  let eml = await res.text();

  const msgInfo = await new Promise((resolve, reject) => {
    emlformat.read(eml, (error, data) => {
      if (error) return reject(error);
      resolve(data);
    });
  });
  let text = msgInfo.text || "";
  // Replace \r\n with \n for consistency
  text = text.replace(/\r\n/g, "\n");

  let nuskaitymui = structuredClone(msgInfo);
  delete nuskaitymui.headers;
  delete nuskaitymui.messageId;

  let metadata = deepMerge(
    msgInfo,
    gautiViskaIsTeksto([JSON.stringify(nuskaitymui)]),
  );
  metadata.pageCount = 1;
  metadata.characterCount = [text].reduce((acc, page) => acc + page.length, 0);
  metadata.wordCount = [text].reduce((acc, page) => {
    const words = page.trim().split(/\s+/).filter(Boolean); // remove empty strings
    return acc + words.length;
  }, 0);

  return { pages: [text], metadata };
}
