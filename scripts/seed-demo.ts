import fs from "node:fs";
import path from "node:path";
import type { PhotoEntry, SearchIndex } from "../src/lib/index-store";

/**
 * Fyller data/index.json med et lite demo-datasett rundt Bjørvika i Oslo,
 * slik at portalen kan utforskes før Dropbox er koblet til.
 *
 * `npm run sync` overskriver dette med dine ekte bilder.
 */

const CENTER = { lat: 59.9075, lng: 10.753 };

const DEMO: Array<[string, string[]]> = [
  ["kafe", ["Tim Wendelboe", "Kaffebrenneriet Sørenga", "Fuglen Bjørvika", "Java Espressobar"]],
  ["restaurant", ["Vippa Streetfood", "Sørenga Kro", "Bar Vulkan"]],
  ["park", ["Sørenga Sjøbad", "Middelalderparken", "Operaparken"]],
  ["fasade", ["Operaen fasade", "Barcode Rekke B"]],
  ["takterrasse", ["Rostockgata 86 tak"]],
  ["bakgard", ["Rostockgata 86 gårdsrom", "Dronning Eufemias gate 12"]],
];

const photos: PhotoEntry[] = [];
let i = 0;

for (const [category, places] of DEMO) {
  for (const placeName of places) {
    i++;
    photos.push({
      id: `demo-${i}`,
      dropboxPath: `/Demo/${category}/${placeName}.jpg`,
      category,
      placeName,
      // Spredt deterministisk rundt sentrum, innenfor ca. 400 m.
      lat: CENTER.lat + Math.sin(i * 1.7) * 0.0032,
      lng: CENTER.lng + Math.cos(i * 2.3) * 0.0055,
      locationSource: "exif",
      clientModified: "2026-08-01T12:00:00Z",
    });
  }
}

const index: SearchIndex = { generatedAt: new Date().toISOString(), photos };
const outPath = path.join(process.cwd(), "data", "index.json");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(index, null, 2));

console.log(`Demo-indeks skrevet til ${outPath} (${photos.length} bilder).`);
console.log("Start med 'npm run dev'. Kjør 'npm run sync' for å bytte til dine ekte bilder.");
