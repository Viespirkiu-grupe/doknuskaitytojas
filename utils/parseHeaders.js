import { decodeRfc2047 } from "./decodeRfc2047.js";

/**
 * Parse a raw RFC 2822 header block into a keyed object.
 *
 * Folded header values (continuation lines starting with whitespace) are
 * unfolded by joining them with a single space. Headers that appear more than
 * once are collected into an array; single-occurrence headers remain strings.
 *
 * @param {string | null | undefined} raw - Raw header block, e.g. from an MSG file
 * @returns {Record<string, string | string[]>}
 */
export function parseHeaders(raw) {
  if (!raw) return {};

  // Unfold folded lines (RFC 2822 §2.2.3)
  const unfolded = raw
    .split(/\r?\n/)
    .reduce((lines, line) => {
      if (/^[ \t]/.test(line) && lines.length > 0) {
        lines[lines.length - 1] += " " + line.trim();
      } else {
        lines.push(line);
      }
      return lines;
    }, []);

  const result = {};

  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;

    const key   = line.slice(0, colon).trim();
    const value = decodeRfc2047(line.slice(colon + 1).trim());
    if (!key) continue;

    if (key in result) {
      result[key] = Array.isArray(result[key])
        ? [...result[key], value]
        : [result[key], value];
    } else {
      result[key] = value;
    }
  }

  return result;
}
