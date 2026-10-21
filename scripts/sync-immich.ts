import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { categoryFromTags, detectCategory } from "../src/lib/categories";
import { lookupPoiStatus, type Poi, type Stedsoppslag } from "../src/lib/poi";
import { stedVedPunkt } from "../src/lib/parker";
import type { PhotoEntry, SearchIndex } from "../src/lib/index-store";
import { lagThumbnavn } from "../src/lib/thumbs";

/**
 * Henter bilder fra et delt Immich-album og fletter dem inn i indeksen.
 *
 * Immich er en mye bedre kilde enn Dropbox-mappa der den finnes: bildene har
 * GPS i EXIF (211 av 212 i det første albumet, mot 0 i Dropbox), og
 * miniatyrene er ferdig genererte — under ett sekund per bilde, mot ~20 hos
 * Dropbox. Album-oppføringene får id-prefikset "immich:", og en ny kjøring
 * erstatter alle gamle immich-oppføringer uten å røre Dropbox-bildene.
 */

const IMMICH_URL = process.env.IMMICH_URL || "https://immich.vikran.net";
const SHARE_KEY = process.env.IMMICH_SHARE_KEY || "";

const OUT_DIR = path.join(process.cwd(), "public", "thumbs");
const INDEX_PATH = path.join(process.cwd(), "data", "index.json");
const CONCURRENCY = 4;
const MAX_WIDTH = 1000;
const QUALITY = 60;

type ImmichAsset = {
  id: string;
  originalFileName: string;
  fileCreatedAt: string;
  /** Tagger satt i Immich — den mest pålitelige kilden til kategori. */
  tags?: Array<{ name?: string; value?: string }>;
  /** Hvem som lastet opp. Fotografene deler sine egne album inn i hovedalbumet. */
  ownerId?: string;
  exifInfo?: {
    latitude?: number | null;
    longitude?: number | null;
    description?: string | null;
    dateTimeOriginal?: string | null;
  };
};

/**
 * Kamera og eksport-presets fyller beskrivelsesfeltet med plassholdere.
 * 32 bilder kom inn med beskrivelsen «default» og ble stående som et sted
 * med det navnet; da er det bedre å slå opp stedet fra koordinatet.
 */
const PLASSHOLDERE = /^(default|untitled|no description|olympus digital camera|sony dsc|image|photo|\s*)$/i;

function ekteBeskrivelse(tekst: string | null | undefined): string | null {
  const t = tekst?.trim();
  return t && !PLASSHOLDERE.test(t) ? t : null;
}

/** Settes av listAssetIds, så hovedløpet vet hvilket album vi er i. */
let albumIdFunnet: string | null = null;

