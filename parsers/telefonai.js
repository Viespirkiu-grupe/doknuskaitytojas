/**
 * Suranda telefono numerius duotame tekste.
 * Pateikia kiekvieną, bei kuriuose puslapiuose jie rasti.
 * @param {string[]} tekstas - Puslapiai teksto
 * @returns {Array<{numeris: string, pages: number[]}>} - Kiekvieno telefono numerio informacija su puslapiais
 */
export function surastiTelefonoNumerius(tekstas = []) {
  const telefonaiMap = new Map();

  // Leave this for international numbers
  let internationalNumberRegex =
    /\+(9[976]\d|8[987530]\d|6[987]\d|5[90]\d|42\d|3[875]\d|2[98654321]\d|9[8543210]|8[6421]|6[6543210]|5[87654321]|4[987654310] | 3[9643210] | 2[70] | 7 | 1) \d{ 1, 14 } $/gm;

  // Lithuanian number regex
  let lithuanianNumberRegex =
    /((?:^|[^0-9])((?:[\(]*)(?:(?:\+370|370|8|0)[\s\-.\(\)]*)?(?:6(?:[\s\-.\(\)]*\d){7}|[2-7](?:[\s\-.\(\)]*\d){7}|[2-7]\d(?:[\s\-.\(\)]*\d){6}))(?!\d))/gm;

  tekstas.forEach((puslapis, i) => {
    const normalizedText = puslapis; // can normalize further if needed

    // Lithuanian numbers
    const foundLithuanian = normalizedText.match(lithuanianNumberRegex) || [];
    for (let phone of foundLithuanian) {
      let cleaned = phone.replace(/[\s\-\.\(\)]/g, "").replaceAll(":", "");

      // Convert all Lithuanian numbers to +370XXXXXXXX
      if (cleaned.startsWith("+370")) {
        // do nothing
      } else if (cleaned.startsWith("370")) {
        cleaned = "+" + cleaned;
      } else if (cleaned.startsWith("8")) {
        cleaned = "+370" + cleaned.slice(1);
      } else if (cleaned.startsWith("0")) {
        cleaned = "+370" + cleaned.slice(1);
      } else if (cleaned.match(/^6\d{7}$/)) {
        cleaned = "+370" + cleaned;
      } else if (cleaned.match(/^[2-7]\d{7}$/)) {
        cleaned = "+370" + cleaned;
      } else if (cleaned.match(/^[2-7]\d{6}$/)) {
        cleaned = "+370" + cleaned;
      } else {
        continue; // skip unrecognized formats
      }

      const phoneSet = telefonaiMap.get(cleaned) || new Set();
      phoneSet.add(i + 1);
      telefonaiMap.set(cleaned, phoneSet);
    }

    // International numbers
    const foundInternational =
      normalizedText.match(internationalNumberRegex) || [];
    for (let phone of foundInternational) {
      let cleaned = phone.replace(/[\s\-\.\(\)]/g, "").replaceAll(":", "");
      const phoneSet = telefonaiMap.get(cleaned) || new Set();
      phoneSet.add(i + 1);
      telefonaiMap.set(cleaned, phoneSet);
    }
  });

  // Ignore all +3701 and +3702 numbers (they don't exist)
  for (let key of telefonaiMap.keys()) {
    if (key.startsWith("+3701") || key.startsWith("+3702")) {
      telefonaiMap.delete(key);
    }
  }

  return Array.from(telefonaiMap, ([numeris, pagesSet]) => ({
    numeris,
    pages: Array.from(new Set(pagesSet)).sort((a, b) => a - b),
  }));
}
