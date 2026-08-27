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

type OsmGeo = { lat: string; lon: string; display_name: string; boundingbox?: string[] };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;
const OSM_USER_AGENT = "DigitaleGewinner-PflegeRadar/1.2 (business research; digitalegewinner.de)";
const osmCache = new Map<string, { expiresAt: number; value: DiscoveryResult }>();
const osmInFlight = new Map<string, Promise<DiscoveryResult>>();

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
    signal: AbortSignal.timeout(12_000),
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
    industry: place.primaryTypeDisplayName?.text || "Pflege",
    lat: place.location?.latitude,
    lng: place.location?.longitude,
    rating: Number(place.rating || 0),
    reviewCount: Number(place.userRatingCount || 0),
    businessStatus: place.businessStatus || "",
    source: "google-places" as const,
  }));
  return { leads, nextPageToken: json.nextPageToken || "", source: "google-places" };
}

function osmScope(place: OsmGeo) {
  const box = (place.boundingbox || []).map(Number);
  if (box.length === 4 && box.every(Number.isFinite)) {
    const [south, north, west, east] = box;
    const latSpan = Math.abs(north - south);
    const lonSpan = Math.abs(east - west);
    if (latSpan > 0.01 && lonSpan > 0.01 && latSpan < 0.8 && lonSpan < 0.8) return `(${south},${west},${north},${east})`;
  }
  return `(around:16000,${Number(place.lat)},${Number(place.lon)})`;
}

async function requestOverpass(body: URLSearchParams) {
  let lastError = "OpenStreetMap Lead-Suche fehlgeschlagen.";
  for (let index = 0; index < OVERPASS_ENDPOINTS.length; index += 1) {
    const endpoint = OVERPASS_ENDPOINTS[index];
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": OSM_USER_AGENT },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(index === 0 ? 8_000 : 7_000),
      });
      if (!response.ok) { lastError = `OpenStreetMap Lead-Suche ist ausgelastet (${response.status}).`; continue; }
      return await response.json() as { elements?: OsmElement[] };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

async function osmSearch(query: string, pageSize: number, locationHint?: string): Promise<DiscoveryResult> {
  const location = clean(locationHint) || inferLocation(query) || "Deutschland";
  const geoUrl = new URL(NOMINATIM);
  geoUrl.searchParams.set("q", location);
  geoUrl.searchParams.set("format", "jsonv2");
  geoUrl.searchParams.set("limit", "1");
  geoUrl.searchParams.set("countrycodes", "de");
  geoUrl.searchParams.set("addressdetails", "1");
  const geo = await fetch(geoUrl, { headers: { "User-Agent": OSM_USER_AGENT, "Accept-Language": "de" }, cache: "no-store", signal: AbortSignal.timeout(6_000) });
  if (!geo.ok) throw new Error(`OpenStreetMap Geocoding fehlgeschlagen (${geo.status}).`);
  const places = await geo.json() as OsmGeo[];
  if (!places[0]) throw new Error(`Region „${location}“ wurde nicht gefunden.`);

  const scope = osmScope(places[0]);
  const blocks = [
    `nwr["name"~"Pflege|Pflegedienst|Sozialstation|Ambulante Pflege|Intensivpflege",i]${scope};`,
    `nwr["social_facility"~"ambulatory_care|outreach",i]${scope};`,
    `nwr["healthcare"="home_care"]${scope};`,
  ].join("\n");
  const overpassQuery = `[out:json][timeout:9];(${blocks});out center tags ${Math.min(120, Math.max(50, pageSize * 5))};`;
  const payload = await requestOverpass(new URLSearchParams({ data: overpassQuery }));
  const seen = new Set<string>();
  const leads: DiscoveredBusiness[] = [];
  for (const element of payload.elements || []) {
    const tags = element.tags || {};
    const company = first(tags, ["name", "brand", "operator"]);
    if (!company) continue;
    const industry = first(tags, ["healthcare", "social_facility", "office", "amenity"]);
    if (!isPflegeText(`${company} ${industry} ${tags.description || ""}`)) continue;
    const website = normalizeWebsite(first(tags, ["contact:website", "website", "url"]));
    const city = first(tags, ["addr:city", "addr:place"]) || location.split(",")[0].trim();
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

async function cachedOsmSearch(query: string, pageSize: number, locationHint?: string) {
  const locationKey = (clean(locationHint) || inferLocation(query) || "Deutschland").toLowerCase();
  const key = `${locationKey}|${pageSize}`;
  const cached = osmCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const running = osmInFlight.get(key);
  if (running) return running;
  const promise = osmSearch(query, pageSize, locationHint);
  osmInFlight.set(key, promise);
  try {
    const value = await promise;
    osmCache.set(key, { expiresAt: Date.now() + 10 * 60_000, value });
    return value;
  } finally {
    osmInFlight.delete(key);
  }
}

export async function discoverBusinesses(input: { query: string; pageSize?: number; pageToken?: string; locationHint?: string }): Promise<DiscoveryResult> {
  const pageSize = Math.max(1, Math.min(20, Math.round(input.pageSize || 20)));
  const key = process.env.GOOGLE_MAPS_API_KEY || await getSecret("google_maps_api_key");
  if (key) {
    try { return await googleSearch(input.query, pageSize, input.pageToken || "", key); }
    catch (error) {
      if (input.pageToken) throw error;
      const fallback = await cachedOsmSearch(input.query, pageSize, input.locationHint);
      return { ...fallback, warning: `Google Places war nicht verfügbar; Fallback aktiv. ${error instanceof Error ? error.message : ""}`.trim() };
    }
  }
  return cachedOsmSearch(input.query, pageSize, input.locationHint);
}
