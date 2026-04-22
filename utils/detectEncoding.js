import iconv from "iconv-lite";

/**
 * Candidate encodings tried in order when auto-detecting Lithuanian text.
 * UTF-8 is preferred on a tie; CP1257 and CP775 cover the Baltic code pages.
 */
const CANDIDATE_ENCODINGS = ["utf8", "cp1257", "cp775", "latin1", "cp1252"];

const lithuanianChars = "ąčęėįšųūžĄČĘĖĮŠŲŪŽ";
const lithuanianSet   = new Set(lithuanianChars.split(""));

/**
 * Score a decoded string for Lithuanian plausibility.
 *
 * Lithuanian letters score +3, ordinary word characters +1, replacement
 * characters or control characters −5, and other non-ASCII characters −1.
 *
 * @param {string} str
 * @returns {number}
 */
function scoreLithuanian(str) {
  let score = 0;
  for (const ch of str) {
    if (lithuanianSet.has(ch))          score += 3;
    else if (/[\w ._()\-]/.test(ch))    score += 1;
    else if (ch === "\uFFFD")           score -= 5;
    else if (/[\x00-\x1F\x7F]/.test(ch)) score -= 5;
    else                                score -= 1;
  }
  return score;
}

/**
 * Detect the best encoding for a Buffer containing Lithuanian text.
 *
 * Tries each of {@link CANDIDATE_ENCODINGS} and returns the one whose decoded
 * string scores highest under {@link scoreLithuanian}. UTF-8 wins ties.
 *
 * @param {Buffer} buf
 * @returns {{ encoding: string, text: string }}
 */
export function detectEncoding(buf) {
  let best = { encoding: "utf8", text: iconv.decode(buf, "utf8"), score: -Infinity };

  for (const enc of CANDIDATE_ENCODINGS) {
    const text  = iconv.decode(buf, enc);
    const score = scoreLithuanian(text);
    if (score > best.score || (score === best.score && enc === "utf8")) {
      best = { encoding: enc, text, score };
    }
  }

  return { encoding: best.encoding, text: best.text };
}
