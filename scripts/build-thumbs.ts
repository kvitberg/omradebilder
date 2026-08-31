import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Dropbox } from "dropbox";
import { getDropboxClient } from "../src/lib/dropbox";
import { toArrayBuffer } from "../src/lib/dropbox-binary";
import type { SearchIndex } from "../src/lib/index-store";

/**
 * Laster ned én miniatyr per bilde fra Dropbox og lagrer den under
 * public/thumbs. Da slipper den hostede siden å snakke med Dropbox under
 * drift, og bildene vises umiddelbart i stedet for etter 1–3 sekunder.
 *
 * Skriptet kan kjøres om igjen: allerede nedlastede miniatyrer hoppes over,
 * så et avbrutt kjør kan bare startes på nytt.
 */

const THUMB_SIZE = "w1024h768";

// Dropbox bruker 5–10 sekunder på å lage en miniatyr fra en fulloppløst fil.
// Med for mange samtidige kall kutter den forbindelsen ("fetch failed"), så
// vi holder oss lavt og prøver heller på nytt.
const CONCURRENCY = Number(process.env.THUMB_CONCURRENCY ?? 3);
const MAX_ATTEMPTS = 4;
const OUT_DIR = path.join(process.cwd(), "public", "thumbs");
const INDEX_PATH = path.join(process.cwd(), "data", "index.json");
const FORCE = process.argv.includes("--force");

/**
 * Miniatyrene lagres som WebP. Dropbox' egen JPEG er rundt 210 kB per bilde,
 * som blir 580 MB for hele arkivet — altfor tungt for et git-repo. Re-koding
 * til WebP på 1000 px gir omtrent 90 kB uten synlig tap i visningsstørrelse.
 */
const MAX_WIDTH = 1000;
const QUALITY = 60;

/** Dropbox-id-er ser ut som "id:aBc123" — vi trenger et trygt filnavn. */
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchThumb(dbx: Dropbox, dropboxPath: string): Promise<Buffer> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await dbx.filesGetThumbnailV2({
        resource: { ".tag": "path", path: dropboxPath },
        format: { ".tag": "jpeg" },
        size: { ".tag": THUMB_SIZE } as never,
        mode: { ".tag": "fitone_bestfit" },
      });
      // Komprimeres med én gang, så vi aldri skriver Dropbox' store JPEG
      // til disk og slipper et eget opprydningssteg etterpå.
      const jpeg = Buffer.from(await toArrayBuffer(res.result));
      return await sharp(jpeg)
        .resize({ width: MAX_WIDTH, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer();
    } catch (err) {
      lastError = err;
      // Nettverksbrudd og rateberensning gir seg som regel etter en pause.
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }

  throw lastError;
}

async function main() {
  const index: SearchIndex = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));
  if (!index.photos.length) {
    console.log("Indeksen er tom. Kjør 'npm run sync' først.");
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const dbx = await getDropboxClient();

  let done = 0;
  let skipped = 0;
  let failed = 0;
  let bytes = 0;

  const queue = [...index.photos];
  const started = Date.now();

  async function worker() {
    while (queue.length) {
      const photo = queue.shift();
      if (!photo) return;

      const fileName = thumbFileName(photo.id);
      const outPath = path.join(OUT_DIR, fileName);
      const publicPath = `/thumbs/${fileName}`;

      if (!FORCE && (await exists(outPath))) {
        photo.thumb = publicPath;
        bytes += (await fs.stat(outPath)).size;
        skipped++;
        continue;
      }

      try {
        const data = await fetchThumb(dbx, photo.dropboxPath);
        await fs.writeFile(outPath, data);
        photo.thumb = publicPath;
        bytes += data.byteLength;
        done++;
      } catch (err) {
        photo.thumb = null;
        failed++;
        console.warn(`  ✗ ${photo.dropboxPath}: ${(err as Error).message}`);
      }

      const handled = done + skipped + failed;
      if (handled % 25 === 0) {
        console.log(`  ${handled}/${index.photos.length} …`);
      }
    }
  }

  console.log(
    `Genererer miniatyrer (${THUMB_SIZE}) for ${index.photos.length} bilder, ${CONCURRENCY} om gangen ...`
  );
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));

  const secs = Math.round((Date.now() - started) / 1000);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  console.log(
    `\nFerdig på ${secs}s. ${done} nye, ${skipped} fantes fra før, ${failed} feilet.`
  );
  console.log(`Samlet størrelse: ${mb} MB i public/thumbs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
