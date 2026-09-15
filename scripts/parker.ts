import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import { FELLESAREAL_KATEGORIER } from "../src/lib/categories";
import { parkVedPunkt } from "../src/lib/parker";
import type { SearchIndex } from "../src/lib/index-store";

/**
 * Gir bilder som bare har en adresse som navn parkens navn, hvis punktet
 * ligger inni en navngitt park. Slike bilder bindes ellers til eiendommen,
 * og en park skal vises for alle i gangavstand.
 *
 * Oppslaget er lokalt (data/parker.json), så dette går på et øyeblikk og
 * kan kjøres om igjen.
 */

const INDEX_PATH = path.join(process.cwd(), "data", "index.json");

async function main() {
  const index: SearchIndex = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));
  const punkter: Record<string, [number, number]> = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "data", "adressepunkter.json"), "utf-8")
  );

  const kandidater = index.photos.filter(
    (p) =>
      p.lat !== null &&
      p.lng !== null &&
      !FELLESAREAL_KATEGORIER.has(p.category) &&
      !!punkter[p.placeName.trim()]
  );
  console.log(`${kandidater.length} bilder har en adresse som navn.`);

  // Bildeserier deler punkt; ett oppslag per punkt.
  const svar = new Map<string, ReturnType<typeof parkVedPunkt>>();
  let endret = 0;
  for (const [i, p] of kandidater.entries()) {
    const key = `${p.lat!.toFixed(4)},${p.lng!.toFixed(4)}`;
    if (!svar.has(key)) {
      svar.set(key, parkVedPunkt(p.lat!, p.lng!));
    }
    const park = svar.get(key);
    if (park) {
      console.log(`  ${p.placeName} → ${park.name}`);
      p.placeName = park.name;
      if (p.category === "annet") p.category = park.categoryId;
      endret++;
    }
    if ((i + 1) % 20 === 0) await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
  }
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
  console.log(`\nFerdig: ${endret} bilder fikk parknavn, ${svar.size} punkter slått opp.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
