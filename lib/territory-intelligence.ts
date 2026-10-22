import { createHash, randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { ensureSalesOsSchema, persistRadarLead } from "@/lib/sales-os";

export type EvidenceKind = "portal" | "portal_listing" | "ads" | "hiring" | "funnel" | "references" | "other";
export type TerritoryEvidence = {
  kind: EvidenceKind;
  url: string;
  note: string;
  addedAt: string;
  verification: "manual";
};
export type TerritoryCandidate = {
  id: string; source: string; county: string; state: string; name: string; city: string; website: string; phone: string;
  source_url: string; source_id: string; source_tags: Record<string, string>;
  evidence: TerritoryEvidence[]; score: number; crm_lead_id: string | null; updated_at: string;
};
export type TerritoryScan = {
  id: string; county: string; state: string; status: string; found_count: number; inserted_count: number;
  message: string; created_at: string; finished_at: string | null;
};

const EVIDENCE_POINTS: Record<EvidenceKind, number> = {
  portal: 25, portal_listing: 8, ads: 20, hiring: 15, funnel: 20, references: 10, other: 0,
};
const PV_NAME = /solar|photovoltaik|pv[- ]?anlagen|solartechnik|solarmontage/i;

let ready: Promise<void> | null = null;
export async function ensureTerritorySchema() {
  if (!ready) ready = (async () => {
    await ensureSalesOsSchema();
    await query(`
      create table if not exists dg_territory_scans (
        id uuid primary key, workspace text not null, county text not null, state text not null,
        status text not null default 'running', found_count int not null default 0,
        inserted_count int not null default 0, message text not null default '',
        created_at timestamptz not null default now(), finished_at timestamptz
      );
      create index if not exists dg_territory_scans_recent on dg_territory_scans(workspace, created_at desc);
      create table if not exists dg_territory_candidates (
        id uuid primary key, workspace text not null, source text not null, source_id text not null,
        county text not null, state text not null, name text not null, city text not null default '',
        website text not null default '', phone text not null default '', source_url text not null,
        source_tags jsonb not null default '{}'::jsonb,
        evidence jsonb not null default '[]'::jsonb, score int not null default 0,
        crm_lead_id text, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(workspace,source,source_id)
      );
      create index if not exists dg_territory_candidates_area on dg_territory_candidates(workspace,county,state,score desc);
    `);
  })().catch(error => { ready = null; throw error; });
  return ready;
}

function validWebsite(raw: string) {
  const value = raw.trim().split(";")[0];
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ["https:", "http:"].includes(url.protocol) ? url.href.slice(0, 600) : "";
  } catch { return ""; }
}
function baseScore(company: Pick<TerritoryCandidate, "name" | "website" | "phone" | "source_tags">) {
  const tags = company.source_tags || {};
  return 5 + (PV_NAME.test(company.name) || tags.craft === "solar_panel_installer" ? 15 : 0)
    + (company.website ? 5 : 0) + (company.phone ? 5 : 0);
}
export function evidenceScore(company: Pick<TerritoryCandidate, "name" | "website" | "phone" | "source_tags" | "evidence">) {
  const signals = new Set((company.evidence || []).map(e => e.kind));
  return Math.min(100, baseScore(company) + [...signals].reduce((n, kind) => n + EVIDENCE_POINTS[kind], 0));
}

type NominatimPlace = {
  osm_type: string; osm_id: number; display_name: string; type?: string;
  addresstype?: string; address?: { country_code?: string };
};
type OsmElement = { type: "node" | "way" | "relation"; id: number; tags?: Record<string, string> };

const HEADERS = {
  "User-Agent": "DigitaleGewinner-TerritoryScanner/1.0 (+https://digitalegewinner.de)",
  "Accept": "application/json",
};

