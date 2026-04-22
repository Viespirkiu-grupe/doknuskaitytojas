import iconv from "iconv-lite";

/**
 * Decode all RFC 2047 encoded-word sequences in a string.
 *
 * Encoded words have the form =?charset?encoding?text?= where encoding is
 * either Q (quoted-printable) or B (base64). They appear in email header
 * values and attachment filenames when the content contains non-ASCII
 * characters.
 *
 * Adjacent encoded words separated only by whitespace are concatenated without
 * the intervening whitespace, as required by RFC 2047 §6.2.
 *
 * @param {string} str
 * @returns {string}
 */
export function decodeRfc2047(str) {
  if (!str) return str;

  // Collapse whitespace between adjacent encoded words first (RFC 2047 §6.2)
  str = str.replace(/(\?=)\s+(=\?)/g, "$1$2");

  return str.replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_, charset, encoding, text) => {
    let bytes;
    if (encoding.toUpperCase() === "B") {
      bytes = Buffer.from(text, "base64");
    } else {
      // Quoted-printable: _ encodes a literal space, =XX encodes a byte
      const qp = text
        .replace(/_/g, " ")
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      bytes = Buffer.from(qp, "binary");
    }
    return iconv.decode(bytes, charset);
  });
}