async function api<T>(pathname: string): Promise<T> {
  const sep = pathname.includes("?") ? "&" : "?";
  const res = await fetch(`${IMMICH_URL}/api${pathname}${sep}key=${SHARE_KEY}`);
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Medlemmene i albumet: id → navn.
 *
 * Fotografen står ikke i selve bildet — ingen artist- eller copyright-felt
 * — men Immich vet hvem som lastet det opp, og albumet kjenner navnene til
 * alle som deler inn i det. Delingsnøkkelen får lese dem; ingen API-nøkkel
 * trengs.
 */
async function hentEiere(albumId: string): Promise<Map<string, string>> {
  const navn = new Map<string, string>();
  try {
    const album = await api<{
      albumUsers?: Array<{ user?: { id?: string; name?: string } }>;
    }>(`/albums/${albumId}`);
    for (const m of album.albumUsers ?? []) {
      if (m.user?.id && m.user.name) navn.set(m.user.id, m.user.name);
    }
  } catch {
    // Uten navnelisten blir fotografen stående tom; verre ting finnes.
  }
  return navn;
}

async function listAssetIds(): Promise<string[]> {
  const share = await api<{ type: string; album?: { id: string }; assets: Array<{ id: string }> }>(
    "/shared-links/me"
  );

  // En delt lenke kan peke på et album eller på enkeltbilder.
  if (share.type !== "ALBUM" || !share.album) {
    return share.assets.map((a) => a.id);
  }

  const albumId = share.album.id;
  albumIdFunnet = albumId;
  const buckets = await api<Array<{ timeBucket: string }>>(`/timeline/buckets?albumId=${albumId}`);

  const ids: string[] = [];
  for (const bucket of buckets) {
    const data = await api<Array<{ id: string }> | { id: string[] }>(
      `/timeline/bucket?albumId=${albumId}&timeBucket=${bucket.timeBucket}`
    );
    // Eldre Immich svarer med en liste av objekter, nyere med kolonneformat.
    if (Array.isArray(data)) ids.push(...data.map((a) => a.id));
    else ids.push(...data.id);
  }
  return ids;
}

/**
 * Stedsnavnet tas fra bildets beskrivelse når fotografen har satt en
 * ("Godt brød - Økologisk Bakeverksted"), ellers fra nærmeste offisielle
 * adresse. Punktoppslaget mellomlagres på avrundede koordinater, siden
 * bildeserier fra samme sted ligger få meter fra hverandre.
 */
const addressCache = new Map<string, string | null>();
// POI-oppslaget mellomlagres på samme måte — bildeserier deler sted.
/**
 * Stedsoppslagene, bufret på disk.
 *
 * Bufferen lå bare i minnet, så hver sync spurte Photon på nytt for hvert
 * koordinat — over to tusen oppslag på rad, som er mer enn gratistjenesten
 * tåler. Var den nede, forsvant navnene. Nå huskes et svar for godt: det
 * gjør synken rask, og det gjør den uavhengig av at tjenesten er oppe.
 *
 * Bare svar å stole på havner her. «Utilgjengelig» er ingen kunnskap og
 * bufres ikke, ellers ville en nede tjeneste blitt husket som sannhet.
 */
const POI_CACHE_PATH = path.join(process.cwd(), "data", "poi-cache.json");
const poiCache = new Map<string, Poi | null>();
let poiUtilgjengelig = 0;
let poiCacheEndret = false;

async function lesPoiCache() {
  try {
    const rå = JSON.parse(await fs.readFile(POI_CACHE_PATH, "utf-8")) as Record<string, Poi | null>;
    for (const [k, v] of Object.entries(rå)) poiCache.set(k, v);
  } catch {
    // Ingen buffer ennå.
  }
}

async function skrivPoiCache() {
  if (!poiCacheEndret) return;
  const ut = Object.fromEntries([...poiCache.entries()].sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeFile(POI_CACHE_PATH, JSON.stringify(ut, null, 2));
}

async function cachedPoi(lat: number, lng: number): Promise<Stedsoppslag> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (poiCache.has(cacheKey)) {
    const bufret = poiCache.get(cacheKey)!;
    return bufret ? { status: "treff", poi: bufret } : { status: "tomt" };
  }
  const svar = await lookupPoiStatus(lat, lng);
  if (svar.status === "utilgjengelig") {
    poiUtilgjengelig++;
  } else {
    poiCache.set(cacheKey, svar.status === "treff" ? svar.poi : null);
    poiCacheEndret = true;
  }
  // Uten Google-nøkkel går oppslaget mot Photon, som vil ha rolig tempo.
  if (!process.env.GOOGLE_PLACES_API_KEY) {
    await new Promise((r) => setTimeout(r, 400));
  }
  return svar;
}

async function nearestAddress(lat: number, lng: number): Promise<string | null> {
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (addressCache.has(cacheKey)) return addressCache.get(cacheKey)!;

  const url = new URL("https://ws.geonorge.no/adresser/v1/punktsok");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("radius", "100");
  url.searchParams.set("treffPerSide", "1");

  let result: string | null = null;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "omradeportal/1.0" } });
    if (res.ok) {
      const data = (await res.json()) as { adresser?: Array<{ adressetekst?: string }> };
      result = data.adresser?.[0]?.adressetekst ?? null;
    }
  } catch {
    result = null;
  }
  addressCache.set(cacheKey, result);
  return result;
}

/* Filnavnet avledes i src/lib/thumbs.ts, felles med prepare-static. */

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchThumb(assetId: string): Promise<Buffer> {
  const res = await fetch(
    `${IMMICH_URL}/api/assets/${assetId}/thumbnail?size=preview&key=${SHARE_KEY}`
  );
  if (!res.ok) throw new Error(`thumbnail ${assetId}: HTTP ${res.status}`);
  const jpeg = Buffer.from(await res.arrayBuffer());
  return sharp(jpeg)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: QUALITY })
    .toBuffer();
}

