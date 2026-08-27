import { z } from "zod";
import { getSecret } from "@/lib/secrets";

export const runtime = "nodejs";

const schema = z.object({
  query: z.string().min(3).max(300),
  pageSize: z.number().int().min(1).max(20).default(20),
  pageToken: z.string().max(1000).optional().default(""),
});

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };
type Place = {
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

function component(place: Place, type: string) {
  return place.addressComponents?.find((item) => item.types?.includes(type))?.longText || "";
}

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const key = process.env.GOOGLE_MAPS_API_KEY || await getSecret("google_maps_api_key");
    if (!key) return Response.json({ error: "Google Maps / Places API ist noch nicht verbunden." }, { status: 503 });

    const body: Record<string, unknown> = {
      textQuery: input.query,
      pageSize: input.pageSize,
      languageCode: "de",
      regionCode: "DE",
    };
    if (input.pageToken) body.pageToken = input.pageToken;

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
    if (!response.ok) return Response.json({ error: `Google Places Fehler (${response.status}).` }, { status: 502 });

    const data = await response.json() as { places?: Place[]; nextPageToken?: string };
    const leads = (data.places || []).map((place) => ({
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
      employees: 0,
      roofArea: 0,
      pvExisting: false,
      energyScore: 0,
      intentScore: 0,
      stage: "Research",
      dealValue: 0,
      notes: "Quelle: Google Places · Deutschland Coverage Radar",
      lat: place.location?.latitude,
      lng: place.location?.longitude,
      rating: Number(place.rating || 0),
      reviewCount: Number(place.userRatingCount || 0),
      businessStatus: place.businessStatus || "",
    }));

    return Response.json({ leads, count: leads.length, nextPageToken: data.nextPageToken || "" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lead-Suche fehlgeschlagen." }, { status: 400 });
  }
}
