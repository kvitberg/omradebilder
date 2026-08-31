import { config } from "dotenv";
config({ path: ".env.local" });

import path from "node:path";
import fs from "node:fs/promises";
import type { Dropbox } from "dropbox";
import { getDropboxClient } from "../src/lib/dropbox";
import { detectCategory } from "../src/lib/categories";
import { geocodeAddress } from "../src/lib/geocode";
import type { PhotoEntry, SearchIndex } from "../src/lib/index-store";
import { bygardIdForAddress } from "../src/lib/bygarder";
import { loadBakgardNavn, lookupKallenavn } from "../src/lib/bakgard-navn";

const ROOT = process.env.DROPBOX_ROOT_FOLDER || "";
const DEFAULT_REGION = process.env.DEFAULT_GEOCODE_REGION || "";
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".heic", ".tiff"]);

/** Begrens synkroniseringen til én undermappe, f.eks. "/Oslo/Gamle Oslo". */
const ONLY = process.argv[2] ?? "";

type DropboxFile = {
  path: string;
  id: string;
  clientModified: string;
  lat: number | null;
  lng: number | null;
};

/**
 * Lister bildefilene. `include_media_info` gjør at Dropbox returnerer
 * GPS-posisjonen sammen med metadataene, så vi slipper å laste ned
 * fulloppløste bilder på ~10 MB bare for å lese EXIF.
 */
