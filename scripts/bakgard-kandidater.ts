/**
 * Plukker ut adressene i Dropbox som kan supplere gårdsrom og fellesarealer.
 *
 * Arkivet er ikke organisert etter motiv, men etter oppdrag: mappene heter
 * «Nydalsveien 20C» og «Herslebs Gate 32b», og bakgårdsbildene ligger inni
 * dem sammen med alt annet fra den dagen. Et søk etter mapper som heter
 * «bakgård» finner derfor nesten ingenting.
 *
 * Dette leter i stedet etter mapper med en adresse matrikkelen kjenner, der
 * adressen deler et gårdsrom med naboene — altså der det finnes en bakgård
 * å fotografere — og der det er tatt bilder i sesong. Sen vår til tidlig
 * høst; et gårdsrom i november selger ingen leilighet.
 *
 * Lista er kandidater, ikke fasit: at det er fotografert på adressen betyr
 * ikke at noen av bildene viser gårdsrommet. Den sier hvor det er verdt å se.
 *
 *   npm run bakgard-kandidater
 */
import fs from "node:fs/promises";
import path from "node:path";
import { SESONG, type Mappe } from "./finn-bakgarder";

const CACHE = path.join(process.cwd(), ".cache");

/** Ordene som lover et fellesareal rett ut. */
const STIKKORD: Array<[RegExp, string]> = [
  [/bakg[åa]rd/i, "bakgård"],
  [/g[åa]rdsrom/i, "gårdsrom"],
  [/innhage/i, "innhage"],
  [/fellesareal/i, "fellesareal"],
  [/takterrasse|takhage/i, "takterrasse"],
  [/\bfasade/i, "fasade"],
];

// Samme mønster som prepare-static: «Grüners gate 1», «Magnus' gate 1A».
const ADRESSE = /(\p{Lu}[\p{L}.']*(?:\s+\p{Ll}[\p{L}.']*)*\s+\d+\s*\p{L}?)/gu;

type Treff = {
  adresse: string;
  mapper: string[];
  bilder: number;
  iSesong: number;
  måneder: Record<number, number>;
  /** Adressene som deler gårdsrommet, matrikkelen. */
  deler: string[];
  stikkord: string | null;
  alleredeInne: boolean;
  harBakgårdAlt: boolean;
};

async function les<T>(fil: string, standard: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), fil), "utf-8")) as T;
  } catch {
    return standard;
  }
}

/** «Herslebs Gate 32b» og «Herslebs gate 32B» er samme adresse. */
const nøkkel = (a: string) => a.replace(/\s+/g, " ").trim().toLowerCase();

