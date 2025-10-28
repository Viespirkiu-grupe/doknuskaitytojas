const DEBUG_LOG = false;
const kriterijai = [
  {
    pavadinimas: "Žodžio ilgis",
    aprasymas: "Vertina kiek vidutinis žodžio ilgis toli nuo LT-EN vidurkių",
    weight: 1,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/);
      if (words.length === 0) return 0;
      const totalLength = words.reduce((sum, word) => sum + word.length, 0);
      const vidurkis = totalLength / words.length;

      // Skaliavimas: 5–11 => 1, 3 ir 15 => 0
      let score = 1;
      if (vidurkis < 5) score -= (5 - vidurkis) / 2;
      else if (vidurkis > 11) score -= (vidurkis - 11) / 2;
      if (score < 0) score = 0;
      return score;
    },
  },
  {
    pavadinimas: "Diakritikų tankis",
    aprasymas: "Vertina lietuviškų raidžių su diakritikais dalį",
    weight: 2,
    judge: (tekstas) => {
      const LT = "ąčęėįšūžĄČĘĖĮŠŪŽ";
      const letters = tekstas.replace(/[^\p{L}]/gu, "");
      if (!letters.length) return 0;
      const ratio =
        [...letters].filter((c) => LT.includes(c)).length / letters.length;

      if (ratio < 0.01 || ratio > 0.3) return 0;
      if (ratio >= 0.05 && ratio <= 0.2) return 1;
      // Tarp 0.01–0.05 ir 0.2–0.3 lineari skalė
      if (ratio < 0.05) return (ratio - 0.01) / (0.05 - 0.01);
      return (0.3 - ratio) / (0.3 - 0.2);
    },
  },
  {
    pavadinimas: "Netikėtų simbolių tankis",
    aprasymas:
      "Kokia dalis teksto yra neįprasti simboliai (pvz. @#$%^&*_=+[]{}|~<>)",
    weight: 5,
    judge: (tekstas) => {
      const junk = /[@#$%^&*_=+\[\]{}|~<>]/g;
      const total = tekstas.length;
      if (total === 0) return 0;
      const ratio = (tekstas.match(junk) || []).length / total;
      // Optimalu 0–0.02, >0.1 = blogai
      if (ratio <= 0.02) return 1;
      if (ratio >= 0.1) return 0;
      return (0.1 - ratio) / (0.1 - 0.02);
    },
  },

  {
    pavadinimas: "Didžiųjų raidžių proporcija",
    aprasymas: "Didžiųjų raidžių proporcija visame tekste",
    weight: 2,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/);
      if (!words.length) return 0;
      const ratio =
        words.filter((w) => /^[\p{Lu}]/u.test(w)).length / words.length;

      if (ratio === 0) return 0.5;
      if (ratio >= 0.01 && ratio <= 0.1) return 1;
      if (ratio > 0.2) return 0;
      // Tarp 0.10–0.20 proporcingai mažėja nuo 1 iki 0
      if (ratio > 0.1 && ratio <= 0.2) return (0.2 - ratio) / (0.2 - 0.1);
      // Tarp 0–0.01 proporcingai nuo 0.5 iki 1
      if (ratio > 0 && ratio < 0.01) return 0.5 + (ratio / 0.01) * 0.5;
      return 0; // saugumas
    },
  },

  {
    pavadinimas: "Sakinių ženklai",
    aprasymas: "Skyrybos ženklų kiekis",
    weight: 2,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/);
      if (!words.length) return 0;
      const ratio = (tekstas.match(/[.!?]/g) || []).length / words.length;
      const ideal = 0.08;
      const delta = 0.05; // ±0.05 = gerai
      if (ratio < ideal - delta) return ratio / (ideal - delta);
      if (ratio > ideal + delta) return (1 - ratio) / (1 - (ideal + delta));
      return 1;
    },
  },

  {
    pavadinimas: "Per ilgi žodžiai",
    aprasymas: "Ilgų žodžių dalis",
    weight: 1,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/);
      if (!words.length) return 0;
      const ratio = words.filter((w) => w.length > 20).length / words.length;
      // Idealus 0–0.02, >0.1 = blogai
      if (ratio <= 0.02) return 1;
      if (ratio >= 0.1) return 0;
      return (0.1 - ratio) / (0.1 - 0.02);
    },
  },
  {
    pavadinimas: "Per trumpi žodžiai",
    aprasymas: "Trumpų žodžių dalis",
    weight: 2,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/);
      if (!words.length) return 0;
      const shortRatio =
        words.filter((w) => w.length <= 3).length / words.length;

      if (shortRatio <= 0.1) return 1;
      if (shortRatio >= 0.3) return 0;
      // Tarp 0.05–0.2 lineari skalė
      return (0.3 - shortRatio) / (0.3 - 0.05);
    },
  },
  {
    pavadinimas: "ASCII + LT raidžių dalis",
    aprasymas:
      "Vertina kiek simbolių yra normalios raidės, skaičiai arba lietuviškos raidės su diakritikais",
    weight: 1,
    judge: (tekstas) => {
      const total = tekstas.length;
      if (total === 0) return 0;
      const LT = "ąčęėįšūžĄČĘĖĮŠŪŽ";
      const count =
        (tekstas.match(/[a-zA-Z0-9]/g) || []).length +
        [...tekstas].filter((c) => LT.includes(c)).length;
      return count / total;
    },
  },
  {
    pavadinimas: "Pavieniai simboliai / trumpi žodžiai",
    aprasymas: "Vertina pavienius simbolius arba 1 raidės žodžius",
    weight: 3,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/);
      if (!words.length) return 0;
      const singleCharRatio =
        words.filter((w) => w.length === 1).length / words.length;

      if (singleCharRatio <= 0.03) return 1;
      if (singleCharRatio >= 0.05) return 0;
      // Tarp 3–5% mažėja balas
      return (0.05 - singleCharRatio) / (0.05 - 0.03);
    },
  },
  {
    pavadinimas: "Vidinės didžiosios raidės",
    aprasymas:
      "Baudžia tekstus, kuriuose žodžių viduje pasitaiko didžiųjų raidžių",
    weight: 1.5,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (words.length === 0) return 1;

      let badCount = 0;
      for (const w of words) {
        const middle = w.slice(1, -1);
        if (/[A-ZĄČĘĖĮŠŲŪŽ]/.test(middle)) badCount++;
      }

      const percent = (badCount / words.length) * 100;

      // Linijinis kritimas: 1% -> 1, 3% -> 0
      let score;
      if (percent <= 1) score = 1;
      else if (percent >= 3) score = 0;
      else score = 1 - (percent - 1) / 2; // (1→3%) => 1→0

      return score;
    },
  },
  {
    pavadinimas: "Skaičiai žodžių viduje",
    aprasymas: "Baudžia tekstus, kuriuose žodžių viduje pasitaiko skaičių",
    weight: 5,
    judge: (tekstas) => {
      const words = tekstas
        .replace(/[^\p{L}\p{N}\-–—]+/gu, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (words.length === 0) return 1;

      let badCount = 0;
      for (const w of words) {
        // leidžiami atvejai:
        if (/^\d+$/.test(w)) continue; // visas skaičius
        if (/-|–|—/.test(w)) continue; // turi brūkšnį
        const digits = (w.match(/\d/g) || []).length;
        if (digits >= 3) continue; // turi bent 3 skaičius

        // blogas atvejis: skaičius viduryje
        const middle = w.slice(1, -1);
        if (/\d/.test(middle)) badCount++;
      }

      const percent = (badCount / words.length) * 100;

      // Linijinis kritimas: 1% → 1, 5% → 0
      let score;
      if (percent <= 1) score = 1;
      else if (percent >= 15) score = 0;
      else score = 1 - (percent - 1) / 14; // (1→15%) => 1→0

      return score;
    },
  },
  {
    pavadinimas: "Tekstas tuščias",
    aprasymas: "0 simbolių",
    weight: 1,
    judge: (tekstas) => {
      return tekstas.trim().length === 0 ? -100 : 1;
    },
  },
];

