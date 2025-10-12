import { gautiViskaIsTeksto } from "../parsers/viskas.js";
import MsgReader from "@kenjiuno/msgreader";
import { deepMerge } from "../utils/mergeObject.js";

export async function extractMsgContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);

  let buffer = Buffer.from(await res.arrayBuffer());

  const msgReader = new MsgReader.default(buffer);
  const msgInfo = msgReader.getFileData();
  let text = msgInfo.body || "";

  let nuskaitymui = structuredClone(msgInfo);
  delete nuskaitymui.headers;
  delete nuskaitymui.messageId;

  let metadata = deepMerge(
    msgInfo,
    gautiViskaIsTeksto([JSON.stringify(nuskaitymui)]),
  );
  delete metadata.compressedRtf;
  metadata.from = {
    name: msgInfo.senderName || "",
    email: msgInfo.senderEmail || "",
  };
  metadata.to = (msgInfo.recipients || []).map((r) => ({
    name: r.name || "",
    email: r.email || "",
  }));
  metadata.pageCount = 1;
  metadata.characterCount = [text].reduce((acc, page) => acc + page.length, 0);
  metadata.wordCount = [text].reduce((acc, page) => {
    const words = page.trim().split(/\s+/).filter(Boolean); // remove empty strings
    return acc + words.length;
  }, 0);

  return { pages: [text], metadata };
}
