import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import { getDropboxClient } from "../src/lib/dropbox";
import type { SearchIndex } from "../src/lib/index-store";

/**
 * Setter nedlastingslenke til originalfilen på hvert bilde som kan vises.
 *
 * Dropbox-bilder får én delingslenke hver, opprettet via API-et. Lenken
 * peker på fila i full størrelse med `dl=1`, som gjør at nettleseren
 * laster ned i stedet for å vise. Immich-bilder får originalen via
 * delingsnøkkelen, uten noe API-kall.
 *
 * Kan kjøres om igjen: bilder som allerede har lenke hoppes over, og
 * indeksen lagres underveis, så et avbrutt kjør kan startes på nytt.
 */

const INDEX_PATH = path.join(process.cwd(), "data", "index.json");
const IMMICH_URL = process.env.IMMICH_URL || "https://immich.vikran.net";
const SHARE_KEY = process.env.IMMICH_SHARE_KEY || "";
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 5;
const LAGRE_HVER = 25;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dropbox' delingslenke viser fila; `dl=1` laster den ned. */
function tilNedlasting(url: string): string {
  return url.includes("dl=0") ? url.replace("dl=0", "dl=1") : `${url}${url.includes("?") ? "&" : "?"}dl=1`;
}

type DbxFeil = { error?: { error?: { ".tag"?: string }; retry_after?: number }; status?: number };

async function main() {
  const index: SearchIndex = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));

  // Bare bilder som kan dukke opp i et søk trenger lenke. Den publiserte
  // indeksen er fasit — noen bilder får posisjon først under byggingen, fra
  // gårdsnavnet sitt, og har lat null her.
  const publisert = await publiserteIder();
  const kandidater = index.photos.filter(
    (p) => !p.original && (publisert ? publisert.has(p.id) : p.lat !== null && p.lng !== null)
  );
  const immich = kandidater.filter((p) => p.id.startsWith("immich:"));
  const dropbox = kandidater.filter((p) => !p.id.startsWith("immich:"));
  console.log(`${immich.length} Immich-bilder og ${dropbox.length} Dropbox-bilder mangler lenke.`);

  // Immich: filnavnet hentes fra API-et, lenken er bare en adresse.
  let immichFeil = 0;
  for (const [i, p] of immich.entries()) {
    const assetId = p.id.slice("immich:".length);
    try {
      const res = await fetch(`${IMMICH_URL}/api/assets/${assetId}?key=${SHARE_KEY}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const asset = (await res.json()) as { originalFileName?: string };
      p.original = `${IMMICH_URL}/api/assets/${assetId}/original?key=${SHARE_KEY}`;
      p.filnavn = asset.originalFileName ?? null;
    } catch (err) {
      immichFeil++;
      console.warn(`  ✗ ${p.id}: ${(err as Error).message}`);
    }
    if ((i + 1) % LAGRE_HVER === 0) await lagre(index);
  }
  await lagre(index);
  console.log(`Immich ferdig (${immichFeil} feilet).\n`);

  if (!dropbox.length) return;
  const dbx = await getDropboxClient();
  const kø = [...dropbox];
  let gjort = 0;
  let feilet = 0;
  const start = Date.now();

  async function delingslenke(dropboxPath: string): Promise<string> {
    let siste: unknown;
    for (let forsøk = 1; forsøk <= MAX_ATTEMPTS; forsøk++) {
      try {
        try {
          const res = await dbx.sharingCreateSharedLinkWithSettings({
            path: dropboxPath,
            settings: { requested_visibility: { ".tag": "public" } },
          });
          return res.result.url;
        } catch (err) {
          const tag = (err as DbxFeil).error?.error?.[".tag"];
          // Fila har lenke fra før — da henter vi den.
          if (tag !== "shared_link_already_exists") throw err;
          const liste = await dbx.sharingListSharedLinks({ path: dropboxPath, direct_only: true });
          const treff = liste.result.links[0];
          if (!treff) throw new Error("Lenke finnes visstnok, men ble ikke funnet");
          return treff.url;
        }
      } catch (err) {
        siste = err;
        const status = (err as DbxFeil).status;
        const vent = (err as DbxFeil).error?.retry_after;
        if (forsøk < MAX_ATTEMPTS) {
          await sleep(vent ? vent * 1000 : status === 429 ? 5000 * forsøk : 1000 * 2 ** (forsøk - 1));
        }
      }
    }
    throw siste;
  }

  async function arbeider() {
    while (kø.length) {
      const p = kø.shift();
      if (!p) return;
      try {
        p.original = tilNedlasting(await delingslenke(p.dropboxPath));
        p.filnavn = path.basename(p.dropboxPath);
      } catch (err) {
        feilet++;
        const melding = (err as DbxFeil).error ? JSON.stringify((err as DbxFeil).error) : String(err);
        console.warn(`  ✗ ${p.dropboxPath}: ${melding.slice(0, 200)}`);
      }
      gjort++;
      if (gjort % LAGRE_HVER === 0) {
        await lagre(index);
        const sek = Math.round((Date.now() - start) / 1000);
        console.log(`  ${gjort}/${dropbox.length} (${sek}s)`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, arbeider));
  await lagre(index);
  console.log(`\nFerdig: ${gjort - feilet} lenker, ${feilet} feilet.`);
}

async function publiserteIder(): Promise<Set<string> | null> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "public", "data", "index.json"), "utf-8");
    return new Set((JSON.parse(raw) as { photos: Array<{ id: string }> }).photos.map((p) => p.id));
  } catch {
    return null;
  }
}

async function lagre(index: SearchIndex) {
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
