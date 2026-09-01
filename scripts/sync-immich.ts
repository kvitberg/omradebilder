import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { detectCategory } from "../src/lib/categories";
import type { PhotoEntry, SearchIndex } from "../src/lib/index-store";

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
  exifInfo?: {
    latitude?: number | null;
    longitude?: number | null;
    description?: string | null;
    dateTimeOriginal?: string | null;
  };
};

async function api<T>(pathname: string): Promise<T> {
  const sep = pathname.includes("?") ? "&" : "?";
  const res = await fetch(`${IMMICH_URL}/api${pathname}${sep}key=${SHARE_KEY}`);
  if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
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

/** Samme filnavnkonvensjon som prepare-static utleder fra id-en. */
function thumbFileName(id: string) {
  return id.replace(/^id:/, "").replace(/[^A-Za-z0-9_-]/g, "") + ".webp";
}

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
  console.log(`Fant ${ids.length} bilder.\n`);

  await fs.mkdir(OUT_DIR, { recursive: true });

  const photos: PhotoEntry[] = [];
  let withGps = 0;
  let named = 0;
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

        const description = asset.exifInfo?.description?.trim() || null;
        let placeName = description;
        if (!placeName && hasGps) {
          placeName = await nearestAddress(lat!, lng!);
        }
        if (placeName) named++;

        const { categoryId } = detectCategory([description ?? "", asset.originalFileName]);

        const entryId = `immich:${asset.id}`;
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
        });
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${assetId}: ${(err as Error).message}`);
      }

      const handled = photos.length + failed;
      if (handled % 25 === 0) console.log(`  ${handled}/${ids.length} …`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Flett inn: alt fra Immich byttes ut, alt annet beholdes urørt.
  let index: SearchIndex;
  try {
    index = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));
  } catch {
    index = { generatedAt: null, photos: [] };
  }
  const others = index.photos.filter((p) => !p.id.startsWith("immich:"));
  index.photos = [...others, ...photos];
  index.generatedAt = new Date().toISOString();
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`\nFerdig på ${secs}s. ${photos.length} bilder (${failed} feilet).`);
  console.log(`  ${withGps} med GPS, ${named} med stedsnavn (beskrivelse eller nærmeste adresse)`);
  console.log(`Indeksen har nå ${index.photos.length} bilder totalt (${others.length} fra før).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