export async function nustatytiKokybiskesniTeksta(tekstas1, tekstas2) {
  let totalScore1 = 0;
  let totalScore2 = 0;

  const tableRows = kriterijai.map((kriterijus) => {
    const score1 = kriterijus.judge(tekstas1) * kriterijus.weight;
    const score2 = kriterijus.judge(tekstas2) * kriterijus.weight;

    totalScore1 += score1;
    totalScore2 += score2;

    return {
      Kriterijus: kriterijus.pavadinimas,
      "Tekstas 1": score1.toFixed(2),
      "Tekstas 2": score2.toFixed(2),
      Svoris: kriterijus.weight,
      Aprašymas: kriterijus.aprasymas,
    };
  });

  if (DEBUG_LOG) {
    console.table(tableRows);
    console.log(
      `Iš viso: Tekstas 1: ${totalScore1.toFixed(
        2,
      )}, Tekstas 2: ${totalScore2.toFixed(2)}`,
    );
  }

  return totalScore1 >= totalScore2 ? tekstas1 : tekstas2;
}

// Loop over tekstai1, tekstai2 arrays and merge them into a single array
// by choosing the better quality text from each pair using nustatytiKokybiskesniTeksta
// If tekstai2 is shorter, pick tekstai1's remaining items
export async function isrinktiGeresniusTekstus(tekstai1, tekstai2) {
  let result = [];
  const maxLength = Math.max(tekstai1.length, tekstai2.length);

  for (let i = 0; i < maxLength; i++) {
    const tekstas1 = tekstai1[i];
    const tekstas2 = tekstai2[i];

    if (tekstas1 && tekstas2) {
      const geresnisTekstas = await nustatytiKokybiskesniTeksta(
        tekstas1,
        tekstas2,
      );
      result.push(geresnisTekstas);
    } else if (tekstas1) {
      result.push(tekstas1);
    } else if (tekstas2) {
      result.push(tekstas2);
    }
  }

  return result;
}
