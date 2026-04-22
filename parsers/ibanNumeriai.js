/**
 * Validates an IBAN string using the ISO 13616 mod-97 checksum algorithm.
 * @param {string} iban
 * @returns {boolean}
 */
function isValidIban(iban) {
  // Move first 4 chars to end, then replace each letter with its numeric value (A=10…Z=35)
  const rearranged = (iban.slice(4) + iban.slice(0, 4))
    .toUpperCase()
    .split("")
    .map((c) => (c >= "A" ? String(c.charCodeAt(0) - 55) : c))
    .join("");

  // Compute mod 97 on an arbitrarily long numeric string
  let remainder = 0;
  for (const ch of rearranged) {
    remainder = (remainder * 10 + Number(ch)) % 97;
  }
  return remainder === 1;
}

/**
 * Finds validated IBAN numbers in the given page texts.
 * @param {string[]} pages
 * @returns {Array<{iban: string, pages: number[]}>}
 */
export function surastiIbanNumerius(pages = []) {
  const map = new Map();
  const regex = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

  pages.forEach((page, index) => {
    let match;
    while ((match = regex.exec(page)) !== null) {
      const iban = match[0];
      if (!isValidIban(iban)) continue;
      if (!map.has(iban)) map.set(iban, []);
      map.get(iban).push(index + 1);
    }
  });

  return Array.from(map, ([iban, pages]) => ({
    iban,
    pages: Array.from(new Set(pages)),
  }));
}
