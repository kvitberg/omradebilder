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
  [/^shop\/(bakery|pastry|coffee)$/, "kafe", 1],
  [/^amenity\/(restaurant|bar|pub|fast_food|biergarten|food_court)$/, "restaurant", 1],
  [/^leisure\/(park|playground|garden|dog_park)$/, "park", 1],
  [/^railway\/(station|halt|tram_stop|subway_entrance)$/, "kollektiv", 1],
  [/^(public_transport|highway)\/(station|stop_position|platform|bus_stop)$/, "kollektiv", 1],
  [/^amenity\/(school|kindergarten|college|childcare)$/, "skole", 1],
  [/^amenity\/(cinema|theatre|library|arts_centre|community_centre)$/, "kultur", 1],
  [/^tourism\/(museum|gallery|artwork)$/, "kultur", 1],
  [/^shop\/(supermarket|convenience|greengrocer|butcher|mall|department_store)$/, "butikk", 1],
  [/^natural\/(water|beach|peak|wood|scrub)$/, "natur", 1],
  [/^leisure\/(nature_reserve|swimming_area|marina|beach_resort)$/, "natur", 1],
  [/^waterway\//, "natur", 2],
  [/^leisure\/(sports_centre|stadium|swimming_pool|water_park|pitch|fitness_centre|track|horse_riding)$/, "aktivitet", 1],
  [/^amenity\/(gym|public_bath)$/, "aktivitet", 1],
  [/^tourism\/(attraction|viewpoint)$/, "kultur", 2],
  [/^amenity\/place_of_worship$/, "kultur", 2],
  [/^highway\/(residential|pedestrian|living_street|unclassified|tertiary|secondary)$/, "nabolag", 5],
  [/^place\/(suburb|neighbourhood|quarter|borough|locality)$/, "nabolag", 3],
  [/^boundary\/administrative$/, "nabolag", 4],
  [/^shop\//, "butikk", 4],
];

function osmMatch(key: string, value: string): { categoryId: string | null; rank: number } | null {
  const tag = `${key}/${value}`;
  for (const [re, categoryId, rank] of OSM_TYPES) {
    if (re.test(tag)) return { categoryId, rank };
  }
  return null;
}

type PhotonFeature = {
  properties: { name?: string; osm_key: string; osm_value: string };
  geometry?: { coordinates?: [number, number] };
};

/**
 * Slår opp et sted ved navn, med koordinaten som geografisk vekt.
 *
 * Dette er veien for Dropbox-bildene, der mappenavnet ER stedsnavnet
 * ("Botsparken", "Nydalen T") men posisjonen bare er geokodet fra samme
 * navn — da sier et rent koordinat-oppslag lite nytt. Navnet må stemme
 * med det OSM svarer, ellers regner vi det som bom.
 */
export async function lookupPoiByName(
  name: string,
  lat: number,
  lng: number
): Promise<Poi | null> {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  // Mappenavn bærer ofte tillegg OSM ikke har: «Tøyen (1)» fra duplikate
  // mapper, og «Majorstuen T-bane» der stasjonen bare heter «Majorstuen».
  const ryddet =
    name
      .replace(/\s*\(\d+\)\s*$/, "")
      .replace(/\s+(t-banestasjon|t-bane|tbane|stasjon|holdeplass|T)\s*$/i, "")
      .trim() || name;
  const ønsket = norm(ryddet);

  const url = new URL("https://photon.komoot.io/api");
  url.searchParams.set("q", ryddet);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("limit", "8");

  try {
    const res = await fetch(url.toString(), { headers: { "User-Agent": "omradeportal/1.0" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { features?: PhotonFeature[] };

    const kandidater = (data.features ?? []).flatMap((f) => {
      const funnet = f.properties.name;
      const match = osmMatch(f.properties.osm_key, f.properties.osm_value);
      if (!funnet || !match) return [];

      const n = norm(funnet);
      let navnRang: number;
      if (n === ønsket) {
        navnRang = 0;
      } else if (n.startsWith(`${ønsket} `)) {
        // «Fomoto» → «Fomoto Kafé og Interiør»: samme sted, lengre offisielt
        // navn. Kravet om mellomrom skiller dette fra «Grønnland» →
        // «Grønnlandskjæret», som er et annet sted med felles ordstamme.
        navnRang = 1;
      } else {
        // Alt annet er en bom: «Bispevika» → «Jernia Bispevika» er butikken
        // i området, ikke området. Et galt navn er verre enn ingen kategori.
        return [];
      }

      // Et nabolag og en holdeplass deler ofte navn («Bjølsen», «Hasle»).
      // Mappa er da oppkalt etter strøket, så stedet slår stoppestedet.
      const tag = `${f.properties.osm_key}/${f.properties.osm_value}`;
      const erSted = /^place\//.test(tag);
      const erKollektiv = match.categoryId === "kollektiv";
      const vekt = erSted ? match.rank - 2.5 : erKollektiv ? match.rank + 1.5 : match.rank;

      return [{ name: funnet, match, sortering: navnRang * 10 + vekt }];
    });

    kandidater.sort((a, b) => a.sortering - b.sortering);
    const beste = kandidater[0];
    return beste ? { name: beste.name, categoryId: beste.match.categoryId } : null;
  } catch {
    return null;
  }
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
