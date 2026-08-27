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
  website: string;
  address: string;
  region: string;
  companySize: string;
  openPositions: number;
  ambulatoryEvidence: boolean;
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

type BaAddress = {
  land?: string;
  region?: string;
  plz?: string | number;
  ort?: string;
  strasse?: string;
  hausnummer?: string;
  strasseHausnummer?: string;
};
type BaLocation = { adresse?: BaAddress };
type BaJob = {
  beruf?: string;
  stellenangebotsTitel?: string;
  hauptberuf?: string;
  alleBerufe?: string[];
  refnr?: string;
  referenznummer?: string;
  arbeitgeber?: string;
  firma?: string;
  aktuelleVeroeffentlichungsdatum?: string;
  datumErsteVeroeffentlichung?: string;
  aenderungsdatum?: string;
  veroeffentlichungszeitraum?: { von?: string };
  externeUrl?: string | null;
  externeURL?: string | null;
  arbeitsort?: { ort?: string };
  stellenlokationen?: BaLocation[];
};
type BaResponse = { stellenangebote?: BaJob[]; ergebnisliste?: BaJob[] };
type BaJobDetail = {
  arbeitgeber?: string;
  firma?: string;
  arbeitgeberdarstellungUrl?: string;
  arbeitgeberAdresse?: BaAddress;
  stellenlokationen?: BaLocation[];
  stellenangebotsBeschreibung?: string;
  betriebsgroesse?: string;
  anzahlOffeneStellen?: number;
};

const JOBS_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs";
const JOB_DETAIL_BASE = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails";
const CARE_ROLE = /(pflegefach|pflegekraft|altenpfleg|krankenpfleg|gesundheits-.{0,20}pfleg|pflegehelfer|pflegeassist|assistent.{0,24}pflege|pflege.{0,24}assistent|pflegedienstleit|\bpdl\b|wundmanager|intensivpfleg|gerontopsychiatr|pflegefachmann|pflegefachfrau|ambulante.{0,20}pflege|pflege.{0,20}ambulant)/i;
const AMBULATORY_TEXT = /(ambulant|häuslich|haeuslich|pflegedienst|sozialstation|diakoniestation|home care|home health|intensivpflege|hausbesuch)/i;
const LEGAL_FORM = /\b(gmbh|ggmbh|mbh|ug|haftungsbeschränkt|ag|eg|kg|ohg|e\.v\.?|ev)\b/gi;
const STAFFING_EMPLOYER = /(zeitarbeit|personaldienst|personalservice|arbeitnehmerüberlass|arbeitnehmerueberlass|personalvermittlung|arbeitsvermittlung|leasing|staffing|recruiting agency|avanti|akut medizin|pluss personal|all\.medi|tempton)/i;

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
    if (host.includes("finest-jobs")) return "finest jobs";
    if (host.includes("jobexport")) return "jobexport";
    if (host.includes("bewerbung.jobs")) return "bewerbung.jobs";
    return host;
  } catch { return ""; }
}

function normalizeWebsite(value = "") {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch { return ""; }
}

