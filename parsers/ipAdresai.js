/**
 * Suranda IPv4 ir IPv6 adresus duotame tekste.
 * Pateikia kiekvieną, bei kuriuose puslapiuose jie rasti.
 * @param {string[]} tekstas - Puslapiai teksto
 * @returns {Array<{ip: string, pages: number[]}>}
 */
export function surastiIpAdresus(tekstas = []) {
  const ipMap = new Map();

  // IPv4 (0–255) and fairly strict IPv6 (incl. ::)
  const ipRegex =
    /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|\b::\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b|\b:(?::[0-9a-fA-F]{1,4}){1,7}\b)/g;

  tekstas.forEach((puslapis, index) => {
    let match;
    while ((match = ipRegex.exec(puslapis)) !== null) {
      const ip = match[0];
      if (!ipMap.has(ip)) ipMap.set(ip, []);
      ipMap.get(ip).push(index + 1);
    }
  });

  let results = Array.from(ipMap, ([ip, pages]) => ({
    ip,
    pages: Array.from(new Set(pages)),
  }));

  // Suppress section-number false positives: if many IPv4s share the same
  // octet magnitude, they're almost certainly document outline numbers.
  // Thresholds scale with max octet value — small numbers need fewer hits
  // to be suspicious, larger numbers need more.
  const ipv4 = results.filter((e) => /^\d+\.\d+\.\d+\.\d+$/.test(e.ip));
  const maxOctet = (ip) => Math.max(...ip.split(".").map(Number));

  for (const [threshold, limit] of [[10, 15], [20, 25], [50, 40]]) {
    const group = ipv4.filter((e) => maxOctet(e.ip) < threshold);
    if (group.length >= limit) {
      const bad = new Set(group.map((e) => e.ip));
      results = results.filter((e) => !bad.has(e.ip));
    }
  }

  return results;
}
