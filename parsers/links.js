/**
 * Suranda nuorodas duotame tekste, įskaitant http, https, mailto ir tel.
 * Pateikia kiekvieną, bei kuriuose puslapiuose jos rasti.
 * @param {string[]} tekstas - Puslapiai teksto
 * @returns {Array<{link: string, pages: number[]}>} - Kiekvienos nuorodos informacija su puslapiais
 */
export function surastiNuorodas(tekstas = []) {
  const nuorodosMap = new Map();

  // Regex for http(s), mailto and tel links
  const linkRegex = /\b(?:https?:\/\/|mailto:|tel:)[^\s/$.?#].[^\s]*\b/g;

  tekstas.forEach((puslapis, index) => {
    let match;
    while ((match = linkRegex.exec(puslapis)) !== null) {
      const link = match[0];
      if (!nuorodosMap.has(link)) nuorodosMap.set(link, []);
      nuorodosMap.get(link).push(index + 1); // puslapiai numeruojami nuo 1
    }
  });

  return Array.from(nuorodosMap, ([uri, pages]) => ({
    uri,
    pages: Array.from(new Set(pages)),
  }));
}
