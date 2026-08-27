import { getSecret } from "@/lib/secrets";

export type DiscoveredBusiness = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  website: string;
  city: string;
  address: string;
  state: string;
  postalCode: string;
  industry: string;
  lat?: number;
  lng?: number;
  rating: number;
  reviewCount: number;
  businessStatus: string;
  source: "google-places" | "openstreetmap";
};

export type DiscoveryResult = {
  leads: DiscoveredBusiness[];
  nextPageToken: string;
  source: "google-places" | "openstreetmap";
  warning?: string;
};

type AddressComponent = { longText?: string; types?: string[] };
type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  addressComponents?: AddressComponent[];
  businessStatus?: string;
  rating?: number;
  userRatingCount?: number;
};

type OsmElement = {
  id: number;
  type: "node" | "way" | "relation";
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS = "https://overpass-api.de/api/interpreter";
const OSM_USER_AGENT = "DigitaleGewinner-PflegeRadar/1.0 (business research; digitalegewinner.de)";

function component(place: GooglePlace, type: string) {
  return place.addressComponents?.find((item) => item.types?.includes(type))?.longText || "";
}
function clean(value?: string) { return String(value || "").trim(); }
function first(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) if (clean(tags[key])) return clean(tags[key]);
  return "";
}
function normalizeWebsite(value: string) { return !value ? "" : /^https?:\/\//i.test(value) ? value : `https://${value}`; }
function address(tags: Record<string, string>) { return [tags["addr:street"], tags["addr:housenumber"]].filter(Boolean).join(" "); }
function inferLocation(query: string) {
  return query
    .replace(/ambulanter?\s+pflegedienst/gi, "")
    .replace(/intensivpflegedienst/gi, "")
    .replace(/intensivpflege/gi, "")
    .replace(/ambulante\s+pflege/gi, "")
    .replace(/häusliche\s+pflege/gi, "")
    .replace(/haeusliche\s+pflege/gi, "")
    .replace(/sozialstation/gi, "")
    .replace(/pflegedienst/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
function isPflegeText(value: string) {
  const v = value.toLowerCase();
  const include = /(pflege|sozialstation|ambulant|intensiv|häuslich|haeuslich|home care|home health)/i.test(v);
  const exclude = /(pflegeheim|seniorenheim|seniorenresidenz|wohnpark|krankenhaus|klinik|apotheke|physio|arztpraxis|sanitätshaus|sanitaetshaus)/i.test(v);
  return include && !exclude;
}

async function googleSearch(query: string, pageSize: number, pageToken: string, key: string): Promise<DiscoveryResult> {
  const body: Record<string, unknown> = { textQuery: query, pageSize, languageCode: "de", regionCode: "DE" };
  if (pageToken) body.pageToken = pageToken;
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.primaryTypeDisplayName,places.location,places.addressComponents,places.businessStatus,places.rating,places.userRatingCount,nextPageToken",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google Places Fehler (${response.status}).`);
  const json = await response.json() as { places?: GooglePlace[]; nextPageToken?: string };
  const leads = (json.places || []).map((place) => ({
    id: place.id || crypto.randomUUID(),
    company: place.displayName?.text || "Unbekannt",
    contact: "",
    email: "",
    phone: place.nationalPhoneNumber || place.internationalPhoneNumber || "",
    website: place.websiteUri || "",
    city: component(place, "locality") || component(place, "postal_town") || place.formattedAddress || "",
    address: place.formattedAddress || "",
    state: component(place, "administrative_area_level_1"),
    postalCode: component(place, "postal_code"),
    industry: place.primaryTypeDisplayName?.text || "",
    lat: place.location?.latitude,
    lng: place.location?.longitude,
    rating: Number(place.rating || 0),
    reviewCount: Number(place.userRatingCount || 0),
    businessStatus: place.businessStatus || "",
    source: "google-places" as const,
  }));
  return { leads, nextPageToken: json.nextPageToken || "", source: "google-places" };
}

async function osmSearch(query: string, pageSize: number, locationHint?: string): Promise<DiscoveryResult> {
  const location = clean(locationHint) || inferLocation(query) || "Deutschland";
  const geoUrl = new URL(NOMINATIM);
  geoUrl.searchParams.set("q", location);
  geoUrl.searchParams.set("format", "jsonv2");
  geoUrl.searchParams.set("limit", "1");
  geoUrl.searchParams.set("countrycodes", "de");
  geoUrl.searchParams.set("addressdetails", "1");
  const geo = await fetch(geoUrl, { headers: { "User-Agent": OSM_USER_AGENT, "Accept-Language": "de" }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!geo.ok) throw new Error(`OpenStreetMap Geocoding fehlgeschlagen (${geo.status}).`);
  const places = await geo.json() as Array<{ lat: string; lon: string; display_name: string }>;
  if (!places[0]) throw new Error(`Region „${location}“ wurde nicht gefunden.`);
  const lat = Number(places[0].lat), lon = Number(places[0].lon), radius = 32_000;
  const filters = [
    '["name"~"Pflege|Pflegedienst|Sozialstation|Ambulante Pflege|Intensivpflege",i]',
    '["social_facility"="ambulatory_care"]',
    '["social_facility"="outreach"]',
    '["healthcare"="home_care"]',
    '["office"="healthcare"]["name"]',
  ];
  const blocks = filters.flatMap((filter) => [
    `node(around:${radius},${lat},${lon})${filter};`,
    `way(around:${radius},${lat},${lon})${filter};`,
    `relation(around:${radius},${lat},${lon})${filter};`,
  ]).join("\n");
  const overpassQuery = `[out:json][timeout:25];(${blocks});out center tags ${Math.min(300, Math.max(80, pageSize * 8))};`;
  const over = await fetch(OVERPASS, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": OSM_USER_AGENT },
    body: new URLSearchParams({ data: overpassQuery }),
    cache: "no-store",
    signal: AbortSignal.timeout(28_000),
  });
  if (!over.ok) throw new Error(`OpenStreetMap Lead-Suche ist ausgelastet (${over.status}).`);
  const payload = await over.json() as { elements?: OsmElement[] };
  const seen = new Set<string>();
  const leads: DiscoveredBusiness[] = [];
  for (const element of payload.elements || []) {
    const tags = element.tags || {};
    const company = first(tags, ["name", "brand", "operator"]);
    if (!company) continue;
    const industry = first(tags, ["healthcare", "social_facility", "office", "amenity"]);
    if (!isPflegeText(`${company} ${industry} ${tags.description || ""}`)) continue;
    const website = normalizeWebsite(first(tags, ["contact:website", "website", "url"]));
    const city = first(tags, ["addr:city", "addr:place"]) || location;
    const phone = first(tags, ["contact:phone", "phone", "contact:mobile"]);
    const key = `${company.toLowerCase()}|${city.toLowerCase()}|${website.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      id: `osm:${element.type}/${element.id}`,
      company,
      contact: "",
      email: first(tags, ["contact:email", "email"]),
      phone,
      website,
      city,
      address: [address(tags), city].filter(Boolean).join(", "),
      state: first(tags, ["addr:state"]),
      postalCode: first(tags, ["addr:postcode"]),
      industry: industry || "Pflege",
      lat: element.lat ?? element.center?.lat,
      lng: element.lon ?? element.center?.lon,
      rating: 0,
      reviewCount: 0,
      businessStatus: "",
      source: "openstreetmap",
    });
    if (leads.length >= pageSize) break;
  }
  return {
    leads,
    nextPageToken: "",
    source: "openstreetmap",
    warning: "Google Places ist nicht verbunden – Discovery läuft über OpenStreetMap/Overpass. Für maximale Abdeckung Google Places zusätzlich verbinden.",
  };
}

export async function discoverBusinesses(input: { query: string; pageSize?: number; pageToken?: string; locationHint?: string }): Promise<DiscoveryResult> {
  const pageSize = Math.max(1, Math.min(20, Math.round(input.pageSize || 20)));
  const key = process.env.GOOGLE_MAPS_API_KEY || await getSecret("google_maps_api_key");
  if (key) {
    try { return await googleSearch(input.query, pageSize, input.pageToken || "", key); }
    catch (error) {
      if (input.pageToken) throw error;
      const fallback = await osmSearch(input.query, pageSize, input.locationHint);
      return { ...fallback, warning: `Google Places war nicht verfügbar; Fallback aktiv. ${error instanceof Error ? error.message : ""}`.trim() };
    }
  }
  return osmSearch(input.query, pageSize, input.locationHint);
}
