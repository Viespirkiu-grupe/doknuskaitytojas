import { surastiJarKodus } from "../parsers/jarKodai.js";
import { surastiIbanNumerius } from "../parsers/ibanNumeriai.js";
import { surastiTelefonoNumerius } from "../parsers/telefonai.js";
import { surastiNuorodas } from "../parsers/links.js";
import { surastiEmails } from "../parsers/emails.js";

export function gautiViskaIsTeksto(pages = []) {
  let result = {
    jarKodai: surastiJarKodus(pages),
    ibanNumeriai: surastiIbanNumerius(pages),
    telefonai: surastiTelefonoNumerius(pages),
    links: surastiNuorodas(pages),
    emails: surastiEmails(pages),
    pageCount: pages.length,
    characterCount: pages.reduce((acc, page) => acc + page.length, 0),
    wordCount: pages.reduce((acc, page) => {
      const words = page.trim().split(/\s+/).filter(Boolean); // remove empty strings
      return acc + words.length;
    }, 0),
  };

  result.domains = Array.from(
    new Set([
      // domains from links
      ...result.links
        .map((l) => {
          try {
            const url = new URL(l.uri);
            return url.hostname.replace(/^www\./, "");
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean),

      // domains from emails
      ...result.emails
        .map((e) => {
          const parts = e.email.split("@");
          return parts.length === 2 ? parts[1].replace(/^www\./, "") : null;
        })
        .filter(Boolean),
    ]),
  ).sort();

  // Sujungiame teksto ir mailto: email
  let linkEmails = result.links
    .filter((l) => l.uri.toLowerCase().startsWith("mailto:"))
    .map((l) => ({
      email: l.uri.slice(7),
      pages: l.pages,
    }));

  result.emails = Array.from(
    (() => {
      const map = new Map();

      [...linkEmails, ...result.emails].forEach(({ email, pages }) => {
        if (!map.has(email)) map.set(email, new Set(pages));
        else pages.forEach((p) => map.get(email).add(p));
      });

      return map;
    })(),
    ([email, pagesSet]) => ({
      email,
      pages: Array.from(pagesSet).sort((a, b) => a - b),
    }),
  );

  return result;
}
