import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import { geocodeAddress, iOsloOmradet } from "../src/lib/geocode";
import type { SearchIndex } from "../src/lib/index-store";

/**
 * Geokoder på nytt de bildene som havnet utenfor Oslo.
 *
 * Mappenavnet ble slått opp alene når bydelskonteksten ikke ga treff, og da
 * vant navnebrødre andre steder i landet: «Isdammen» ble Svalbard, «Februar»
 * ble Hamar. Her prøves mappestien nedenfra og opp — mappe, så bydel, så
 * Oslo — og bare treff innenfor Oslo-området godtas. Finner vi ingenting,
 * mister bildet posisjonen og holdes utenfor siden.
 *
 * Bruk:  npm run rett-posisjon
 */

const INDEX_PATH = path.join(process.cwd(), "data", "index.json");
const ROOT = process.env.DROPBOX_ROOT_FOLDER || "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const index: SearchIndex = JSON.parse(await fs.readFile(INDEX_PATH, "utf-8"));

  const feil = index.photos.filter(
    (p) =>
      p.locationSource === "geocode" &&
      p.lat !== null &&
      p.lng !== null &&
      !iOsloOmradet(p.lat, p.lng)
  );
  console.log(`${feil.length} bilder er geokodet utenfor Oslo-området.`);

  // Bilder fra samme mappe deler posisjon; ett oppslag per mappe.
  const perMappe = new Map<string, typeof feil>();
  for (const p of feil) {
    const mappe = path.dirname(p.dropboxPath);
    const liste = perMappe.get(mappe);
    if (liste) liste.push(p);
    else perMappe.set(mappe, [p]);
  }
  console.log(`${perMappe.size} mapper å slå opp på nytt.\n`);

  let rettet = 0;
  let mistet = 0;
  for (const [mappe, bilder] of perMappe) {
    const segments = path
      .relative(ROOT, mappe)
      .split(path.sep)
      .filter((s) => s && s !== ".");
    const navn = segments[segments.length - 1] ?? "";
    const kontekst = segments.slice(0, -1).reverse();

    let treff: { lat: number; lng: number } | null = null;
    // Mest kontekst først: «Februar, Ellingsrud, Alna, Oslo, Norge».
    for (let i = kontekst.length; i >= 0 && !treff; i--) {
      const query = [navn, ...kontekst.slice(0, i), "Oslo", "Norge"].join(", ");
      const hit = await geocodeAddress(query);
      if (hit && iOsloOmradet(hit.lat, hit.lng)) treff = hit;
      if (!process.env.GOOGLE_GEOCODING_API_KEY) await sleep(1100);
    }

    for (const p of bilder) {
      if (treff) {
        p.lat = treff.lat;
        p.lng = treff.lng;
        rettet++;
      } else {
        p.lat = null;
        p.lng = null;
        p.locationSource = "none";
        mistet++;
      }
    }
    console.log(
      `  ${navn.slice(0, 34).padEnd(34)} ${bilder.length} bilder → ` +
        (treff ? `${treff.lat.toFixed(5)}, ${treff.lng.toFixed(5)}` : "ingen treff i Oslo")
    );
    await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2));
  }

  console.log(`\n${rettet} bilder fikk ny posisjon, ${mistet} mistet posisjonen.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
