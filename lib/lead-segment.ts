// Einheitliche, konservative Trennung für Lead-Liste, CRM, Video und Versand.
// Unklare oder widersprüchliche Branchen werden NIE automatisch Pflege/PV zugeordnet.
export type LeadSegment = "pflege" | "pv" | "other";

export type CompanySegmentInput = {
  company?: string;
  name?: string;
  industry?: string;
  source?: string;
  metadata?: Record<string, unknown> | null;
};

const PV_SOURCE = /^(?:ba-pv$|pv[-_]|solar[-_]|photovoltaik)/i;
const PFLEGE_SOURCE = /^(?:ba-jobboerse$|pflegedienstjobs24$|pflege[-_])/i;
const PV_IDENTITY = /photovolta|solar|solaranlag|solartechnik|pv[-\s/]/i;
const PFLEGE_IDENTITY = /pflegedienst|pflegeheim|pflegezentrum|pflegehaus|pflegeresidenz|pflegeteam|pflegeeinrichtung|pflegefach|senior|ambulant|krankenpflege|altenheim|sozialstation|intensivpflege|(?:^|\s)pflege(?:\s|$)/i;

function explicitSegment(metadata?: Record<string, unknown> | null): LeadSegment | "" {
  const raw = String(metadata?.business_segment || metadata?.vertical || metadata?.segment || "").trim().toLowerCase();
  if (["pv", "photovoltaik", "solar", "pv-trust"].includes(raw)) return "pv";
  if (["pflege", "care", "pflege-recruiting"].includes(raw)) return "pflege";
  if (raw === "other" || raw === "unassigned") return "other";
  return "";
}

export function classifyLeadSegment(input: CompanySegmentInput): LeadSegment {
  const explicit = explicitSegment(input.metadata);
  const source = input.source || "";
  const identity = [input.company || input.name || "", input.industry || ""].join(" ");
  const pv = PV_SOURCE.test(source) || PV_IDENTITY.test(identity);
  const pflege = PFLEGE_SOURCE.test(source) || PFLEGE_IDENTITY.test(identity);
  // Importquellen, Firmenidentität und manuelle Branchenfelder können widersprüchlich sein.
  // Ein gespeichertes Segment darf solche Widersprüche niemals verdecken.
  if (pv && pflege) return "other";
  if (explicit === "pv" && pflege) return "other";
  if (explicit === "pflege" && pv) return "other";
  if (explicit) return explicit;
  if (pv) return "pv";
  if (pflege) return "pflege";
  return "other";
}

// Genau dieselbe Logik für SQL-Abfragen (kein Filtern nach Pagination).
export function leadSegmentSql(alias = "c") {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error("Invalid SQL alias");
  const source = "coalesce(" + alias + ".source,'')";
  const identity = "coalesce(" + alias + ".name,'') || ' ' || coalesce(" + alias + ".industry,'')";
  const metadata = alias + ".metadata";
  const explicit = "lower(coalesce(nullif(" + metadata + "->>'business_segment',''),nullif(" + metadata + "->>'vertical',''),nullif(" + metadata + "->>'segment',''),''))";
  const pv = "(" + source + " ~* '^(ba-pv$|pv[-_]|solar[-_]|photovoltaik)' or " + identity + " ~* '(photovolta|solar|solaranlag|solartechnik|pv[- /])')";
  const care = "(" + source + " ~* '^(ba-jobboerse$|pflegedienstjobs24$|pflege[-_])' or " + identity + " ~* '(pflegedienst|pflegeheim|pflegezentrum|pflegehaus|pflegeresidenz|pflegeteam|pflegeeinrichtung|pflegefach|senior|ambulant|krankenpflege|altenheim|sozialstation|intensivpflege|(^|[[:space:]])pflege([[:space:]]|$))')";
  return "(case " +
    "when " + explicit + " in ('other','unassigned') then 'other' " +
    "when " + pv + " and " + care + " then 'other' " +
    "when " + explicit + " in ('pv','photovoltaik','solar','pv-trust') and " + care + " then 'other' " +
    "when " + explicit + " in ('pflege','care','pflege-recruiting') and " + pv + " then 'other' " +
    "when " + explicit + " in ('pv','photovoltaik','solar','pv-trust') then 'pv' " +
    "when " + explicit + " in ('pflege','care','pflege-recruiting') then 'pflege' " +
    "when " + pv + " then 'pv' " +
    "when " + care + " then 'pflege' " +
    "else 'other' end)";
}
