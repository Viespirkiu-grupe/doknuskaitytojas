/**
 * Suranda IBAN numerius duotame tekste.
 * Pateikia kiekvieną, bei kuriuose puslapiuose jie rasti.
 * @param {string[]} tekstas - Puslapiai teksto
 * @returns {Array<{code: string, pages: number[]}>} - Kiekvieno IBAN kodo informacija su puslapiais
 */
export function surastiIbanNumerius(tekstas = []) {
  const ibanKodaiMap = new Map();
  const ibanRegex = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;

  tekstas.forEach((puslapis, index) => {
    let match;
    while ((match = ibanRegex.exec(puslapis)) !== null) {
      const numeris = match[0];
      if (!ibanKodaiMap.has(numeris)) ibanKodaiMap.set(numeris, []);
      ibanKodaiMap.get(numeris).push(index + 1); // puslapiai numeruojami nuo 1
    }
  });

  return Array.from(ibanKodaiMap, ([numeris, pages]) => ({
    numeris,
    pages: Array.from(new Set(pages)),
  }));
}
