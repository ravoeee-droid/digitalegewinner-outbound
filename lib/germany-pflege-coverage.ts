export const PFLEGE_SEARCH_TERMS = [
  "Ambulanter Pflegedienst",
  "Pflegedienst",
  "Ambulante Pflege",
  "Intensivpflege",
] as const;

export type GermanyCoverageState = {
  code: string;
  name: string;
  sectors: string[];
};

export const GERMANY_COVERAGE_STATES: GermanyCoverageState[] = [
  { code: "BW", name: "Baden-Württemberg", sectors: ["Stuttgart", "Karlsruhe", "Mannheim", "Freiburg im Breisgau", "Heilbronn", "Ulm", "Reutlingen", "Pforzheim", "Konstanz", "Ravensburg"] },
  { code: "BY", name: "Bayern", sectors: ["München", "Nürnberg", "Augsburg", "Regensburg", "Würzburg", "Ingolstadt", "Bamberg", "Bayreuth", "Landshut", "Rosenheim", "Passau", "Kempten"] },
  { code: "BE", name: "Berlin", sectors: ["Berlin Mitte", "Berlin Pankow", "Berlin Charlottenburg", "Berlin Neukölln", "Berlin Steglitz", "Berlin Tempelhof", "Berlin Reinickendorf", "Berlin Lichtenberg"] },
  { code: "BB", name: "Brandenburg", sectors: ["Potsdam", "Cottbus", "Brandenburg an der Havel", "Frankfurt Oder", "Oranienburg", "Eberswalde", "Königs Wusterhausen", "Neuruppin"] },
  { code: "HB", name: "Bremen", sectors: ["Bremen", "Bremerhaven"] },
  { code: "HH", name: "Hamburg", sectors: ["Hamburg Mitte", "Hamburg Altona", "Hamburg Eimsbüttel", "Hamburg Wandsbek", "Hamburg Harburg", "Hamburg Bergedorf"] },
  { code: "HE", name: "Hessen", sectors: ["Frankfurt am Main", "Wiesbaden", "Kassel", "Darmstadt", "Gießen", "Fulda", "Hanau", "Marburg", "Offenbach am Main"] },
  { code: "MV", name: "Mecklenburg-Vorpommern", sectors: ["Rostock", "Schwerin", "Neubrandenburg", "Stralsund", "Greifswald", "Wismar", "Güstrow"] },
  { code: "NI", name: "Niedersachsen", sectors: ["Hannover", "Braunschweig", "Oldenburg", "Osnabrück", "Göttingen", "Wolfsburg", "Hildesheim", "Salzgitter", "Lüneburg", "Celle"] },
  { code: "NW", name: "Nordrhein-Westfalen", sectors: ["Köln", "Düsseldorf", "Dortmund", "Essen", "Duisburg", "Bochum", "Wuppertal", "Bielefeld", "Bonn", "Münster", "Aachen", "Gelsenkirchen", "Mönchengladbach"] },
  { code: "RP", name: "Rheinland-Pfalz", sectors: ["Mainz", "Ludwigshafen", "Koblenz", "Trier", "Kaiserslautern", "Worms", "Neuwied", "Landau in der Pfalz"] },
  { code: "SL", name: "Saarland", sectors: ["Saarbrücken", "Neunkirchen Saar", "Homburg Saar", "Saarlouis", "Merzig"] },
  { code: "SN", name: "Sachsen", sectors: ["Leipzig", "Dresden", "Chemnitz", "Zwickau", "Görlitz", "Plauen", "Bautzen", "Freiberg Sachsen"] },
  { code: "ST", name: "Sachsen-Anhalt", sectors: ["Magdeburg", "Halle Saale", "Dessau-Roßlau", "Lutherstadt Wittenberg", "Halberstadt", "Stendal"] },
  { code: "SH", name: "Schleswig-Holstein", sectors: ["Kiel", "Lübeck", "Flensburg", "Neumünster", "Norderstedt", "Elmshorn", "Pinneberg", "Husum"] },
  { code: "TH", name: "Thüringen", sectors: ["Erfurt", "Jena", "Gera", "Weimar", "Gotha", "Eisenach", "Nordhausen", "Suhl"] },
];

export const STATE_NAME_ALIASES: Record<string, string> = {
  "baden-württemberg": "Baden-Württemberg",
  "baden-wurttemberg": "Baden-Württemberg",
  "bavaria": "Bayern",
  "bayern": "Bayern",
  "berlin": "Berlin",
  "brandenburg": "Brandenburg",
  "bremen": "Bremen",
  "hamburg": "Hamburg",
  "hesse": "Hessen",
  "hessen": "Hessen",
  "mecklenburg-vorpommern": "Mecklenburg-Vorpommern",
  "lower saxony": "Niedersachsen",
  "niedersachsen": "Niedersachsen",
  "north rhine-westphalia": "Nordrhein-Westfalen",
  "nordrhein-westfalen": "Nordrhein-Westfalen",
  "rhineland-palatinate": "Rheinland-Pfalz",
  "rheinland-pfalz": "Rheinland-Pfalz",
  "saarland": "Saarland",
  "saxony": "Sachsen",
  "sachsen": "Sachsen",
  "saxony-anhalt": "Sachsen-Anhalt",
  "sachsen-anhalt": "Sachsen-Anhalt",
  "schleswig-holstein": "Schleswig-Holstein",
  "thuringia": "Thüringen",
  "thüringen": "Thüringen",
  "thuringen": "Thüringen",
};

export function normalizeGermanState(value = "") {
  const normalized = value.trim().toLowerCase();
  return STATE_NAME_ALIASES[normalized] || GERMANY_COVERAGE_STATES.find((state) => state.name.toLowerCase() === normalized)?.name || value.trim();
}

export function coverageTasksForState(stateName: string) {
  const state = GERMANY_COVERAGE_STATES.find((item) => item.name === normalizeGermanState(stateName));
  if (!state) return [];
  return state.sectors.flatMap((sector) => PFLEGE_SEARCH_TERMS.map((term) => ({
    state: state.name,
    code: state.code,
    sector,
    term,
    queryKey: `${state.code}:${sector}:${term}`,
    query: `${term} ${sector} ${state.name}`,
  })));
}
