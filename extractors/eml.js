import { gautiViskaIsTeksto } from "../parsers/viskas.js";
import { deepMerge } from "../utils/mergeObject.js";
import emlformat from "eml-format";
import { parseHTML } from "linkedom";
import { decodeRfc2047 } from "../utils/decodeRfc2047.js";

/**
 * @typedef {{ name?: string, email: string }} EmailAddress
 */

/**
 * @typedef {Object} EmlAttachment
 * @property {string}  name        - Decoded filename of the attachment
 * @property {string}  contentType - MIME content type
 * @property {boolean} [inline]    - True if Content-Disposition is inline
 */

/**
 * @typedef {Object} EmlSections
 * @property {string} [plain] - Plain-text body (text/plain part), normalised to LF
 * @property {string} [html]  - HTML body (text/html part), as received
 */


/**
 * Extract plain text from an HTML string using linkedom.
 *
 * @param {string} html
 * @returns {string}
 */
function extractTextFromHtml(html) {
  const { document } = parseHTML(html);
  return (document.body?.textContent ?? "").replace(/\r\n/g, "\n").trim();
}

/**
 * Return whichever text has more non-whitespace content.
 *
 * @param {string} plain
 * @param {string} fromHtml
 * @returns {string}
 */
function pickBetterText(plain, fromHtml) {
  const count = (s) => s.replace(/\s/g, "").length;
  return count(fromHtml) > count(plain) ? fromHtml : plain;
}

/**
 * Format an {@link EmailAddress} as a display string.
 *
 * @param {EmailAddress | EmailAddress[] | undefined} addr
 * @returns {string}
 */
function formatAddress(addr) {
  if (!addr) return "";
  if (Array.isArray(addr)) return addr.map(formatAddress).join(", ");
  return [addr.name, addr.email && `<${addr.email}>`].filter(Boolean).join(" ");
}

/**
 * Extract content and metadata from an EML (RFC 822) email file.
 *
 * The plain-text and HTML body parts are moved into `metadata.sections`.
 * Text is extracted from both parts; whichever contains more content is used
 * as the document body. `metadata.text` is the full indexed string: subject,
 * sender, recipient, and body — ready for full-text search.
 *
 * Parsed fields (companyIds, emails, phones, etc.) are extracted by scanning
 * the full serialised message object, so structured fields like `from`, `to`,
 * and `subject` are included in the scan, not just the body.
 *
 * Attachment binary data (`data`, `content`) is stripped; filenames are decoded
 * from RFC 2047 encoded words.
 *
 * @param {string} url - URL of the .eml file to fetch
 * @returns {Promise<{
 *   pages: string[],
 *   metadata: {
 *     subject: string,
 *     date: Date,
 *     from: EmailAddress,
 *     to: EmailAddress | EmailAddress[],
 *     headers: Record<string, string | string[]>,
 *     attachments: EmlAttachment[],
 *     sections: EmlSections,
 *     text: string,
 *     pageCount: number,
 *     characterCount: number,
 *     wordCount: number,
 *   }
 * }>}
 */
export async function extractEmlContent(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.statusText}`);

  const eml = await res.text();
  if (eml.trim() === "") throw new Error("Empty EML content");

  const msgInfo = await new Promise((resolve, reject) => {
    emlformat.read(eml, (error, data) => {
      if (error) return reject(error);
      resolve(data);
    });
  });

  // Move body parts into sections before they get merged into metadata
  const sections = {};
  if (msgInfo.text) sections.plain = msgInfo.text.replace(/\r\n/g, "\n");
  if (msgInfo.html)  sections.html  = msgInfo.html;
  delete msgInfo.text;
  delete msgInfo.html;

  // Strip binary data and decode RFC 2047 encoded filenames
  for (const att of msgInfo.attachments ?? []) {
    delete att.data;
    delete att.content;
    if (att.name) att.name = decodeRfc2047(att.name);
  }

  // Pick the richer body text
  const plainText = sections.plain ?? "";
  const htmlText  = sections.html ? extractTextFromHtml(sections.html) : "";
  const bodyText  = pickBetterText(plainText, htmlText);

  // Run the parser over the serialised message (excluding noisy fields) so
  // that emails, phone numbers, etc. are found across all structured fields.
  const forParsing = structuredClone(msgInfo);
  delete forParsing.headers;
  delete forParsing.messageId;

  const metadata = deepMerge(
    msgInfo,
    gautiViskaIsTeksto([JSON.stringify(forParsing)]),
  );

  // Assemble indexed text: subject → from → to → body
  metadata.text = [
    msgInfo.subject             && `Subject: ${msgInfo.subject}`,
    msgInfo.from                && `From: ${formatAddress(msgInfo.from)}`,
    msgInfo.to                  && `To: ${formatAddress(msgInfo.to)}`,
    bodyText,
  ].filter(Boolean).join("\n");

  metadata.sections       = sections;
  metadata.pageCount      = 1;
  metadata.characterCount = bodyText.length;
  metadata.wordCount      = bodyText.trim().split(/\s+/).filter(Boolean).length;

  return { pages: [bodyText], metadata };
}

export const fileTypes = [
  { ext: "eml", mime: "message/rfc822" },
];

export { extractEmlContent as extract };
