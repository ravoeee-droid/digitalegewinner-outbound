export type JobSignalItem = {
  title: string;
  employer: string;
  city: string;
  publishedAt: string;
  reference: string;
  externalUrl: string;
  portal: string;
  careRole: boolean;
};

export type JobGrowthSignal = {
  source: "arbeitsagentur-jobsuche";
  checkedAt: string;
  openJobs: number;
  relevantOpenJobs: number;
  externalPortalJobs: number;
  externalPortals: string[];
  latestPublishedAt: string;
  roles: JobSignalItem[];
  growthScore: number;
  confidence: "high" | "medium" | "low";
  warning: string;
};

type BaJob = {
  beruf?: string;
  refnr?: string;
  referenznummer?: string;
  arbeitgeber?: string;
  aktuelleVeroeffentlichungsdatum?: string;
  externeUrl?: string | null;
  arbeitsort?: { ort?: string };
};

type BaResponse = { stellenangebote?: BaJob[] };

const CARE_ROLE = /(pflegefach|pflegekraft|altenpfleg|krankenpfleg|gesundheits-.*pfleg|pflegehelfer|pflegeassist|pdl|pflegedienstleit|wundmanager|intensivpfleg|gerontopsychiatr)/i;
const LEGAL_FORM = /\b(gmbh|ggmbh|mbh|ug|haftungsbeschränkt|ag|eg|kg|ohg|e\.v\.?|ev)\b/gi;

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " und ")
    .replace(LEGAL_FORM, " ")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyMatches(expected: string, actual: string) {
  const a = normalizeName(expected);
  const b = normalizeName(actual);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aTokens = new Set(a.split(" ").filter((token) => token.length >= 4));
  const bTokens = b.split(" ").filter((token) => token.length >= 4);
  if (!aTokens.size || !bTokens.length) return false;
  const overlap = bTokens.filter((token) => aTokens.has(token)).length;
  return overlap >= Math.min(2, Math.min(aTokens.size, bTokens.length));
}

function portalFromUrl(raw: string) {
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("indeed.")) return "Indeed";
    if (host.includes("stepstone.")) return "StepStone";
    if (host.includes("meinestadt.")) return "meinestadt.de";
    if (host.includes("stellenanzeigen.")) return "stellenanzeigen.de";
    if (host.includes("join.com")) return "JOIN";
    if (host.includes("softgarden")) return "softgarden";
    if (host.includes("personio")) return "Personio";
    if (host.includes("onlyfy") || host.includes("prescreen")) return "onlyfy";
    if (host.includes("arbeitsagentur.de")) return "Bundesagentur für Arbeit";
    return host;
  } catch { return ""; }
}

function emptySignal(warning = "") : JobGrowthSignal {
  return {
    source: "arbeitsagentur-jobsuche",
    checkedAt: new Date().toISOString(),
    openJobs: 0,
    relevantOpenJobs: 0,
    externalPortalJobs: 0,
    externalPortals: [],
    latestPublishedAt: "",
    roles: [],
    growthScore: 0,
    confidence: "low",
    warning,
  };
}

export async function inspectJobGrowth(company: string, city = ""): Promise<JobGrowthSignal> {
  const checkedAt = new Date().toISOString();
  if (!company.trim()) return emptySignal("Unternehmensname fehlt.");

  try {
    const url = new URL("https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs");
    url.searchParams.set("arbeitgeber", company.trim());
    if (city.trim()) {
      url.searchParams.set("wo", city.trim());
      url.searchParams.set("umkreis", "35");
    }
    url.searchParams.set("veroeffentlichtseit", "45");
    url.searchParams.set("angebotsart", "1");
    url.searchParams.set("zeitarbeit", "false");
    url.searchParams.set("page", "1");
    url.searchParams.set("size", "50");

    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "X-API-Key": "jobboerse-jobsuche",
        "accept": "application/json",
        "user-agent": "DigitaleGewinner-PflegeLeadFactory/1.0",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return emptySignal(`Jobsuche HTTP ${response.status}`);

    const json = await response.json() as BaResponse;
    const raw = Array.isArray(json.stellenangebote) ? json.stellenangebote : [];
    const matched = raw.filter((job) => companyMatches(company, job.arbeitgeber || ""));
    const roles: JobSignalItem[] = matched.slice(0, 30).map((job) => {
      const externalUrl = job.externeUrl || "";
      const title = job.beruf || "Offene Stelle";
      return {
        title,
        employer: job.arbeitgeber || company,
        city: job.arbeitsort?.ort || city,
        publishedAt: job.aktuelleVeroeffentlichungsdatum || "",
        reference: job.referenznummer || job.refnr || "",
        externalUrl,
        portal: portalFromUrl(externalUrl),
        careRole: CARE_ROLE.test(title),
      };
    });

    const relevant = roles.filter((job) => job.careRole);
    const external = relevant.filter((job) => Boolean(job.externalUrl));
    const externalPortals = [...new Set(external.map((job) => job.portal).filter(Boolean))];
    const latestPublishedAt = relevant.map((job) => job.publishedAt).filter(Boolean).sort().reverse()[0] || "";

    let growthScore = 0;
    if (relevant.length === 1) growthScore = 76;
    else if (relevant.length === 2) growthScore = 86;
    else if (relevant.length === 3) growthScore = 93;
    else if (relevant.length >= 4) growthScore = 100;
    if (growthScore && external.length) growthScore = Math.min(100, growthScore + 4);

    return {
      source: "arbeitsagentur-jobsuche",
      checkedAt,
      openJobs: roles.length,
      relevantOpenJobs: relevant.length,
      externalPortalJobs: external.length,
      externalPortals,
      latestPublishedAt,
      roles: relevant.slice(0, 12),
      growthScore,
      confidence: relevant.length >= 2 ? "high" : relevant.length === 1 ? "medium" : "low",
      warning: "",
    };
  } catch (error) {
    return emptySignal(error instanceof Error ? error.message : "Jobsuche nicht verfügbar.");
  }
}
