/**
 * Henter kameramodellen for Immich-bildene og skriver den inn i indeksen.
 *
 * Fotografen står ingen steder i dataene: alle bildene har samme eier, og
 * ingen har artist- eller copyright-felt. Kameraet er det nærmeste vi
 * kommer, og med `data/fotografer.json` kan modellen oversettes til et navn.
 *
 *   npm run kamera
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import type { SearchIndex } from "../src/lib/index-store";

const URL_ = process.env.IMMICH_URL || "https://immich.vikran.net";
const KEY = process.env.IMMICH_SHARE_KEY || "";
const INDEX = path.join(process.cwd(), "data", "index.json");

async function exif(id: string): Promise<string | null> {
  const r = await fetch(`${URL_}/api/assets/${id}?key=${KEY}`);
  if (!r.ok) return null;
  const a = (await r.json()) as { exifInfo?: { make?: string; model?: string } };
  const navn = [a.exifInfo?.make, a.exifInfo?.model].filter(Boolean).join(" ").trim();
  return navn || null;
}

async function main() {
  const index: SearchIndex = JSON.parse(await fs.readFile(INDEX, "utf-8"));
  const immich = index.photos.filter(
    (p) => p.id.startsWith("immich:") && !(p as { kamera?: string }).kamera
  );
  console.log(`${immich.length} Immich-bilder uten kameramodell.`);

  let n = 0;
  const kø = [...immich];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (;;) {
        const p = kø.pop();
        if (!p) return;
        const k = await exif(p.id.replace(/^immich:/, ""));
        if (k) (p as { kamera?: string }).kamera = k;
        if (++n % 200 === 0) console.log(`  ${n}/${immich.length} …`);
      }
    })
  );

  await fs.writeFile(INDEX, JSON.stringify(index, null, 2));
  const tell = new Map<string, number>();
  for (const p of index.photos) {
    const k = (p as { kamera?: string }).kamera;
    if (k) tell.set(k, (tell.get(k) ?? 0) + 1);
  }
  console.log("\nkameraer i indeksen:");
  for (const [k, v] of [...tell].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
