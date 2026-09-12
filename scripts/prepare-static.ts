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

/**
 * Kategorier som hører til en bestemt bygning, ikke til gangavstanden.
 * Et gårdsrom og en takterrasse deles av kvartalet, og en fasade er selve
 * bygget — ingen av dem hører hjemme i naboens salgsoppgave.
 */
const FELLESAREAL = new Set(["bakgard", "takterrasse", "fasade"]);

/**
 * Teig-grupperingen limer av og til sammen store områder der eiendommer
 * berører hverandre uten at en gate skiller dem. Slike klumper forkastes.
 *
 * Målestokken er utstrekning, ikke antall adresser: et tett kvartal kan ha
 * 76 adresser og likevel være ett gårdsrom, mens en sammenlimt klump
 * strekker seg over kilometer. Diagonalen i omslutningsboksen skiller de to.
 */
const MAKS_KVARTAL_METER = 600;

/**
 * Utstrekning alene er ikke nok: en sammenlimt klump kan være både lang og
 * folkerik (2169 adresser over 52 gater), mens et ekte kvartal er langt,
 * men tynt befolket. Begge grensene må holde.
 */
const MAKS_ADRESSER_I_KVARTAL = 80;

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const index: SearchIndex = JSON.parse(
    await fs.readFile(path.join(process.cwd(), "data", "index.json"), "utf-8")
  );

  // Bygårdskoblingen utledes her, ikke i sync-scriptet: matrikkeldataene
  // oppdateres uavhengig av Dropbox, og et bygg skal ikke kreve ny sync.
  let bygarder: { adresseTilBygard: Record<string, string> } = { adresseTilBygard: {} };
  try {
    bygarder = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "bygarder.json"), "utf-8")
    );
  } catch {
    /* uten fila faller bakgårdene tilbake på avstandsfilteret */
  }

  // Adressepunkter fra matrikkelen: lar et bakgårdsbilde finne kvartalet
  // sitt ut fra hvor det faktisk er tatt. Immich-bilder har ekte GPS, men
  // stedsnavnet sier gjerne bare «Torshov» — da er punktet eneste holdepunkt.
  let adressepunkter: Record<string, [number, number]> = {};
  try {
    adressepunkter = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "adressepunkter.json"), "utf-8")
    );
  } catch {
    adressepunkter = {};
  }

  // En oppføring kan peke på én adresse eller flere: Grefsen Terrassehus
  // dekker Grefsenkollveien 12A til 12E.
  let kallenavn: Record<string, string | string[]> = {};
  try {
    kallenavn = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "bakgard-navn.json"), "utf-8")
    );
  } catch {
    kallenavn = {};
  }

  // Matrikkelen skriver «Torshovgata 10A», mens mappenavn gjerne sier
  // «Torshovgata 10». Et register over adresser uten bokstav lar oss slå
  // opp begge former.
  const utenBokstav = new Map<string, string>();
  for (const [adresse, id] of Object.entries(bygarder.adresseTilBygard)) {
    const grunnform = adresse.replace(/\s*\p{Lu}$/u, "").trim();
    if (grunnform !== adresse && !utenBokstav.has(grunnform)) {
      utenBokstav.set(grunnform, id);
    }
  }

  /**
   * Finner eiendommen et bakgårdsbilde hører til. Mappenavnet må inneholde
   * en adresse med husnummer («Bakgård - Torshovgata 10»), eller et kallenavn
   * som står i data/bakgard-navn.json.
   */
  // Unicode-kategorier, ikke A-Z: gatenavn som «Grüners gate» har tegn
  // utenfor det norske alfabetet.
  const ADRESSE = /(\p{Lu}[\p{L}.']*(?:\s+\p{Ll}[\p{L}.']*)*\s+\d+\s*\p{L}?)/gu;

  function slåOpp(adresse: string): string | null {
    const ren = adresse.replace(/\s+/g, " ").trim();
    return bygarder.adresseTilBygard[ren] ?? utenBokstav.get(ren) ?? null;
  }

  /** Nærmeste adresse innen 80 m — lenger unna er vi ikke i samme kvartal. */
  function bygardFraPunkt(lat: number, lng: number): string | null {
    const R = 6371000;
    const rad = (d: number) => (d * Math.PI) / 180;
    let beste: { adresse: string; d: number } | null = null;

    for (const [adresse, [alat, alng]] of Object.entries(adressepunkter)) {
      // Grovfilter først: ett breddegrad-minutt er ca. 1,85 km.
      if (Math.abs(alat - lat) > 0.002 || Math.abs(alng - lng) > 0.004) continue;
      const dLat = rad(alat - lat);
      const dLng = rad(alng - lng);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(lat)) * Math.cos(rad(alat)) * Math.sin(dLng / 2) ** 2;
      const d = 2 * R * Math.asin(Math.sqrt(h));
      if (!beste || d < beste.d) beste = { adresse, d };
    }

    if (!beste || beste.d > 80) return null;
    return rimeligKvartal(bygarder.adresseTilBygard[beste.adresse] ?? null);
  }

  /** Forkaster kvartaler som strekker seg for langt til å være ett gårdsrom. */
  const kvartalOk = new Map<string, boolean>();
  for (const g of (bygarder as unknown as { bygarder?: Array<{ id: string; adresser: string[] }> })
    .bygarder ?? []) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    let n = 0;
    for (const a of g.adresser) {
      const pkt = adressepunkter[a];
      if (!pkt) continue;
      n++;
      minLat = Math.min(minLat, pkt[0]);
      maxLat = Math.max(maxLat, pkt[0]);
      minLng = Math.min(minLng, pkt[1]);
      maxLng = Math.max(maxLng, pkt[1]);
    }
    if (n === 0) {
      kvartalOk.set(g.id, false);
      continue;
    }
    // Grader til meter: 111 km per breddegrad, og lengdegrad krympet med
    // breddegraden (cos ≈ 0,5 i Oslo).
    const høyde = (maxLat - minLat) * 111_320;
    const bredde = (maxLng - minLng) * 111_320 * Math.cos((minLat * Math.PI) / 180);
    kvartalOk.set(
      g.id,
      Math.hypot(høyde, bredde) <= MAKS_KVARTAL_METER && n <= MAKS_ADRESSER_I_KVARTAL
    );
  }
  function rimeligKvartal(id: string | null): string | null {
    return id && kvartalOk.get(id) ? id : null;
  }

  /**
   * Adressen som står i selve stedsnavnet, f.eks. «Fasade -Brekkeveien 19».
   * Dette er den presise koblingen: bildet hører til den adressen, uansett
   * hvor stort eller spredt kvartalet rundt måtte være.
   */
  function adresserFor(placeName: string): string[] | null {
    for (const [navn, verdi] of Object.entries(kallenavn)) {
      if (!placeName.toLowerCase().includes(navn.toLowerCase())) continue;
      const liste = (Array.isArray(verdi) ? verdi : [verdi]).filter(
        (a) => a && (bygarder.adresseTilBygard[a] || utenBokstav.has(a))
      );
      if (liste.length) return liste;
    }
    for (const del of placeName.split(/\s*[–—,-]\s*/)) {
      ADRESSE.lastIndex = 0;
      for (const m of del.matchAll(ADRESSE)) {
        const kandidat = m[1].replace(/\s+/g, " ").trim();
        if (bygarder.adresseTilBygard[kandidat] || utenBokstav.has(kandidat)) return [kandidat];
      }
    }
    return null;
  }

  function bygardFor(placeName: string): string | null {
    for (const [navn, verdi] of Object.entries(kallenavn)) {
      if (!placeName.toLowerCase().includes(navn.toLowerCase())) continue;
      for (const a of Array.isArray(verdi) ? verdi : [verdi]) {
        const treff = rimeligKvartal(slåOpp(a));
        if (treff) return treff;
      }
    }

    // Mappenavn er sammensatte («Bakgård - Grüners gate 1»), så vi leter i
    // hver del for seg. Ellers sluker adressemønsteret kategoriordet med.
    for (const del of placeName.split(/\s*[–—,-]\s*/)) {
      ADRESSE.lastIndex = 0;
      for (const m of del.matchAll(ADRESSE)) {
        const treff = rimeligKvartal(slåOpp(m[1]));
        if (treff) return treff;
      }
    }
    return null;
  }

  // Overstyringer fra `npm run steder` (og dine egne rettelser der).
  let steder: Record<string, { kategori: string; navn?: string }> = {};
  try {
    steder = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "steder.json"), "utf-8")
    );
  } catch {
    steder = {};
  }

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
    .map((p) => {
      const overstyring = steder[p.placeName];
      const category = overstyring?.kategori ?? p.category;
      return {
        ...p,
        thumb: thumbFor(p.id),
        category,
        placeName: overstyring?.navn ?? p.placeName,
        adresser: FELLESAREAL.has(category) ? adresserFor(p.placeName) : null,
        bygardId:
          FELLESAREAL.has(category)
            ? bygardFor(p.placeName) ??
              (p.lat !== null && p.lng !== null ? bygardFraPunkt(p.lat, p.lng) : null)
            : p.bygardId ?? null,
      };
    })
    .filter((p) => p.lat !== null && p.lng !== null && p.thumb);

  const slim = publishable.map((p) => ({
    id: p.id,
    category: p.category,
    placeName: p.placeName,
    lat: p.lat,
    lng: p.lng,
    thumb: p.thumb,
    ...(p.bygardId ? { bygardId: p.bygardId } : {}),
    ...(p.adresser?.length ? { adresser: p.adresser } : {}),
  }));

  await fs.writeFile(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({ generatedAt: index.generatedAt, photos: slim })
  );

  // Bare kvartaler som har minst ett bakgårdsbilde er verdt å ta med.
  const relevante = new Set(
    publishable.filter((p) => FELLESAREAL.has(p.category) && p.bygardId).map((p) => p.bygardId!)
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