async function main() {
  const tre = JSON.parse(await fs.readFile(path.join(CACHE, "dropbox-tre.json"), "utf-8")) as Mappe[];
  const gardsrom = await les<Record<string, string[]>>("data/gardsrom-adresse.json", {});
  const index = await les<{
    photos: Array<{ dropboxPath?: string; category?: string; adresser?: string[] }>;
  }>("data/index.json", { photos: [] });

  const inneMapper = new Set(
    index.photos
      .map((p) => p.dropboxPath)
      .filter((d): d is string => !!d)
      .map((d) => d.replace(/\/[^/]+$/, ""))
  );

  // Adresser som allerede har et fellesareal i portalen.
  const dekket = new Set<string>();
  for (const p of index.photos) {
    if (p.category !== "bakgard") continue;
    for (const a of p.adresser ?? []) dekket.add(nøkkel(a));
  }

  // Matrikkelen, slått opp uten hensyn til store bokstaver og husbokstav.
  const kjent = new Map<string, string>();
  for (const a of Object.keys(gardsrom)) {
    kjent.set(nøkkel(a), a);
    const grunn = nøkkel(a.replace(/\s*\p{Lu}$/u, ""));
    if (!kjent.has(grunn)) kjent.set(grunn, a);
  }

  const samlet = new Map<string, Treff>();

  for (const m of tre) {
    if (m.bilder === 0) continue;
    const navn = m.sti.split("/").pop() ?? "";

    const iSesong = Object.entries(m.mnd)
      .filter(([mn]) => SESONG.has(Number(mn)))
      .reduce((s, [, n]) => s + n, 0);
    if (iSesong === 0) continue;

    const stikk = STIKKORD.find(([re]) => re.test(navn))?.[1] ?? null;

    // Adressen leses fra mappenavnet; ellers fra mappa over, så
    // «Herslebs gate 32b/Bakgård» også treffer.
    const over = m.sti.split("/").slice(-2, -1)[0] ?? "";
    const funnet = [...navn.matchAll(ADRESSE), ...over.matchAll(ADRESSE)].map((x) =>
      x[1].replace(/\s+/g, " ").trim()
    );

    for (const rå of funnet) {
      const offisiell = kjent.get(nøkkel(rå));
      if (!offisiell) continue;
      const deler = gardsrom[offisiell] ?? [];
      // Et gårdsrom man deler med noen er en bakgård. Står adressen alene,
      // er det som regel en enebolig eller en teig uten fellesareal.
      if (deler.length < 2) continue;

      const t = samlet.get(offisiell) ?? {
        adresse: offisiell,
        mapper: [],
        bilder: 0,
        iSesong: 0,
        måneder: {},
        deler,
        stikkord: null,
        alleredeInne: false,
        harBakgårdAlt: dekket.has(nøkkel(offisiell)),
      };
      t.mapper.push(m.sti);
      t.bilder += m.bilder;
      t.iSesong += iSesong;
      for (const [mn, n] of Object.entries(m.mnd)) {
        t.måneder[Number(mn)] = (t.måneder[Number(mn)] ?? 0) + n;
      }
      if (stikk) t.stikkord = stikk;
      if (inneMapper.has(m.sti)) t.alleredeInne = true;
      samlet.set(offisiell, t);
      break; // én adresse per mappe holder
    }
  }

  const alle = [...samlet.values()];
  const nye = alle.filter((t) => !t.alleredeInne && !t.harBakgårdAlt);
  nye.sort((a, b) => Number(!!b.stikkord) - Number(!!a.stikkord) || b.iSesong - a.iSesong);

  await fs.writeFile(path.join(CACHE, "bakgard-kandidater.json"), JSON.stringify(nye, null, 1));

  const navn = ["", "jan", "feb", "mar", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "des"];
  const mndTekst = (m: Record<number, number>) =>
    Object.entries(m)
      .filter(([mn]) => SESONG.has(Number(mn)))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([mn, n]) => `${navn[Number(mn)]} ${n}`)
      .join(", ");

  console.log(
    [
      `${tre.length} mapper i Dropbox gjennomgått`,
      `${alle.length} adresser matrikkelen kjenner, med delt gårdsrom og bilder i sesong`,
      `${alle.filter((t) => t.alleredeInne).length} er allerede i portalen`,
      `${alle.filter((t) => t.harBakgårdAlt).length} har alt et fellesareal i portalen`,
      `${nye.length} nye kandidater`,
    ].join("\n")
  );

  const sikre = nye.filter((t) => t.stikkord);
  if (sikre.length) {
    console.log(`\n=== ${sikre.length} med fellesareal i mappenavnet ===\n`);
    for (const t of sikre) {
      console.log(`  ${t.adresse}  (${t.stikkord}) — deler gårdsrom med ${t.deler.length} adresser`);
      console.log(`     ${t.iSesong} bilder i sesong: ${mndTekst(t.måneder)}`);
      for (const m of t.mapper.slice(0, 3)) console.log(`     ${m}`);
    }
  }

  console.log(`\n=== ${nye.length - sikre.length} adresser å se gjennom ===\n`);
  for (const t of nye.filter((x) => !x.stikkord).slice(0, 80)) {
    console.log(`  ${t.adresse} — ${t.deler.length} adresser deler gårdsrommet`);
    console.log(`     ${t.iSesong} i sesong (${mndTekst(t.måneder)})  ·  ${t.mapper[0]}`);
  }
  console.log(`\nHele lista: .cache/bakgard-kandidater.json`);
}

main().catch((e) => {
  console.error(String(e).slice(0, 600));
  process.exit(1);
});
