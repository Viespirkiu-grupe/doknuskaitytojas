/**
 * Suranda el. pašto adresus duotame tekste.
 * Pateikia kiekvieną, bei kuriuose puslapiuose jie rasti.
 * @param {string[]} tekstas - Puslapiai teksto
 * @returns {Array<{email: string, pages: number[]}>} - Kiekvieno el. pašto adreso informacija su puslapiais
 */
export function surastiEmails(tekstas = []) {
  const emailsMap = new Map();

  // Simple email regex
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

  tekstas.forEach((puslapis, index) => {
    let match;
    while ((match = emailRegex.exec(puslapis)) !== null) {
      const email = match[0];
      if (!emailsMap.has(email)) emailsMap.set(email, []);
      emailsMap.get(email).push(index + 1); // pages start from 1
    }
  });

  return Array.from(emailsMap, ([email, pages]) => ({ email, pages }));
}
