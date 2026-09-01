import { haversineDistanceMeters } from "./geo";

/**
 * Finner stedet som ligger PÅ et koordinat — kafeen, parken, baren — slik at
 * et bilde kan vises med «Godt Brød» i stedet for «Thorvald Meyers gate 39».
 *
 * Google Places brukes når GOOGLE_PLACES_API_KEY er satt; det er klart mest
 * treffsikkert. Uten nøkkel brukes OpenStreetMap via Photon, med strenge
 * avstandskrav: målt mot bilder med kjent fasit bommer frie kilder ofte på
 * nabolokalet («McDonald's» for et bakeri tvers over gata), og et galt navn
 * er verre enn en adresse. Er vi ikke sikre, svarer vi null.
 */

export type Poi = {
  name: string;
  /** Kategori-id fra categories.ts, eller null når typen ikke passer noen. */
  categoryId: string | null;
};

const MAX_DISTANCE_METERS = 35;

/* ------------------------------------------------------------- Google */

/** Google-typene vi bryr oss om, i prioritert rekkefølge, med kategori. */
const GOOGLE_TYPES: Array<[string, string | null]> = [
  ["cafe", "kafe"],
  ["bakery", "kafe"],
  ["coffee_shop", "kafe"],
  ["restaurant", "restaurant"],
  ["bar", "restaurant"],
  ["meal_takeaway", "restaurant"],
  ["park", "park"],
  ["playground", "park"],
  ["dog_park", "park"],
  ["tourist_attraction", null],
  ["museum", null],
  ["stadium", null],
  ["swimming_pool", null],
  ["supermarket", null],
  ["store", null],
];

async function lookupGoogle(lat: number, lng: number, apiKey: string): Promise<Poi | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.types,places.location",
    },
    body: JSON.stringify({
      includedTypes: GOOGLE_TYPES.map(([t]) => t),
      maxResultCount: 5,
      rankPreference: "DISTANCE",
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: MAX_DISTANCE_METERS },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Google Places: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  }

  const data = (await res.json()) as {
    places?: Array<{
      displayName?: { text?: string };
      types?: string[];
      location?: { latitude: number; longitude: number };
    }>;
  };

  for (const place of data.places ?? []) {
    const name = place.displayName?.text;
    if (!name) continue;
    const match = GOOGLE_TYPES.find(([t]) => place.types?.includes(t));
    return { name, categoryId: match?.[1] ?? null };
  }
  return null;
}

/* ---------------------------------------------------------------- OSM */

/** OSM-taggene vi stoler på, i prioritert rekkefølge, med kategori. */
const OSM_TYPES: Array<[RegExp, string | null, number]> = [
  [/^amenity\/(cafe|ice_cream)$/, "kafe", 1],
  [/^shop\/bakery$/, "kafe", 1],
  [/^amenity\/(restaurant|bar|pub|fast_food|biergarten)$/, "restaurant", 1],
  [/^leisure\/(park|playground|garden)$/, "park", 1],
  [/^leisure\/(sports_centre|stadium|swimming_pool|water_park|pitch)$/, null, 2],
  [/^natural\/(water|beach)$/, null, 2],
  [/^tourism\/(attraction|museum|gallery)$/, null, 2],
  [/^shop\//, null, 3],
];

function osmMatch(key: string, value: string): { categoryId: string | null; rank: number } | null {
  const tag = `${key}/${value}`;
  for (const [re, categoryId, rank] of OSM_TYPES) {
    if (re.test(tag)) return { categoryId, rank };
  }
  return null;
}

async function lookupPhoton(lat: number, lng: number): Promise<Poi | null> {
  const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&limit=12`;
  const res = await fetch(url, { headers: { "User-Agent": "omradeportal/1.0" } });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    features?: Array<{
      properties: { name?: string; osm_key: string; osm_value: string };
      geometry?: { coordinates?: [number, number] };
    }>;
  };

  const candidates = (data.features ?? [])
    .flatMap((f) => {
      const name = f.properties.name;
      const match = osmMatch(f.properties.osm_key, f.properties.osm_value);
      const coords = f.geometry?.coordinates;
      if (!name || !match || !coords) return [];
      const distance = haversineDistanceMeters(
        { lat, lng },
        { lat: coords[1], lng: coords[0] }
      );
      return distance <= MAX_DISTANCE_METERS ? [{ name, match, distance }] : [];
    })
    .sort((a, b) => a.match.rank - b.match.rank || a.distance - b.distance);

  const best = candidates[0];
  return best ? { name: best.name, categoryId: best.match.categoryId } : null;
}

/* ------------------------------------------------------------- Felles */

export async function lookupPoi(lat: number, lng: number): Promise<Poi | null> {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (googleKey) {
    return lookupGoogle(lat, lng, googleKey);
  }
  try {
    return await lookupPhoton(lat, lng);
  } catch {
    return null;
  }
}
