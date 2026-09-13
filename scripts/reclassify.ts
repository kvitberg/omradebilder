import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import { detectCategory } from "../src/lib/categories";
import type { SearchIndex } from "../src/lib/index-store";

/**
 * Setter kategori på nytt for Dropbox-bildene ut fra dagens regler.
 *
 * Kategorien lagres i indeksen når bildene synkroniseres, så en rettelse i
 * nøkkelordene slår ikke gjennom før neste sync. Full sync geokoder på nytt
 * og tar en halvtime; dette leser bare mappestien, som allerede ligger i
 * indeksen, og er ferdig på et øyeblikk.
 *
 * Immich-bildene røres ikke — de får kategorien fra taggene sine.
 */

const INDEX_PATH = path.join(process.cwd(), "data", "index.json");
const ROOT = process.env.DROPBOX_ROOT_FOLDER || "";

/** Samme ord som sync-scriptet bruker for å kjenne igjen et gårdsrom. */
const BAKGARD_ORD =
  /\b(bakg[åa]rd(?:er|ene)?|g[åa]rdsrom(?:mene|met)?|innhage(?:r|ne)?|fellesareal(?:er|ene)?)\b/i;

async function main() {
  const index: SearchIndex = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));

  let endret = 0;
  const endringer: Record<string, number> = {};

  for (const photo of index.photos) {
    if (photo.id.startsWith("immich:")) continue;

    const relative = path.relative(ROOT, photo.dropboxPath);
    const segments = relative.split(path.sep).slice(0, -1);
    const filnavn = path.basename(photo.dropboxPath, path.extname(photo.dropboxPath));
    const mappenavn = segments[segments.length - 1] || filnavn;

    const erBakgard = BAKGARD_ORD.test(mappenavn);
    const ny = erBakgard ? "bakgard" : detectCategory([...segments, filnavn], { sisteErFilnavn: true }).categoryId;

    if (ny !== photo.category) {
      endringer[`${photo.category} → ${ny}`] = (endringer[`${photo.category} → ${ny}`] ?? 0) + 1;
      photo.category = ny;
      endret++;
    }
  }

  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));

  console.log(`${endret} bilder fikk ny kategori.`);
  for (const [fra, n] of Object.entries(endringer).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${fra}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
