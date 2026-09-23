import { haversineDistanceMeters } from "@/lib/geo";
import { CATEGORIES } from "@/lib/categories";
import { dataUrl, withBasePath } from "@/lib/site";
import type { SearchIndex, PhotoEntry } from "@/lib/index-store";

/**
 * Søket kjører i nettleseren, ikke på en server.
 *
 * Siden publiseres som statiske filer på GitHub Pages, der det ikke finnes
 * noe serverledd å legge API-ruter i. Indeksen og bygårdsdataene lastes
 * derfor ned én gang og holdes i minnet i fanen.
 */

const DEFAULT_RADIUS_METERS = 1000;

export type Category = { id: string; label: string; description: string };

export type SearchPhoto = {
  id: string;
  placeName: string;
  distanceMeters: number;
  thumb: string | null;
  /** Til kartet på første oppslag. */
  lat: number;
  lng: number;
  /** Originalfil i full størrelse, når en delingslenke finnes. */
  original: string | null;
  filnavn: string | null;
};

export type Group = { category: Category; photos: SearchPhoto[] };

export type SearchResult = {
  center: { lat: number; lng: number };
  groups: Group[];
  warning?: string;
};

export class SearchError extends Error {}

let indexPromise: Promise<SearchIndex> | null = null;
let bygardPromise: Promise<Record<string, string> | null> | null = null;

function loadIndex(): Promise<SearchIndex> {
  indexPromise ??= fetch(dataUrl("/data/index.json")).then((r) => {
    if (!r.ok) throw new SearchError("Fant ingen bildeindeks");
    return r.json();
  });
  return indexPromise;
}

/**
 * Kartet fra adresse til bygård er stort, og trengs bare for bakgårder.
 * Det hentes derfor separat, og en feil her skal ikke stoppe resten av søket.
 */
function loadBygardMap(): Promise<Record<string, string> | null> {
  bygardPromise ??= fetch(dataUrl("/data/adresse-til-bygard.json"))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return bygardPromise;
}

/** Adressene i bygårdsdataene står uten postnummer ("Toftes gate 10A"). */
/**
 * Gateadressen alene, uten postnummer, sted og land.
 *
 * Adressen kan komme fra vårt eget forslag («Hans Nielsen Hauges gate 18,
 * 0481 OSLO»), men også limt inn fra et kart («Hans Nielsen Hauges gate 18
 * 0481 Oslo, Norway»). Uten dette ble kvartalet ikke funnet, og bilder som
 * hører til en bygård forsvant helt fra treffet.
 */
function normalizeAddress(address: string): string {
  return address
    .split(/[,\n]/)[0]
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s+\d{4}\s+\p{L}[\p{L}\s.'-]*$/u, "")
    .trim();
}

/** Slår opp kvartalet uten å bry seg om store og små bokstaver. */
function finnBygard(kart: Record<string, string> | null, adresse: string): string | null {
  if (!kart) return null;
  if (kart[adresse]) return kart[adresse];
  const nøkkel = adresse.toLowerCase();
  for (const [a, id] of Object.entries(kart)) {
    if (a.toLowerCase() === nøkkel) return id;
  }
  return null;
}

/**
 * Skrivemåter å prøve, fra det brukeren skrev til det enkleste.
 *
 * Kartverket finner «Hans Nielsen Hauges gate 18 0481 Oslo», men ikke
 * samme adresse med «, Norway» bakpå — og en adresse limt inn fra et kart
 * har gjerne det. Da sa portalen «Fant ikke adressen».
 */
function søkevarianter(query: string): string[] {
  const ren = query.trim().replace(/\s+/g, " ");
  const utenLand = ren.replace(/,\s*(norway|norge|nor)\s*$/i, "").trim();
  const bareGate = normalizeAddress(ren);
  return [...new Set([ren, utenLand, bareGate].filter(Boolean))];
}

async function geokodeEn(query: string): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://ws.geonorge.no/adresser/v1/sok");
  url.searchParams.set("sok", query);
  url.searchParams.set("treffPerSide", "1");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();
    const p = data?.adresser?.[0]?.representasjonspunkt;
    if (typeof p?.lat === "number" && typeof p?.lon === "number") {
      return { lat: p.lat, lng: p.lon };
    }
  } catch {
    /* faller gjennom */
  }
  return null;
}

export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  for (const variant of søkevarianter(query)) {
    const treff = await geokodeEn(variant);
    if (treff) return treff;
  }
  return null;
}

