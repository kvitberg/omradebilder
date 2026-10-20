/**
 * Hvilke tagger finnes i Immich, hva blir de til, og hvor skurrer det?
 *
 * Taggen går foran alt annet i klassifiseringen, så en tagg satt på et helt
 * opptak følger med på hvert bilde i det — også de som viser noe annet.
 * Denne rapporten viser hvilke tagger som er i bruk, hvilke portalen ikke
 * kjenner, og hvilke bilder som er tagget som én ting men heter noe som
 * ellers er en annen.
 *
 *   npm run tagg-rapport
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs/promises";
import { categoryFromTags, detectCategory, getCategory } from "../src/lib/categories";

const URL_ = process.env.IMMICH_URL!;
const KEY = process.env.IMMICH_SHARE_KEY!;

async function api<T>(p: string): Promise<T> {
  const r = await fetch(`${URL_}/api${p}${p.includes("?") ? "&" : "?"}key=${KEY}`);
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function main() {
  const share = await api<{ album?: { id: string } }>("/shared-links/me");
  const albumId = share.album!.id;
  const buckets = await api<Array<{ timeBucket: string }>>(`/timeline/buckets?albumId=${albumId}`);
  const ids: string[] = [];
  for (const b of buckets) {
    const d = await api<{ id: string[] } | Array<{ id: string }>>(
      `/timeline/bucket?albumId=${albumId}&timeBucket=${b.timeBucket}`
    );
    ids.push(...(Array.isArray(d) ? d.map((a) => a.id) : d.id));
  }

  const pub = JSON.parse(await fs.readFile("public/data/index.json", "utf-8")) as {
    photos: Array<{ id: string; placeName: string; category: string }>;
  };
  const publisert = new Map(pub.photos.map((p) => [p.id, p]));

  const tellTagg = new Map<string, number>();
  const ukjent = new Map<string, number>();
  const utagget: string[] = [];
  const perTagg = new Map<string, Map<string, number>>(); // tagg -> stedsnavn -> antall

  let n = 0;
  const kø = [...ids];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const id = kø.pop();
        if (!id) return;
        try {
          const a = await api<{ tags?: Array<{ value?: string; name?: string }> }>(`/assets/${id}`);
          const tagger = (a.tags ?? []).map((t) => (t.value || t.name || "").trim()).filter(Boolean);
          if (!tagger.length) utagget.push(id);
          for (const t of tagger) {
            tellTagg.set(t, (tellTagg.get(t) ?? 0) + 1);
            const kjent = categoryFromTags([t]) ?? (detectCategory([t]).categoryId !== "annet" ? detectCategory([t]).categoryId : null);
            if (!kjent) ukjent.set(t, (ukjent.get(t) ?? 0) + 1);
            const p = publisert.get(`immich:${id}`);
            if (p) {
              const m = perTagg.get(t) ?? new Map<string, number>();
              m.set(p.placeName, (m.get(p.placeName) ?? 0) + 1);
              perTagg.set(t, m);
            }
          }
        } catch {
          /* hopper over */
        }
        if (++n % 400 === 0) console.log(`  ${n}/${ids.length} …`);
      }
    })
  );

  console.log(`\n=== ${tellTagg.size} tagger i bruk på ${ids.length} bilder ===\n`);
  for (const [t, c] of [...tellTagg].sort((a, b) => b[1] - a[1])) {
    const kat = categoryFromTags([t]);
    const fall = detectCategory([t]).categoryId;
    const blir = kat ?? (fall !== "annet" ? fall : null);
    console.log(`  ${String(c).padStart(5)}  ${t.padEnd(16)} -> ${blir ? getCategory(blir).label : "ANNET (ukjent)"}`);
  }

  if (ukjent.size) {
    console.log(`\n=== ${ukjent.size} tagger portalen ikke kjenner ===`);
    for (const [t, c] of [...ukjent].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(5)}  ${t}`);
  }
  console.log(`\n${utagget.length} bilder uten tagg i det hele tatt.`);

  await fs.writeFile(
    ".cache/tagg-rapport.json",
    JSON.stringify(
      { tagger: [...tellTagg], ukjent: [...ukjent], utagget: utagget.length, perTagg: [...perTagg].map(([t, m]) => [t, [...m]]) },
      null,
      1
    )
  );
  console.log("\nDetaljer i .cache/tagg-rapport.json");
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
