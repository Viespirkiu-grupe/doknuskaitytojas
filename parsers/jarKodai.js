/**
 * Suranda JAR kodus duotame tekste.
 * Pateikia kiekvieną, bei kuriuose puslapiuose jie rasti.
 * @param {string[]} tekstas - Puslapiai teksto
 * @returns {Array<{code: string, pages: number[]}>} - Kiekvieno JAR kodo informacija su puslapiais
 */
export function surastiJarKodus(tekstas = []) {
  const jarKodaiMap = new Map();
  const jarKodasRegex = /\b\d{9}\b/g;

  tekstas.forEach((puslapis, index) => {
    let match;
    while ((match = jarKodasRegex.exec(puslapis)) !== null) {
      const kodas = match[0];
      if (!jarKodaiMap.has(kodas)) jarKodaiMap.set(kodas, []);
      jarKodaiMap.get(kodas).push(index + 1); // puslapiai numeruojami nuo 1
    }
  });

  return Array.from(jarKodaiMap, ([code, pages]) => ({
    code,
    pages: Array.from(new Set(pages)),
  }));
}