function firstAddress(job: { arbeitgeberAdresse?: BaAddress; stellenlokationen?: BaLocation[] }) {
  return job.arbeitgeberAdresse || job.stellenlokationen?.[0]?.adresse;
}
function formatAddress(value?: BaAddress) {
  if (!value) return "";
  const street = value.strasseHausnummer || [value.strasse, value.hausnummer].filter(Boolean).join(" ");
  return [street, [value.plz, value.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
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

function jobTitle(job: BaJob) {
  return job.stellenangebotsTitel || job.beruf || job.hauptberuf || job.alleBerufe?.[0] || "Offene Stelle";
}
function jobEmployer(job: BaJob, fallback = "") { return job.firma || job.arbeitgeber || fallback; }
function jobCity(job: BaJob, fallback = "") { return job.stellenlokationen?.[0]?.adresse?.ort || job.arbeitsort?.ort || fallback; }
function jobPublishedAt(job: BaJob) {
  return job.veroeffentlichungszeitraum?.von || job.aktuelleVeroeffentlichungsdatum || job.datumErsteVeroeffentlichung || job.aenderungsdatum?.slice(0, 10) || "";
}
function jobExternalUrl(job: BaJob) { return job.externeURL || job.externeUrl || ""; }

function jobToSignal(job: BaJob, fallbackEmployer = "", fallbackCity = ""): JobSignalItem {
  const title = jobTitle(job);
  const externalUrl = jobExternalUrl(job);
  return {
    title,
    employer: jobEmployer(job, fallbackEmployer),
    city: jobCity(job, fallbackCity),
    publishedAt: jobPublishedAt(job),
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

async function apiGet<T>(url: URL, timeoutMs = 10_000): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "X-API-Key": "jobboerse-jobsuche",
      "accept": "application/json",
      "user-agent": "DigitaleGewinner-PflegeLeadFactory/2.2",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Jobsuche HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchJobs(url: URL, timeoutMs = 10_000) {
  const json = await apiGet<BaResponse>(url, timeoutMs);
  if (Array.isArray(json.ergebnisliste)) return json.ergebnisliste;
  if (Array.isArray(json.stellenangebote)) return json.stellenangebote;
  return [];
}

async function fetchJobDetail(reference: string): Promise<BaJobDetail | null> {
  if (!reference) return null;
  try {
    const encoded = Buffer.from(reference, "utf8").toString("base64");
    return await apiGet<BaJobDetail>(new URL(`${JOB_DETAIL_BASE}/${encodeURIComponent(encoded)}`), 8_000);
  } catch { return null; }
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

    const preliminary = [...groups.entries()]
      .map(([seedKey, roles]) => ({
        employer: roles[0]?.employer || "",
        city: roles[0]?.city || location,
        seedKey,
        roles,
        jobGrowth: signalFromRoles(roles, checkedAt),
      }))
      .filter((item) => item.employer)
      .sort((a, b) => b.jobGrowth.growthScore - a.jobGrowth.growthScore || b.jobGrowth.relevantOpenJobs - a.jobGrowth.relevantOpenJobs)
      .slice(0, 12);

    const employers = await Promise.all(preliminary.map(async (item): Promise<HiringEmployerSignal> => {
      const detail = await fetchJobDetail(item.roles.find((role) => role.reference)?.reference || "");
      const detailAddress = firstAddress(detail || {});
      const employer = detail?.arbeitgeber || detail?.firma || item.employer;
      const city = detailAddress?.ort || item.city;
      const evidenceText = `${employer} ${item.roles.map((role) => role.title).join(" ")} ${detail?.stellenangebotsBeschreibung || ""}`;
      return {
        employer,
        city,
        seedKey: item.seedKey,
        website: normalizeWebsite(detail?.arbeitgeberdarstellungUrl || ""),
        address: formatAddress(detailAddress),
        region: detailAddress?.region || "",
        companySize: detail?.betriebsgroesse || "",
        openPositions: Math.max(item.jobGrowth.relevantOpenJobs, Number(detail?.anzahlOffeneStellen || 0)),
        ambulatoryEvidence: AMBULATORY_TEXT.test(evidenceText),
        jobGrowth: item.jobGrowth,
      };
    }));

    return {
      source: "arbeitsagentur-jobsuche",
      checkedAt,
      location,
      employers,
      rawJobs: raw.length,
      relevantJobs: relevant.length,
      warning: raw.length ? "" : "Jobsuche lieferte für die Region keine Ergebnisse.",
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
    url.searchParams.set("page", "1");
    url.searchParams.set("size", "50");

    const raw = await fetchJobs(url);
    const matched = raw.filter((job) => companyNamesMatch(company, jobEmployer(job)));
    const roles = matched.slice(0, 30).map((job) => jobToSignal(job, company, city));
    return signalFromRoles(roles, checkedAt);
  } catch (error) {
    return emptySignal(error instanceof Error ? error.message : "Jobsuche nicht verfügbar.");
  }
}
