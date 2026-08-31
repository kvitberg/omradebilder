import fs from "node:fs/promises";
import path from "node:path";
import type { SearchIndex } from "../src/lib/index-store";

/**
 * Lager datafilene den statiske siden laster i nettleseren.
 *
 * To ting skjer her utover ren kopiering:
 *
 *  - `dropboxPath` fjernes. Den trengs ikke når miniatyrene er ferdig
 *    generert, og den ville ellers publisert hele mappestrukturen i arkivet.
 *  - Bygårdskartet trimmes fra 106 000 adresser til bare de kvartalene som
 *    faktisk har bakgårdsbilder, som tar det fra 3,3 MB til noen få kB.
 */

const OUT_DIR = path.join(process.cwd(), "public", "data");

type BygardData = { adresseTilBygard: Record<string, string> };

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const index: SearchIndex = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "data", "index.json"), "utf-8")
  );

  // Hvilke bilder som har miniatyr avgjøres av hva som faktisk ligger på
  // disk, ikke av `thumb`-feltet i indeksen. Genereringen tar timer og kan
  // bli avbrutt underveis; da ville feltet vært utdatert, mens filene er
  // fasit uansett hvor langt den kom.
  const onDisk = new Set(
    (await fs.readdir(path.join(process.cwd(), "public", "thumbs")).catch(() => [])).filter((f) =>
      f.endsWith(".webp")
    )
  );

  const thumbFor = (id: string) => {
    const file = id.replace(/^id:/, "").replace(/[^A-Za-z0-9_-]/g, "") + ".webp";
    return onDisk.has(file) ? `/thumbs/${file}` : null;
  };

  // Bilder uten posisjon kan aldri treffes av et søk, og bilder uten miniatyr
  // ville bare blitt et hull i oppslaget. Begge utelates.
  const publishable = index.photos
    .map((p) => ({ ...p, thumb: thumbFor(p.id) }))
    .filter((p) => p.lat !== null && p.lng !== null && p.thumb);

  const slim = publishable.map((p) => ({
    id: p.id,
    category: p.category,
    placeName: p.placeName,
    lat: p.lat,
    lng: p.lng,
    thumb: p.thumb,
    ...(p.bygardId ? { bygardId: p.bygardId } : {}),
  }));

  await fs.writeFile(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({ generatedAt: index.generatedAt, photos: slim })
  );

  // Bare kvartaler som har minst ett bakgårdsbilde er verdt å ta med.
  const relevante = new Set(
    publishable.filter((p) => p.category === "bakgard" && p.bygardId).map((p) => p.bygardId!)
  );

  let addresses = 0;
  try {
    const bygarder: BygardData = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "bygarder.json"), "utf-8")
    );
    const trimmed: Record<string, string> = {};
    for (const [address, id] of Object.entries(bygarder.adresseTilBygard)) {
      if (relevante.has(id)) trimmed[address] = id;
    }
    addresses = Object.keys(trimmed).length;
    await fs.writeFile(path.join(OUT_DIR, "adresse-til-bygard.json"), JSON.stringify(trimmed));
  } catch {
    await fs.writeFile(path.join(OUT_DIR, "adresse-til-bygard.json"), "{}");
  }

  const size = async (f: string) =>
    ((await fs.stat(path.join(OUT_DIR, f))).size / 1024 / 1024).toFixed(2);

  const uten = index.photos.length - publishable.length;
  console.log(`Publiserer ${publishable.length} av ${index.photos.length} bilder.`);
  console.log(`  ${uten} utelatt (mangler posisjon eller miniatyr)`);
  console.log(`  index.json: ${await size("index.json")} MB`);
  console.log(
    `  adresse-til-bygard.json: ${await size("adresse-til-bygard.json")} MB (${addresses} adresser, ${relevante.size} kvartaler)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