async function listAllImageFiles(dbx: Dropbox): Promise<DropboxFile[]> {
  const files: DropboxFile[] = [];
  const startPath = ROOT + ONLY;

  let res = await dbx.filesListFolder({
    path: startPath,
    recursive: true,
    include_media_info: true,
  });

  while (true) {
    for (const entry of res.result.entries) {
      if (entry[".tag"] !== "file" || !entry.path_display) continue;
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      const media = entry.media_info;
      let lat: number | null = null;
      let lng: number | null = null;

      if (media && media[".tag"] === "metadata" && media.metadata[".tag"] === "photo") {
        const loc = media.metadata.location;
        if (loc && typeof loc.latitude === "number" && typeof loc.longitude === "number") {
          lat = loc.latitude;
          lng = loc.longitude;
        }
      }

      files.push({
        path: entry.path_display,
        id: entry.id,
        clientModified: entry.client_modified,
        lat,
        lng,
      });
    }

    if (!res.result.has_more) break;
    res = await dbx.filesListFolderContinue({ cursor: res.result.cursor });
  }

  return files;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * Ord som markerer at en mappe er et gårdsrom. Ordet kan stå hvor som helst
 * i navnet — de faktiske mappene i Dropbox heter både "Bakgård - Grüners gate"
 * og "Brettevilles gate borettslag - bakgårder" — og bøyes i flertall.
 */
const BAKGARD_ORD = /\b(bakg[åa]rd(?:er|ene)?|g[åa]rdsrom(?:mene|met)?|innhage(?:r|ne)?)\b/gi;

/** Organisasjonsformer som står i mappenavnet, men ikke finnes hos geokoderen. */
const SELSKAPSORD = /\b(borettslag|brl|sameie|boligselskap|boligsameie|as)\b/gi;

/** Gatenavn med husnummer, f.eks. "Torshovgata 10" eller "Toftes gate 10B". */
const ADRESSE_MONSTER = /\b([A-ZÆØÅa-zæøå][A-ZÆØÅa-zæøå.'\- ]*?\s+\d+\s*[A-Za-z]?)\b/g;

function rydd(tekst: string): string {
  return tekst
    .replace(/\s*[–—-]\s*$/, "")
    .replace(/^\s*[–—-]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Mappenavnene er ikke skrevet etter én fast mal — kategoriordet kan stå først
 * eller sist, og adressen kan være pakket inn i et selskapsnavn. Derfor leter
 * vi gjennom hele strengen etter kandidater i stedet for å regne med en fast
 * posisjon, og prøver dem fra mest til minst presis:
 *
 *   1. gatenavn med husnummer  ("Torshovgata 10")  — treffer ett kvartal presist
 *   2. hver del rundt tankestrek, uten selskapsord ("Brettevilles gate")
 *   3. hele navnet
 */
function adresseKandidater(navn: string): string[] {
  const utenOrd = rydd(navn.replace(BAKGARD_ORD, " "));
  const kandidater: string[] = [];
  const leggTil = (k: string) => {
    const t = rydd(k);
    if (t.length > 2 && !kandidater.includes(t)) kandidater.push(t);
  };

  // Adressemønsteret kjøres per del, ellers sluker det tankestreken og lager
  // kandidater som "Takterrasse - Sandakerveien 52".
  const deler = utenOrd.split(/\s+[–—-]\s+/);
  for (const del of deler) {
    ADRESSE_MONSTER.lastIndex = 0;
    for (const m of del.matchAll(ADRESSE_MONSTER)) leggTil(m[1]);
  }
  for (const del of deler) {
    leggTil(del.replace(SELSKAPSORD, " "));
    leggTil(del);
  }

  leggTil(utenOrd.replace(SELSKAPSORD, " "));
  leggTil(utenOrd);
  return kandidater;
}

/** Visningsnavnet er mappenavnet uten kategoriord — det brukerne ser i portalen. */
function visningsnavnFor(navn: string): string {
  const utenOrd = rydd(navn.replace(BAKGARD_ORD, " "));
  return utenOrd || navn;
}

function erBakgardsnavn(navn: string): boolean {
  BAKGARD_ORD.lastIndex = 0;
  return BAKGARD_ORD.test(navn);
}

/** Nærmeste offisielle adresse til et punkt, via Kartverkets åpne API. */
async function naermesteAdresse(lat: number, lng: number): Promise<string | null> {
  const url = new URL("https://ws.geonorge.no/adresser/v1/punktsok");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("radius", "50");
  url.searchParams.set("treffPerSide", "1");
  try {
    const res = await fetch(url, { headers: { "User-Agent": "omradeportal/1.0" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { adresser?: Array<{ adressetekst?: string }> };
    return data.adresser?.[0]?.adressetekst ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const dbx = await getDropboxClient();
  const startPath = ROOT + ONLY;

  console.log(`Lister bilder under "${startPath || "/"}" ...`);
  const files = await listAllImageFiles(dbx);
  console.log(`Fant ${files.length} bildefiler.\n`);

  // Steder som deler mappe deler posisjon — vi geokoder hver mappe én gang.
  const geocodeCache = new Map<string, { lat: number; lng: number } | null>();
  // Bygårdsoppslaget slås også opp per mappe, ikke per bilde.
  const bygardCache = new Map<string, string | null>();
  const kallenavn = await loadBakgardNavn();
  let medBygard = 0;

  const photos: PhotoEntry[] = [];
  let fromExif = 0;
  let fromGeocode = 0;
  let missing = 0;

  for (const [i, file] of files.entries()) {
    const relative = path.relative(ROOT, file.path);
    const segments = relative.split(path.sep).slice(0, -1);
    const filenameNoExt = path.basename(file.path, path.extname(file.path));

    // Nest innerste mappe er stedsnavnet, f.eks. Fylke/Bydel/Sted/bilde.jpg
    const mappenavn = segments[segments.length - 1] || filenameNoExt;
    const placeName = visningsnavnFor(mappenavn);
    const kandidater = adresseKandidater(mappenavn);

    // Et kallenavn sier ikke i seg selv at mappa er en bakgård, så det må stå
    // i data/bakgard-navn.json. Ordet "bakgård" klassifiserer på egen hånd.
    // Kallenavnet kan stå hvor som helst i navnet, så vi prøver alle delene.
    const kallenavnAdresse =
      kandidater.map((k) => lookupKallenavn(k, kallenavn)).find(Boolean) ?? null;
    const erBakgard = erBakgardsnavn(mappenavn) || kallenavnAdresse !== null;

    const { categoryId: detektert } = detectCategory([...segments, filenameNoExt]);
    const categoryId = erBakgard ? "bakgard" : detektert;

    let lat = file.lat;
    let lng = file.lng;
    let locationSource: PhotoEntry["locationSource"] = "none";

    if (lat !== null && lng !== null) {
      locationSource = "exif";
      fromExif++;
    } else {
      // Mappestien gir god kontekst: "Botsparken, Gamle Oslo, Oslo, Norge"
      const key = segments.join("/");
      if (!geocodeCache.has(key)) {
        // Prøv kandidatene fra mest til minst presis, og bruk den første som
        // geokoderen kjenner igjen. Kategoriord og selskapsord er allerede
        // fjernet — de gir null treff.
        const forsok = kallenavnAdresse ? [kallenavnAdresse] : kandidater;
        const bakgrunn = [...segments.slice(0, -1)].reverse();
        let hit: { lat: number; lng: number } | null = null;

        outer: for (const kandidat of forsok) {
          // Mappestien er ikke alltid riktig — "Bakgård - Grüners gate" ligger
          // under Sagene, men gata er på Grünerløkka. Derfor prøves kandidaten
          // også uten bydelskonteksten før vi går videre til neste.
          for (const kontekst of [bakgrunn, []]) {
            const query = [kandidat, ...kontekst, DEFAULT_REGION].filter(Boolean).join(", ");
            if (!query) continue;
            hit = await geocodeAddress(query);
            if (hit) break outer;
            // Nominatim tillater ca. ett kall i sekundet.
            if (!process.env.GOOGLE_GEOCODING_API_KEY) await sleep(1100);
            if (bakgrunn.length === 0) break;
          }
        }
        geocodeCache.set(key, hit);
      }

      const cachedHit = geocodeCache.get(key) ?? null;
      if (cachedHit) {
        lat = cachedHit.lat;
        lng = cachedHit.lng;
        locationSource = "geocode";
        fromGeocode++;
      } else {
        missing++;
      }
    }

    if ((i + 1) % 25 === 0 || i === files.length - 1) {
      console.log(`  ${i + 1}/${files.length} behandlet`);
    }

    // Bygården slås bare opp for mapper som er entydig klassifisert som
    // bakgård — ellers risikerer vi å binde et vilkårlig bilde til et kvartal.
    let bygardId: string | null = null;
    if (erBakgard) {
      const cacheKey = segments.join("/");
      if (!bygardCache.has(cacheKey)) {
        // Kallenavnets adresse er mest pålitelig; ellers går vi via posisjonen.
        let funnet = kallenavnAdresse ? await bygardIdForAddress(kallenavnAdresse) : null;
        if (!funnet && lat !== null && lng !== null) {
          const naer = await naermesteAdresse(lat, lng);
          funnet = naer ? await bygardIdForAddress(naer) : null;
        }
        bygardCache.set(cacheKey, funnet);
      }
      bygardId = bygardCache.get(cacheKey) ?? null;
      if (bygardId) medBygard++;
    }

    photos.push({
      id: file.id,
      dropboxPath: file.path,
      category: categoryId,
      placeName,
      lat,
      lng,
      locationSource,
      clientModified: file.clientModified,
      bygardId,
    });
  }

  const index: SearchIndex = { generatedAt: new Date().toISOString(), photos };
  const outPath = path.join(process.cwd(), "data", "index.json");
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(index, null, 2));

  console.log(
    `\nFerdig. ${fromExif} med GPS fra bildet, ${fromGeocode} geokodet fra mappenavn, ${missing} uten posisjon.`
  );
  console.log(`${medBygard} bakgårdsbilder knyttet til en bygård.`);
  console.log(`Indeks skrevet til ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