export async function search(
  address: string,
  radiusMeters = DEFAULT_RADIUS_METERS,
  coords?: { lat: number; lng: number } | null
): Promise<SearchResult> {
  const center = coords ?? (await geocode(address));
  if (!center) {
    throw new SearchError("Fant ikke adressen");
  }

  const index = await loadIndex();
  const bygardMap = await loadBygardMap();
  const søktAdresse = normalizeAddress(address);
  const bygardId = finnBygard(bygardMap, søktAdresse);

  const withDistance = index.photos
    .filter((p): p is PhotoEntry & { lat: number; lng: number } => p.lat !== null && p.lng !== null)
    .map((p) => ({
      ...p,
      distanceMeters: haversineDistanceMeters(center, { lat: p.lat, lng: p.lng }),
    }))
    // Et bilde bundet til en adresse eller et kvartal er et fellesareal —
    // gårdsrom, takterrasse eller fasade — og hører til dem som deler
    // bygningen, ikke til alle innen gangavstand. Adressen er den presise
    // koblingen; kvartalet fanger naboene rundt samme gårdsrom. Mangler
    // begge, falt oppslaget gjennom, og avstand er det beste vi har.
    .filter((p) => {
      if (p.adresser?.length) {
        const treffer = p.adresser.some((a) => a.toLowerCase() === søktAdresse.toLowerCase());
        return treffer || (!!p.bygardId && p.bygardId === bygardId);
      }
      if (p.bygardId) return bygardId !== null && p.bygardId === bygardId;
      return p.distanceMeters <= radiusMeters;
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const groups: Group[] = CATEGORIES.map((category) => ({
    category: { id: category.id, label: category.label, description: category.description },
    photos: withDistance
      .filter((p) => p.category === category.id)
      .map((p) => ({
        id: p.id,
        placeName: p.placeName,
        distanceMeters: Math.round(p.distanceMeters),
        thumb: p.thumb ? withBasePath(p.thumb) : null,
        lat: p.lat,
        lng: p.lng,
        original: p.original ?? null,
        filnavn: p.filnavn ?? null,
      })),
  })).filter((g) => g.photos.length > 0);

  return { center, groups };
}

export type Suggestion = { label: string; lat: number; lng: number };

const OSLO_KOMMUNENUMMER = "0301";
const MAX_SUGGESTIONS = 6;
const OSLO_SLOTS = 4;

type GeonorgeAdresse = {
  adressetekst?: string;
  postnummer?: string;
  poststed?: string;
  representasjonspunkt?: { lat?: number; lon?: number };
};

function toSuggestion(a: GeonorgeAdresse): Suggestion | null {
  const lat = a.representasjonspunkt?.lat;
  const lng = a.representasjonspunkt?.lon;
  if (typeof lat !== "number" || typeof lng !== "number" || !a.adressetekst) return null;
  const place = [a.postnummer, a.poststed].filter(Boolean).join(" ");
  return { label: place ? `${a.adressetekst}, ${place}` : a.adressetekst, lat, lng };
}

async function fetchGeonorge(query: string, kommunenummer?: string): Promise<Suggestion[]> {
  const url = new URL("https://ws.geonorge.no/adresser/v1/sok");
  url.searchParams.set("sok", query);
  url.searchParams.set("treffPerSide", String(MAX_SUGGESTIONS));
  url.searchParams.set("asciiKompatibel", "true");
  if (kommunenummer) url.searchParams.set("kommunenummer", kommunenummer);

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const data = await res.json();
  return ((data?.adresser ?? []) as GeonorgeAdresse[])
    .map(toSuggestion)
    .filter((s): s is Suggestion => s !== null);
}

/**
 * Søkes det på et navn som finnes flere steder i landet, kan Oslo-treffene
 * falle helt ut av det nasjonale svaret. Derfor gjøres et eget Oslo-kall
 * parallelt, og Oslo-treffene legges øverst.
 */
/**
 * Nærmeste offisielle adresse til et punkt, for markøren man drar på
 * kartet. Kartverkets punktsøk utvider sirkelen til den finner noe —
 * midt i Marka kan nærmeste adresse ligge langt unna.
 */
export async function adresseVedPunkt(lat: number, lng: number): Promise<Suggestion | null> {
  for (const radius of [60, 200, 600, 2000]) {
    const url = new URL("https://ws.geonorge.no/adresser/v1/punktsok");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("radius", String(radius));
    url.searchParams.set("treffPerSide", "1");
    try {
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data = await res.json();
      const a = data?.adresser?.[0];
      const p = a?.representasjonspunkt;
      if (a?.adressetekst && typeof p?.lat === "number" && typeof p?.lon === "number") {
        const sted = [a.postnummer, a.poststed].filter(Boolean).join(" ");
        return { label: sted ? `${a.adressetekst}, ${sted}` : a.adressetekst, lat: p.lat, lng: p.lon };
      }
    } catch {
      /* prøv en større sirkel */
    }
  }
  return null;
}

export async function suggest(query: string): Promise<Suggestion[]> {
  if (query.trim().length < 3) return [];

  // Samme rydding som ved søk, ellers gir en innlimt adresse ingen forslag.
  const [beste] = søkevarianter(query);
  const [oslo, nasjonalt] = await Promise.all([
    fetchGeonorge(beste, OSLO_KOMMUNENUMMER).catch(() => []),
    fetchGeonorge(beste).catch(() => []),
  ]);
  if (!oslo.length && !nasjonalt.length) {
    const enklere = søkevarianter(query).slice(1);
    for (const variant of enklere) {
      const treff = await fetchGeonorge(variant, OSLO_KOMMUNENUMMER).catch(() => []);
      if (treff.length) return treff.slice(0, MAX_SUGGESTIONS);
    }
  }

  const seen = new Set<string>();
  const result: Suggestion[] = [];
  const add = (s: Suggestion) => {
    if (seen.has(s.label) || result.length >= MAX_SUGGESTIONS) return;
    seen.add(s.label);
    result.push(s);
  };

  oslo.slice(0, OSLO_SLOTS).forEach(add);
  nasjonalt.forEach(add);
  oslo.forEach(add);
  return result;
}

/** Et tilfeldig bilde med miniatyr, til den nedtonede forsidebakgrunnen. */
export async function randomCoverThumb(): Promise<string | null> {
  try {
    const index = await loadIndex();
    const pool = index.photos.filter((p) => p.thumb);
    if (!pool.length) return null;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return pick.thumb ? withBasePath(pick.thumb) : null;
  } catch {
    return null;
  }
}