async function main() {
  if (!SHARE_KEY) {
    console.error("Sett IMMICH_SHARE_KEY i .env.local (nøkkelen fra delingslenken).");
    process.exit(1);
  }

  console.log(`Henter album fra ${IMMICH_URL} ...`);
  const ids = await listAssetIds();
  const eiere = albumIdFunnet ? await hentEiere(albumIdFunnet) : new Map<string, string>();
  if (eiere.size) console.log(`${eiere.size} medlemmer i albumet: ${[...eiere.values()].join(", ")}`);
  // Immich-id-ene er uuid-er og kan ikke kollidere seg imellom, men navnet
  // skal utledes av samme funksjon som prepare-static leser med.
  const thumbFileName = lagThumbnavn(ids.map((id) => `immich:${id}`));
  console.log(`Fant ${ids.length} bilder.\n`);

  await fs.mkdir(OUT_DIR, { recursive: true });

  await lesPoiCache();

  // Forrige indeks leses før løkka, ikke etter. Den er ikke bare noe å
  // flette inn til slutt — den er det portalen alt vet, og det eneste
  // som holder når et oppslag ikke svarer.
  let index: SearchIndex;
  try {
    index = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));
  } catch {
    index = { generatedAt: null, photos: [] };
  }
  const forrige = new Map(index.photos.map((p) => [p.id, p]));

  const photos: PhotoEntry[] = [];
  const feilede = new Set<string>();
  let withGps = 0;
  let named = 0;
  let fromPoi = 0;
  let failed = 0;

  const queue = [...ids];
  const started = Date.now();

  async function worker() {
    while (queue.length) {
      const assetId = queue.shift();
      if (!assetId) return;

      try {
        const asset = await api<ImmichAsset>(`/assets/${assetId}`);
        const lat = asset.exifInfo?.latitude ?? null;
        const lng = asset.exifInfo?.longitude ?? null;
        const hasGps = typeof lat === "number" && typeof lng === "number" && lat !== 0;
        if (hasGps) withGps++;

        const description = ekteBeskrivelse(asset.exifInfo?.description);

        // Stedsnavn i prioritert rekkefølge: fotografens egen beskrivelse,
        // stedet som faktisk ligger på koordinatet (kafeen, parken), og til
        // slutt nærmeste adresse som nøytral reserve.
        const entryId = `immich:${asset.id}`;
        const før = forrige.get(entryId);

        // Tagger i Immich går foran alt: de er satt av fotografen med
        // vitende vilje, mens beskrivelse og stedsoppslag er tolkninger.
        const tagger = (asset.tags ?? [])
          .map((t) => t.value || t.name || "")
          .filter(Boolean);
        const taggetSom = categoryFromTags(tagger);

        /**
         * Et nabolagsbilde skal ikke hete utestedet på hjørnet.
         *
         * Stedsoppslaget gjetter på nærmeste navngitte sted, og uten tittel
         * ble gjetningen navnet: «Amazonia by BAR» var et nabolagsbilde fra
         * Tjuvholmen, «Thief Spa» og «MOONRISE.EAST.November» det samme.
         * Taggen er fotografens utsagn om hva bildet viser, og den skal ikke
         * overdøves av en gjetning. Har bildet en tittel, gjelder tittelen;
         * ellers er det området eller adressen — ikke et sted vi antar.
         */
        const gjettNavn = taggetSom !== "nabolag";
        const oppslag: Stedsoppslag =
          !description && hasGps && gjettNavn ? await cachedPoi(lat!, lng!) : { status: "tomt" };
        const poi = oppslag.status === "treff" ? oppslag.poi : null;
        let placeName = description ?? poi?.name ?? null;
        /**
         * Fant vi ingenting nå, er navnet vi hadde fra før bedre enn gata.
         *
         * Først vernet dette bare mot at oppslaget var nede. Men «ingen
         * treff» tømmer navnet like grundig: Photon svarte for Nordpolen
         * skole og fant ingenting som passerte filtrene, og skolen ble til
         * «Hans Nielsen Hauges gate 1». Torshovteatret og Kaffe & Brød gikk
         * samme vei. Et navn vi en gang har funnet, kaster vi ikke fordi et
         * senere oppslag kom tomt tilbake.
         *
         * Unntaket er bildene vi ikke skal gjette navn på i det hele tatt.
         * Der er det gamle navnet selv en gjetning, og den skal bort.
         */
        if (!placeName && gjettNavn && før?.placeName) {
          placeName = før.placeName;
        }
        // Står fotografen midt i en park, er det parken som er stedet — ikke
        // nærmeste adresse, som ville bundet bildet til en eiendom. Men
        // flaten kommer etter navnet vi alt har: lot jeg den gå først, ble
        // «Brasserie Hansken» til «Christiania torv» og «Birk Sport» til
        // «Myraløkka». Et navn funnet med et oppslag som virket veier
        // tyngre enn en flate bildet tilfeldigvis står inni.
        const park = !placeName && hasGps ? stedVedPunkt(lat!, lng!) : null;
        if (park) placeName = park.name;
        if (!placeName && hasGps) {
          placeName = await nearestAddress(lat!, lng!);
        }
        if (placeName) named++;
        if (poi) fromPoi++;

        const fraTag = taggetSom ?? detectCategory(tagger).categoryId;
        const fraTekst = detectCategory([description ?? "", asset.originalFileName], { sisteErFilnavn: true });
        const categoryId =
          fraTag !== "annet"
            ? fraTag
            : fraTekst.categoryId !== "annet"
              ? fraTekst.categoryId
              : poi?.categoryId ??
                park?.categoryId ??
                // Samme regel som for navnet: en kategori vi en gang har
                // funnet er bedre enn «annet», uansett hvorfor oppslaget
                // kom tomt tilbake denne gangen.
                før?.category ??
                "annet";

        const outPath = path.join(OUT_DIR, thumbFileName(entryId));
        if (!(await exists(outPath))) {
          await fs.writeFile(outPath, await fetchThumb(asset.id));
        }

        photos.push({
          id: entryId,
          dropboxPath: `immich://${asset.id}`,
          category: categoryId,
          placeName: placeName ?? asset.originalFileName,
          lat: hasGps ? lat! : null,
          lng: hasGps ? lng! : null,
          locationSource: hasGps ? "exif" : "none",
          clientModified: asset.exifInfo?.dateTimeOriginal ?? asset.fileCreatedAt,
          thumb: `/thumbs/${thumbFileName(entryId)}`,
          original: `${IMMICH_URL}/api/assets/${asset.id}/original?key=${SHARE_KEY}`,
          filnavn: asset.originalFileName,
          ...(asset.ownerId && eiere.get(asset.ownerId)
            ? { fotograf: eiere.get(asset.ownerId) }
            : {}),
        });
      } catch (err) {
        failed++;
        feilede.add(`immich:${assetId}`);
        console.warn(`  ✗ ${assetId}: ${(err as Error).message}`);
      }

      const handled = photos.length + failed;
      if (handled % 25 === 0) console.log(`  ${handled}/${ids.length} …`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Flett inn: alt fra Immich byttes ut, alt annet beholdes urørt.
  const others = index.photos.filter((p) => !p.id.startsWith("immich:"));

  // Bilder som feilet i denne runden beholdes fra forrige. En treg kveld
  // hos Immich ga 81 nettverksfeil, og de bildene forsvant fra portalen
  // til neste sync — Akebakkeskogen sto igjen med ett bilde.
  const hentet = new Set(photos.map((p) => p.id));
  const beholdt = index.photos.filter(
    (p) => p.id.startsWith("immich:") && !hentet.has(p.id) && feilede.has(p.id)
  );
  if (beholdt.length) console.log(`  ${beholdt.length} bilder feilet og beholdes fra forrige sync.`);
  index.photos = [...others, ...photos, ...beholdt];
  index.generatedAt = new Date().toISOString();
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`\nFerdig på ${secs}s. ${photos.length} bilder (${failed} feilet).`);
  console.log(
    `  ${withGps} med GPS, ${named} med stedsnavn — ${fromPoi} fra stedsoppslag (${process.env.GOOGLE_PLACES_API_KEY ? "Google Places" : "OpenStreetMap"})`
  );
  if (poiUtilgjengelig) {
    console.log(
      `  ⚠ ${poiUtilgjengelig} stedsoppslag svarte ikke. Navnene fra forrige sync er beholdt;\n` +
        `    kjør på nytt når tjenesten er oppe for å få med nye steder.`
    );
  }
  await skrivPoiCache();
  console.log(`Indeksen har nå ${index.photos.length} bilder totalt (${others.length} fra før).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