async function discoverCounty(county: string, state: string) {
  const search = new URL("https://nominatim.openstreetmap.org/search");
  search.searchParams.set("q", `${county}, ${state}, Deutschland`);
  search.searchParams.set("format", "json");
  search.searchParams.set("addressdetails", "1");
  search.searchParams.set("limit", "8");
  const geocode = await fetch(search, { headers: HEADERS, signal: AbortSignal.timeout(18000), cache: "no-store" });
  if (!geocode.ok) throw new Error(`Landkreis-Suche nicht erreichbar (HTTP ${geocode.status}).`);
  const locations = await geocode.json() as NominatimPlace[];
  const expected = county.toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
  const place = locations.find(item => {
    const head = item.display_name.split(",")[0].toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
    return item.osm_type === "relation" && item.address?.country_code === "de" &&
      head === expected && ["county", "administrative", "state_district"].includes(item.addresstype || item.type || "");
  });
  if (!place) throw new Error("Kein eindeutig passender deutscher Landkreis gefunden. Namen und Bundesland bitte prüfen.");
  // OSM relation -> Overpass area; no arbitrary user-supplied URL or bounding box.
  const areaId = place.osm_id + 3600000000;
  const overpassQuery = `[out:json][timeout:35];area(${areaId})->.district;
  (nwr(area.district)["craft"~"^(electrician|solar_panel_installer)$"];
   nwr(area.district)["shop"="solar"];
   nwr(area.district)["name"~"Solar|Photovoltaik|Solartechnik|Elektrotechnik|Elektroinstallation",i];);
  out center 350;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: overpassQuery }),
    signal: AbortSignal.timeout(48000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`OpenStreetMap-Abfrage derzeit nicht verfügbar (HTTP ${response.status}).`);
  const payload = await response.json() as { elements?: OsmElement[] };
  return (payload.elements || []).filter(item => item.tags?.name && ["node", "way", "relation"].includes(item.type));
}

export async function listTerritory(county = "", state = "", workspace = "default") {
  await ensureTerritorySchema();
  const scans = await query<TerritoryScan>(
    `select id,county,state,status,found_count,inserted_count,message,created_at,finished_at
     from dg_territory_scans where workspace=$1 order by created_at desc limit 15`, [workspace],
  );
  const candidates = await query<TerritoryCandidate>(
    `select id,source,county,state,name,city,website,phone,source_url,source_id,source_tags,evidence,score,crm_lead_id,updated_at
     from dg_territory_candidates where workspace=$1
       and ($2::text='' or county=$2) and ($3::text='' or state=$3)
     order by score desc, updated_at desc limit 350`, [workspace, county, state],
  );
  return { scans, candidates, capped: candidates.length === 350 };
}

export async function scanCounty(county: string, state: string, workspace = "default") {
  await ensureTerritorySchema();
  const cached = await query<{ id: string }>(
    `select id from dg_territory_scans where workspace=$1 and county=$2 and state=$3
     and created_at > now()-interval '24 hours' and status='completed' limit 1`,
    [workspace, county, state],
  );
  if (cached.length) return { reused: true, found: 0, inserted: 0, message: "Landkreis heute bereits geprüft; gespeicherte Ergebnisse anzeigen." };
  const tooSoon = await query<{ id: string }>(
    `select id from dg_territory_scans where workspace=$1
       and created_at > now()-interval '2 minutes' limit 1`, [workspace],
  );
  if (tooSoon.length) throw new Error("Bitte mindestens zwei Minuten zwischen Landkreis-Abfragen lassen (öffentliche OSM-Dienste).");
  const id = randomUUID();
  await query(`insert into dg_territory_scans(id,workspace,county,state) values($1,$2,$3,$4)`, [id, workspace, county, state]);
  try {
    const elements = await discoverCounty(county, state);
    const rows = elements.map(el => {
      const tags = el.tags || {};
      return {
        id: randomUUID(), source_id: `${el.type}/${el.id}`, county, state,
        name: tags.name.slice(0, 240), city: (tags["addr:city"] || tags["addr:place"] || "").slice(0, 150),
        website: validWebsite(tags.website || tags["contact:website"] || ""),
        phone: (tags.phone || tags["contact:phone"] || "").slice(0, 120),
        source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
        source_tags: tags,
        score: baseScore({ name: tags.name, website: validWebsite(tags.website || tags["contact:website"] || ""),
          phone: tags.phone || tags["contact:phone"] || "", source_tags: tags }),
      };
    }).filter(x => x.name);
    let inserted = 0;
    if (rows.length) {
      const saved = await query<{ inserted: boolean }>(`
        insert into dg_territory_candidates
          (id,workspace,source,source_id,county,state,name,city,website,phone,source_url,source_tags,score)
        select x.id,$1,'openstreetmap',x.source_id,x.county,x.state,x.name,x.city,x.website,x.phone,
          x.source_url,x.source_tags,x.score
        from jsonb_to_recordset($2::jsonb) as x (
          id uuid,source_id text,county text,state text,name text,city text,website text,phone text,
          source_url text,source_tags jsonb,score integer)
        on conflict(workspace,source,source_id) do update set
          county=excluded.county,state=excluded.state,name=excluded.name,city=excluded.city,
          website=case when excluded.website<>'' then excluded.website else dg_territory_candidates.website end,
          phone=case when excluded.phone<>'' then excluded.phone else dg_territory_candidates.phone end,
          source_tags=excluded.source_tags,updated_at=now()
        returning (xmax=0) as inserted
      `, [workspace, JSON.stringify(rows)]);
      inserted = saved.filter(x => x.inserted).length;
    }
    const message = "OSM-Teilstichprobe: nicht alle PV-Betriebe des Landkreises. Portalnutzung und Werbeaktivität bleiben ungeprüft.";
    await query(`update dg_territory_scans set status='completed', found_count=$2,inserted_count=$3,message=$4,finished_at=now() where id=$1`,
      [id, rows.length, inserted, message]);
    return { reused: false, found: rows.length, inserted, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan fehlgeschlagen.";
    await query(`update dg_territory_scans set status='failed',message=$2,finished_at=now() where id=$1`, [id, message]);
    throw error;
  }
}

export async function addTerritoryEvidence(id: string, kind: EvidenceKind, url: string, note: string, workspace = "default") {
  await ensureTerritorySchema();
  const rows = await query<TerritoryCandidate>(
    `select id,source,county,state,name,city,website,phone,source_url,source_id,source_tags,evidence,score,crm_lead_id,updated_at
     from dg_territory_candidates where workspace=$1 and id=$2 limit 1`, [workspace, id],
  );
  const row = rows[0];
  if (!row) throw new Error("Firma nicht gefunden.");
  const evidence = Array.isArray(row.evidence) ? row.evidence : [];
  if (evidence.some(item => item.kind === kind && item.url === url)) throw new Error("Diese Quelle wurde bereits eingetragen.");
  const next: TerritoryEvidence[] = [...evidence, { kind, url, note, addedAt: new Date().toISOString(), verification: "manual" }];
  const score = evidenceScore({ ...row, evidence: next });
  await query(`update dg_territory_candidates set evidence=$3::jsonb,score=$4,updated_at=now() where workspace=$1 and id=$2`,
    [workspace, id, JSON.stringify(next), score]);
  if (row.crm_lead_id) {
    await query(`update sales_leads set priority_score=greatest(priority_score,$3),updated_at=now()
      where workspace=$1 and id=$2 and status='active'`, [workspace, row.crm_lead_id, score]);
  }
  return { score, evidence: next };
}

export async function importTerritoryCandidate(id: string, workspace = "default") {
  await ensureTerritorySchema();
  const rows = await query<TerritoryCandidate>(
    `select id,source,county,state,name,city,website,phone,source_url,source_id,source_tags,evidence,score,crm_lead_id,updated_at
     from dg_territory_candidates where workspace=$1 and id=$2 limit 1`, [workspace, id],
  );
  const row = rows[0];
  if (!row) throw new Error("Firma nicht gefunden.");
  if (row.crm_lead_id) return { leadId: row.crm_lead_id, alreadyImported: true };
  // Existing CRM record: never overwrite call notes, exclusions or lead stage.
  const domain = (() => { try { return row.website ? new URL(row.website).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { return ""; } })();
  const sourceId = row.source === "openstreetmap" ? `osm:${row.source_id}` : `manual:${row.source_id}`;
  const existing = await query<{ id: string }>(
    `select l.id from sales_leads l join sales_companies c on c.id=l.company_id
     where l.workspace=$1 and l.status='active' and
       ((c.source=$2 and c.source_id=$3) or ($4::text<>'' and c.domain=$4))
     limit 1`, [workspace, row.source, sourceId, domain],
  );
  let leadId = existing[0]?.id;
  if (!leadId) {
    const industry = ["Ambulante Pflege", "Intensivpflege", "Stationäre Pflege"].includes(row.source_tags?.industry)
      ? row.source_tags.industry : "Photovoltaik / Elektro";
    const result = await persistRadarLead({
      id: sourceId, company: row.name, city: row.city || row.county,
      website: row.website, phone: row.phone, industry,
      email: row.source_tags?.publicEmail || "",
      source: row.source,
    }, {});
    leadId = result.leadId;
    await query(`update sales_leads set notes=$3 where workspace=$1 and id=$2`,
      [workspace, leadId, `Landkreis-Scanner: ${row.county} (${row.state}). Quelle: ${row.source_url}. Portalnutzung nicht bestätigt. Evidenz in der Landkreis-Ansicht prüfen.`]);
  }
  await query(`update dg_territory_candidates set crm_lead_id=$3,updated_at=now() where workspace=$1 and id=$2`,
    [workspace, id, leadId]);
  await query(`update sales_leads set priority_score=greatest(priority_score,$3),updated_at=now()
    where workspace=$1 and id=$2 and status='active'`, [workspace, leadId, row.score]);
  return { leadId, alreadyImported: Boolean(existing.length) };
}

/** Add a company with its original public source URL even if OSM has no record. */
export async function addSourcedCompany(input: {
  county: string; state: string; name: string; city: string;
  website: string; phone: string; sourceUrl: string; industry?: string; email?: string;
}, workspace = "default") {
  await ensureTerritorySchema();
  const website = validWebsite(input.website);
  const source = new URL(input.sourceUrl);
  if (!["http:", "https:"].includes(source.protocol)) throw new Error("Quelle muss eine HTTP(S)-URL sein.");
  const fingerprint = createHash("sha256").update(
    [input.name.toLocaleLowerCase("de-DE").trim(), input.county.toLocaleLowerCase("de-DE").trim(), website].join("|"),
  ).digest("hex").slice(0, 32);
  const tags: Record<string,string> = { provenance: "manual-public-source" };
  tags.industry = ["Ambulante Pflege", "Intensivpflege", "Stationäre Pflege"].includes(input.industry || "")
    ? input.industry! : "Photovoltaik / Elektro";
  if (input.email) tags.publicEmail = input.email;
  const score = baseScore({ name: input.name, website, phone: input.phone, source_tags: tags });
  const rows = await query<{ id: string }>(`
    insert into dg_territory_candidates
      (id,workspace,source,source_id,county,state,name,city,website,phone,source_url,source_tags,score)
    values($1,$2,'manual-source',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
    on conflict(workspace,source,source_id) do update set
      source_url=excluded.source_url,updated_at=now()
    returning id
  `, [randomUUID(), workspace, fingerprint, input.county, input.state, input.name, input.city,
    website, input.phone, source.href, JSON.stringify(tags), score]);
  return { candidateId: rows[0]?.id };
}
