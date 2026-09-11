import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import { lookupPoiByName } from "../src/lib/poi";
import type { SearchIndex } from "../src/lib/index-store";

/**
 * Slår opp hva stedene i arkivet faktisk er, og skriver resultatet til
 * `data/steder.json`.
 *
 * Dropbox-mappene er stedsnavn uten kategori ("Botsparken", "Nydalen T"),
 * så nesten alt havnet i «Annet». Her spørres OpenStreetMap om navnet, og
 * svarets type avgjør kategorien — park, kollektiv, skole, natur, kultur,
 * handel eller nabolag.
 *
 * Fila er ment å redigeres for hånd: alt du retter der, står. Skriptet
 * rører bare oppføringer det ikke allerede finnes en verdi for, og kan
 * derfor kjøres om igjen uten å overskrive rettelsene dine.
 *
 * Å skrive til en egen fil framfor å endre `data/index.json` gjør det også
 * trygt å kjøre samtidig som `npm run thumbs`, som eier indeksfila.
 */

const INDEX_PATH = path.join(process.cwd(), "data", "index.json");
const STEDER_PATH = path.join(process.cwd(), "data", "steder.json");
const ONLY = process.argv.find((a) => a.startsWith("--bydel="))?.split("=")[1];

export type Sted = {
  /** Kategori-id fra categories.ts. */
  kategori: string;
  /** Visningsnavnet, når oppslaget fant et bedre enn mappenavnet. */
  navn?: string;
  /** Hvor kategorien kom fra — «osm» er gjettet, «manuell» er din rettelse. */
  kilde?: "osm" | "manuell";
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const index: SearchIndex = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));

  let steder: Record<string, Sted> = {};
  try {
    steder = JSON.parse(await fs.readFile(STEDER_PATH, "utf-8"));
  } catch {
    steder = {};
  }

  // Ett oppslag per unikt stedsnavn, ikke per bilde.
  const kandidater = new Map<string, { lat: number; lng: number; antall: number }>();
  for (const p of index.photos) {
    if (p.id.startsWith("immich:")) continue;
    if (p.lat === null || p.lng === null || !p.placeName) continue;
    if (p.category !== "annet") continue;
    if (ONLY && !p.dropboxPath.includes(`/${ONLY}/`)) continue;
    if (steder[p.placeName]) continue;

    const eksisterende = kandidater.get(p.placeName);
    if (eksisterende) eksisterende.antall++;
    else kandidater.set(p.placeName, { lat: p.lat, lng: p.lng, antall: 1 });
  }

  console.log(`${kandidater.size} steder å slå opp${ONLY ? ` i ${ONLY}` : ""}.\n`);

  let funnet = 0;
  let bom = 0;
  const fordeling: Record<string, number> = {};

  for (const [navn, info] of kandidater) {
    const poi = await lookupPoiByName(navn, info.lat, info.lng);
    await sleep(400); // Photon vil ha rolig tempo

    if (poi?.categoryId) {
      steder[navn] = {
        kategori: poi.categoryId,
        ...(poi.name !== navn ? { navn: poi.name } : {}),
        kilde: "osm",
      };
      fordeling[poi.categoryId] = (fordeling[poi.categoryId] ?? 0) + 1;
      funnet++;
    } else {
      bom++;
    }

    if ((funnet + bom) % 25 === 0) {
      console.log(`  ${funnet + bom}/${kandidater.size} …`);
    }
  }

  // Sortert, så fila er lett å lese og diffe når du retter i den.
  const sortert = Object.fromEntries(
    Object.entries(steder).sort(([a], [b]) => a.localeCompare(b, "no"))
  );
  await fs.writeFile(STEDER_PATH, JSON.stringify(sortert, null, 2));

  console.log(`\n${funnet} klassifisert, ${bom} uten treff.`);
  console.log("Fordeling:", JSON.stringify(fordeling));
  console.log(`\n${Object.keys(sortert).length} steder totalt i ${STEDER_PATH}`);
  console.log("Rett gjerne feil der — skriptet rører ikke oppføringer som finnes.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
