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

export type HiringEmployerSignal = {
  employer: string;
  city: string;
  seedKey: string;
  jobGrowth: JobGrowthSignal;
};

export type HiringEmployerDiscovery = {
  source: "arbeitsagentur-jobsuche";
  checkedAt: string;
  location: string;
  employers: HiringEmployerSignal[];
  rawJobs: number;
  relevantJobs: number;
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

const JOBS_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs";
const CARE_ROLE = /(pflegefach|pflegekraft|altenpfleg|krankenpfleg|gesundheits-.*pfleg|pflegehelfer|pflegeassist|pdl|pflegedienstleit|wundmanager|intensivpfleg|gerontopsychiatr|pflegefachmann|pflegefachfrau)/i;
const LEGAL_FORM = /\b(gmbh|ggmbh|mbh|ug|haftungsbeschränkt|ag|eg|kg|ohg|e\.v\.?|ev)\b/gi;
const STAFFING_EMPLOYER = /(zeitarbeit|personaldienst|personalservice|arbeitnehmerüberlass|arbeitnehmerueberlass|personalvermittlung|arbeitsvermittlung|leasing|staffing|recruiting agency|avanti|akut medizin|pluss personal|all\.medi)/i;

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " und ")
    .replace(LEGAL_FORM, " ")
    .replace(/[^a-z0-9äöüß]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function companyNamesMatch(expected: string, actual: string) {
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

function emptySignal(warning = ""): JobGrowthSignal {
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

function jobToSignal(job: BaJob, fallbackEmployer = "", fallbackCity = ""): JobSignalItem {
  const title = job.beruf || "Offene Stelle";
  const externalUrl = job.externeUrl || "";
  return {
    title,
    employer: job.arbeitgeber || fallbackEmployer,
    city: job.arbeitsort?.ort || fallbackCity,
    publishedAt: job.aktuelleVeroeffentlichungsdatum || "",
    reference: job.referenznummer || job.refnr || "",
    externalUrl,
    portal: portalFromUrl(externalUrl),
    careRole: CARE_ROLE.test(title),
  };
}

function signalFromRoles(roles: JobSignalItem[], checkedAt: string, warning = ""): JobGrowthSignal {
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
    warning,
  };
}

async function fetchJobs(url: URL, timeoutMs = 10_000) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "X-API-Key": "jobboerse-jobsuche",
      "accept": "application/json",
      "user-agent": "DigitaleGewinner-PflegeLeadFactory/2.0",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Jobsuche HTTP ${response.status}`);
  const json = await response.json() as BaResponse;
  return Array.isArray(json.stellenangebote) ? json.stellenangebote : [];
}

export async function discoverHiringEmployers(location = "", options?: { days?: number; size?: number; radiusKm?: number }): Promise<HiringEmployerDiscovery> {
  const checkedAt = new Date().toISOString();
  const days = Math.max(1, Math.min(45, Number(options?.days || 21)));
  const size = Math.max(25, Math.min(100, Number(options?.size || 100)));
  const radiusKm = Math.max(10, Math.min(100, Number(options?.radiusKm || 50)));
  try {
    const url = new URL(JOBS_URL);
    url.searchParams.set("was", "Pflege");
    if (location.trim()) {
      url.searchParams.set("wo", location.trim());
      url.searchParams.set("umkreis", String(radiusKm));
    }
    url.searchParams.set("veroeffentlichtseit", String(days));
    url.searchParams.set("angebotsart", "1");
    url.searchParams.set("zeitarbeit", "false");
    url.searchParams.set("pav", "false");
    url.searchParams.set("page", "1");
    url.searchParams.set("size", String(size));

    const raw = await fetchJobs(url, 12_000);
    const relevant = raw
      .map((job) => jobToSignal(job))
      .filter((job) => job.careRole && Boolean(job.employer) && !STAFFING_EMPLOYER.test(job.employer));

    const groups = new Map<string, JobSignalItem[]>();
    for (const job of relevant) {
      const key = `${normalizeName(job.employer)}|${job.city.toLowerCase().trim()}`;
      if (!key.replace("|", "")) continue;
      const existing = groups.get(key) || [];
      if (!existing.some((item) => item.reference && item.reference === job.reference)) existing.push(job);
      groups.set(key, existing);
    }

    const employers = [...groups.entries()]
      .map(([seedKey, roles]) => ({
        employer: roles[0]?.employer || "",
        city: roles[0]?.city || location,
        seedKey,
        jobGrowth: signalFromRoles(roles, checkedAt),
      }))
      .filter((item) => item.employer)
      .sort((a, b) => b.jobGrowth.growthScore - a.jobGrowth.growthScore || b.jobGrowth.relevantOpenJobs - a.jobGrowth.relevantOpenJobs)
      .slice(0, 30);

    return {
      source: "arbeitsagentur-jobsuche",
      checkedAt,
      location,
      employers,
      rawJobs: raw.length,
      relevantJobs: relevant.length,
      warning: "",
    };
  } catch (error) {
    return {
      source: "arbeitsagentur-jobsuche",
      checkedAt,
      location,
      employers: [],
      rawJobs: 0,
      relevantJobs: 0,
      warning: error instanceof Error ? error.message : "Jobsuche nicht verfügbar.",
    };
  }
}

export async function inspectJobGrowth(company: string, city = ""): Promise<JobGrowthSignal> {
  const checkedAt = new Date().toISOString();
  if (!company.trim()) return emptySignal("Unternehmensname fehlt.");

  try {
    const url = new URL(JOBS_URL);
    url.searchParams.set("arbeitgeber", company.trim());
    if (city.trim()) {
      url.searchParams.set("wo", city.trim());
      url.searchParams.set("umkreis", "35");
    }
    url.searchParams.set("veroeffentlichtseit", "45");
    url.searchParams.set("angebotsart", "1");
    url.searchParams.set("zeitarbeit", "false");
    url.searchParams.set("pav", "false");
    url.searchParams.set("page", "1");
    url.searchParams.set("size", "50");

    const raw = await fetchJobs(url);
    const matched = raw.filter((job) => companyNamesMatch(company, job.arbeitgeber || ""));
    const roles = matched.slice(0, 30).map((job) => jobToSignal(job, company, city));
    return signalFromRoles(roles, checkedAt);
  } catch (error) {
    return emptySignal(error instanceof Error ? error.message : "Jobsuche nicht verfügbar.");
  }
}
