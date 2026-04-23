import { gautiViskaIsTeksto } from "../parsers/viskas.js";
import MsgReader from "@kenjiuno/msgreader";
import { parseHTML } from "linkedom";
import { parseHeaders } from "../utils/parseHeaders.js";
import { fetchSafe } from "../utils/fetchSafe.js";

/**
 * @typedef {{ name: string, email: string }} EmailAddress
 */

/**
 * @typedef {Object} MsgAttachment
 * @property {string}      name        - Filename
 * @property {string|null} contentType - MIME type (attachMimeTag), or null if absent
 * @property {number|null} size        - Uncompressed size in bytes, or null if absent
 */

/**
 * @typedef {Object} MsgSections
 * @property {string} [plain] - Plain-text body, normalised to LF
 * @property {string} [html]  - HTML body, as stored in the MSG file
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
 * Format an {@link EmailAddress} or array thereof as a display string.
 *
 * @param {EmailAddress | EmailAddress[]} addr
 * @returns {string}
 */
function formatAddress(addr) {
  if (Array.isArray(addr)) return addr.map(formatAddress).join(", ");
  return [addr.name, addr.email && `<${addr.email}>`].filter(Boolean).join(" ");
}

/**
 * Extract content and metadata from an Outlook MSG file.
 *
 * Uses `@kenjiuno/msgreader` to parse the OLE Compound File. Internal
 * msgreader fields (senderName, senderEmail, recipients, compressedRtf, etc.)
 * are normalised into a clean structure matching the EML extractor's output
 * shape where possible.
 *
 * Plain-text and HTML body parts are moved into `metadata.sections`.
 * `metadata.text` is the full indexed string: subject, sender, recipients,
 * and the richer of the two body texts — ready for full-text search.
 *
 * @param {string} url - URL of the .msg file to fetch
 * @returns {Promise<{
 *   pages: string[],
 *   metadata: {
 *     subject: string,
 *     from: EmailAddress,
 *     to: EmailAddress[],
 *     headers: string,
 *     attachments: MsgAttachment[],
 *     sections: MsgSections,
 *     creationTime: string,
 *     lastModificationTime: string,
 *     clientSubmitTime: string,
 *     messageDeliveryTime: string,
 *     text: string,
 *     pageCount: number,
 *     characterCount: number,
 *     wordCount: number,
 *   }
 * }>}
 */
export async function extractMsgContent(url) {
  const buffer = Buffer.from(await fetchSafe(url));

  const msgInfo = new MsgReader.default(buffer).getFileData();

  // Build sections from body parts
  const sections = {};
  if (msgInfo.body)     sections.plain = msgInfo.body.replace(/\r\n/g, "\n");
  if (msgInfo.bodyHtml) sections.html  = msgInfo.bodyHtml;

  // Normalise sender and recipients
  const from = { name: msgInfo.senderName ?? "", email: msgInfo.senderEmail ?? "" };
  const to   = (msgInfo.recipients ?? []).map((r) => ({ name: r.name ?? "", email: r.email ?? "" }));

  // Normalise attachments
  const attachments = (msgInfo.attachments ?? []).map((att) => ({
    name:        att.fileName ?? att.name ?? "",
    contentType: att.attachMimeTag ?? null,
    size:        att.contentLength ?? null,
  }));

  // Pick richer body text
  const plainText = sections.plain ?? "";
  const htmlText  = sections.html ? extractTextFromHtml(sections.html) : "";
  const bodyText  = pickBetterText(plainText, htmlText);

  // Parse for emails, phones, IBANs, etc. across all relevant fields
  const parsedFields = gautiViskaIsTeksto([JSON.stringify({ subject: msgInfo.subject, from, to, body: bodyText })]);

  // Assemble indexed text: subject → from → to → body
  const text = [
    msgInfo.subject  && `Subject: ${msgInfo.subject}`,
    from.email       && `From: ${formatAddress(from)}`,
    to.length        && `To: ${formatAddress(to)}`,
    bodyText,
  ].filter(Boolean).join("\n");

  const metadata = {
    subject:              msgInfo.subject,
    from,
    to,
    headers:              parseHeaders(msgInfo.headers),
    attachments,
    sections,
    creationTime:         msgInfo.creationTime,
    lastModificationTime: msgInfo.lastModificationTime,
    clientSubmitTime:     msgInfo.clientSubmitTime,
    messageDeliveryTime:  msgInfo.messageDeliveryTime,
    ...parsedFields,
    text,
    pageCount:      1,
    characterCount: bodyText.length,
    wordCount:      bodyText.trim().split(/\s+/).filter(Boolean).length,
  };

  return { pages: [bodyText], metadata };
}

export const fileTypes = [
  { ext: "msg", mime: "application/vnd.ms-outlook" },
];

export { extractMsgContent as extract };
