import { gautiViskaIsTeksto } from "../parsers/viskas.js";

export async function extractTxtContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);

  let text = await res.text();

  // Replace \r\n with \n for consistency
  text = text.replace(/\r\n/g, "\n");

  let metadata = gautiViskaIsTeksto([text]);

  return { pages: [text], metadata };
}
