import { haversineDistanceMeters } from "@/lib/geo";
import { CATEGORIES } from "@/lib/categories";
import { withBasePath } from "@/lib/site";
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
  indexPromise ??= fetch(withBasePath("/data/index.json")).then((r) => {
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
  bygardPromise ??= fetch(withBasePath("/data/adresse-til-bygard.json"))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return bygardPromise;
}

/** Adressene i bygårdsdataene står uten postnummer ("Toftes gate 10A"). */
function normalizeAddress(address: string): string {
  return address.split(",")[0].trim().replace(/\s+/g, " ");
}

export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
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
  const bygardId = bygardMap?.[normalizeAddress(address)] ?? null;

  const withDistance = index.photos
    .filter((p): p is PhotoEntry & { lat: number; lng: number } => p.lat !== null && p.lng !== null)
    .map((p) => ({
      ...p,
      distanceMeters: haversineDistanceMeters(center, { lat: p.lat, lng: p.lng }),
    }))
    // Bakgårder følger kvartalet, ikke avstanden: et gårdsrom hører til de
    // adressene som deler det, og ville ellers dukket opp i hele nabolaget.
    .filter((p) =>
      p.category === "bakgard"
        ? bygardId !== null && p.bygardId === bygardId
        : p.distanceMeters <= radiusMeters
    )
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
export async function suggest(query: string): Promise<Suggestion[]> {
  if (query.trim().length < 3) return [];

  const [oslo, nasjonalt] = await Promise.all([
    fetchGeonorge(query, OSLO_KOMMUNENUMMER).catch(() => []),
    fetchGeonorge(query).catch(() => []),
  ]);

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
