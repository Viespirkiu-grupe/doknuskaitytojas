/**
 * Suranda MAC adresus duotame tekste ir normalizuoja juos į 00:11:22:33:44:55 formą.
 * Palaiko:
 *  - 00:11:22:33:44:55
 *  - 00-11-22-33-44-55
 *  - 0011.2233.4455
 * @param {string[]} tekstas - Puslapiai teksto
 * @returns {Array<{mac: string, pages: number[]}>}
 */
export function surastiMacAdresus(tekstas = []) {
  const macMap = new Map();

  const macRegex =
    /\b(?:[0-9A-Fa-f]{2}(?:[:-])){5}[0-9A-Fa-f]{2}\b|\b(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}\b/g;

  // Normalize to lowercase colon-separated
  const normalizeMac = (mac) => {
    mac = mac.toLowerCase();
    if (mac.includes(".")) {
      // 0011.2233.4455 → 00:11:22:33:44:55
      return mac
        .split(".")
        .map((chunk) => chunk.match(/.{2}/g).join(":"))
        .join(":");
    }
    return mac.replace(/-/g, ":"); // 00-11-22-33-44-55 → 00:11:22:33:44:55
  };

  tekstas.forEach((puslapis, index) => {
    let match;
    while ((match = macRegex.exec(puslapis)) !== null) {
      const mac = normalizeMac(match[0]);
      if (!macMap.has(mac)) macMap.set(mac, []);
      macMap.get(mac).push(index + 1);
    }
  });

  return Array.from(macMap, ([mac, pages]) => ({
    mac,
    pages: Array.from(new Set(pages)),
  }));
}
