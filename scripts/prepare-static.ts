import fs from "node:fs/promises";
import path from "node:path";
import type { SearchIndex } from "../src/lib/index-store";
import {
  BYGNING_KATEGORIER as BYGNING,
  FELLESAREAL_KATEGORIER as FELLESAREAL,
} from "../src/lib/categories";

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

/**
 * Dropbox lager «Folkvang Boligselskap (1)» når en mappe kopieres inn på
 * nytt. Da ligger de samme bildene to ganger, og oppslaget viser hvert bilde
 * dobbelt. En fil med samme navn i en mappe som bare skiller seg med «(n)»
 * regnes som samme bilde, og bare det første beholdes.
 */
/**
 * Mapper Scott har bedt om å holde utenfor — Grefsenkollen fra Dropbox er
 * erstattet av nyere bilder fra Immich. Lista ligger i data/utelat.json,
 * så et valg ikke forsvinner ved neste sync.
 */
async function utelatteMapper(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), "data", "utelat.json"), "utf-8");
    const { mapper } = JSON.parse(raw) as { mapper?: string[] };
    return new Set((mapper ?? []).map((m) => m.trim().toLowerCase()));
  } catch {
    return new Set();
  }
}

function ikkeUtelatt(utelatte: Set<string>) {
  return (p: { dropboxPath: string }) => {
    if (p.dropboxPath.startsWith("immich://")) return true;
    const mappe = path.posix.basename(path.posix.dirname(p.dropboxPath)).trim().toLowerCase();
    return !utelatte.has(mappe);
  };
}

function ikkeKopi() {
  const sett = new Set<string>();
  return (p: { dropboxPath: string }) => {
    if (p.dropboxPath.startsWith("immich://")) return true;
    const nøkkel = p.dropboxPath
      .toLowerCase()
      .replace(/\s*\(\d+\)(?=\/[^/]+$)/, "");
    if (sett.has(nøkkel)) return false;
    sett.add(nøkkel);
    return true;
  };
}

type BygardData = { adresseTilBygard: Record<string, string> };


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

  /** Alle oppgangene med samme husnummer: «Magnus' gate 1» → 1A, 1B, 1C. */
  const oppganger = new Map<string, string[]>();
  for (const adresse of Object.keys(bygarder.adresseTilBygard)) {
    const grunnform = adresse.replace(/\s*\p{Lu}$/u, "").trim();
    const liste = oppganger.get(grunnform) ?? [];
    liste.push(adresse);
    oppganger.set(grunnform, liste);
  }
  function heleBygningen(adresser: string[]): string[] {
    const alle = new Set<string>();
    for (const a of adresser) {
      alle.add(a);
      for (const o of oppganger.get(a.replace(/\s*\p{Lu}$/u, "").trim()) ?? []) alle.add(o);
    }
    return [...alle].sort();
  }

  /**
   * Borettslag som spenner flere husnumre (data/borettslag.json). Er én av
   * bildets adresser med i et lag, hører bildet til hele laget:
   * Akebakkeskogen 64B sin bakgård er borettslagets, ikke oppgangens.
   */
  const borettslag: Array<{ navn: string; adresser: Set<string> }> = [];
  try {
    const raw = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "borettslag.json"), "utf-8")
    ) as Record<string, { gater?: string[]; adresser?: string[] }>;
    for (const [navn, def] of Object.entries(raw)) {
      if (navn === "_") continue;
      const sett = new Set<string>(def.adresser ?? []);
      for (const gate of def.gater ?? []) {
        for (const a of Object.keys(adressepunkter)) {
          if (a.startsWith(`${gate} `)) sett.add(a);
        }
      }
      if (sett.size) borettslag.push({ navn, adresser: sett });
    }
  } catch {
    // Ingen liste — da er bygningen grensen.
  }
  function heleBorettslaget(adresser: string[]): string[] {
    const laget = borettslag.find((b) => adresser.some((a) => b.adresser.has(a)));
    return laget ? [...new Set([...adresser, ...laget.adresser])].sort() : adresser;
  }

  /** Nærmeste adresse innen `maks` meter — lenger unna er vi ikke i samme kvartal. */
  function adresseFraPunkt(lat: number, lng: number, maks = 80): string | null {
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

    return !beste || beste.d > maks ? null : beste.adresse;
  }

  function bygardFraPunkt(lat: number, lng: number): string | null {
    const adresse = adresseFraPunkt(lat, lng);
    return adresse ? rimeligKvartal(bygarder.adresseTilBygard[adresse] ?? null) : null;
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
  /**
   * Adressene bak et gårdsnavn i stedsnavnet, f.eks. «Torshov Kvartal IX
   * Tysklandsgården». Navnet må stå som hele ord: «Solgården» skal ikke
   * treffe midt inne i et lengre navn, og «Kvartal VI» ikke «Kvartal VII».
   */
  function kallenavnFor(placeName: string): string[] | null {
    const tekst = placeName.toLowerCase();
    const ordtegn = /[\p{L}\p{N}]/u;
    for (const [navn, verdi] of Object.entries(kallenavn)) {
      const i = tekst.indexOf(navn.toLowerCase());
      if (i === -1) continue;
      const etter = tekst[i + navn.length];
      if ((i > 0 && ordtegn.test(tekst[i - 1])) || (etter && ordtegn.test(etter))) continue;
      return Array.isArray(verdi) ? verdi : [verdi];
    }
    return null;
  }

  function adresserFor(placeName: string): string[] | null {
    const fraNavn = kallenavnFor(placeName);
    if (fraNavn) {
      const liste = fraNavn.filter(
        (a) => a && (bygarder.adresseTilBygard[a] || utenBokstav.has(a))
      );
      if (liste.length) return liste;
    }
    const treff = adresseINavn(placeName);
    return treff ? [treff] : null;
  }

  /**
   * Adressen som står i navnet. Hver del mellom bindestreker prøves fra
   * hvert ord og ut: «Bakgård - Christian Schous vei 3F» gir «Christian
   * Schous vei 3F». Regex-en klarte ikke gatenavn med flere store
   * bokstaver, så Christian Schous vei og Hans Nielsen Hauges gate falt ut.
   */
  function adresseINavn(placeName: string): string | null {
    for (const del of placeName.split(/\s*[–—,]\s*|\s+-\s*|\s*-\s+/)) {
      const ord = del.replace(/\s+/g, " ").trim().split(" ");
      for (let i = 0; i < ord.length - 1; i++) {
        const kandidat = ord.slice(i).join(" ");
        if (bygarder.adresseTilBygard[kandidat] || utenBokstav.has(kandidat) || adressepunkter[kandidat]) {
          return kandidat;
        }
      }
    }
    return null;
  }

  function bygardFor(placeName: string): string | null {
    for (const a of kallenavnFor(placeName) ?? []) {
      const treff = rimeligKvartal(slåOpp(a));
      if (treff) return treff;
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
  const utelatte = await utelatteMapper();
  const publishable = index.photos
    .map((p) => {
      const overstyring = steder[p.placeName];
      // Et gårdsnavn fra navnelisten er et bevisst valg, og veier tyngre
      // enn stedsoppslaget i steder.json — der er Søylegården bare et
      // «nabolag», fordi OSM merker punktet som et sted. Da ble gården
      // vist i hvert søk i gangavstand.
      const gård = kallenavnFor(p.placeName);
      const fraOppslag = overstyring?.kategori ?? p.category;
      const ønsket = gård && !FELLESAREAL.has(fraOppslag) ? "bakgard" : fraOppslag;
      const erFelles = FELLESAREAL.has(ønsket);

      // Mapper uten GPS («Torshov Kvartal IX Tysklandsgården») får midten
      // av gårdens adresser som posisjon, så de kan søkes opp. Det samme
      // gjelder posisjoner som bare er gjettet ut fra mappenavnet: da havnet
      // «Folkvang Boligselskap» i Folkvangveien.
      let { lat, lng } = p;
      if (gård && p.locationSource !== "exif") {
        const pkt = gård.map((a) => adressepunkter[a]).filter(Boolean);
        if (pkt.length) {
          lat = pkt.reduce((s, [la]) => s + la, 0) / pkt.length;
          lng = pkt.reduce((s, [, ln]) => s + ln, 0) / pkt.length;
        }
      }

      // En takterrasse eller fasade hører til bygningen, ikke kvartalet.
      // Den knyttes til adressen i navnet, ellers til nærmeste adresse, og
      // utvides til alle oppgangene med samme husnummer. Kvartalet brukes
      // ikke — det var slik Magnus' gate 13 fikk takterrassen til nr. 1A.
      const erBygning = BYGNING.has(ønsket);
      let adresser = erFelles ? adresserFor(p.placeName) : null;
      if (erBygning) {
        if (!adresser && lat !== null && lng !== null) {
          const nærmeste = adresseFraPunkt(lat, lng, 40);
          if (nærmeste) adresser = [nærmeste];
        }
        if (adresser) adresser = heleBygningen(adresser);
      }
      // Et bilde som bare har en adresse som navn — ingen beskrivelse, ikke
      // noe sted på kartet — er tatt på eiendommen: blokka, lekeplassen,
      // inngangen. Det hører til adressen, ikke til alle i gangavstand.
      // Grefsenkollveien 16A dukket ellers opp hos alle naboene.
      const stedsnavn0 = p.placeName.trim();
      if (!erFelles && adressepunkter[stedsnavn0]) {
        adresser = heleBygningen([stedsnavn0]);
      }
      if (adresser) adresser = heleBorettslaget(adresser);
      const bygardId = erBygning
        ? null
        : erFelles
          ? bygardFor(p.placeName) ??
            (lat !== null && lng !== null ? bygardFraPunkt(lat, lng) : null)
          : (p.bygardId ?? null);

      // En bakgård uten brukbart kvartal — i Grefsen er kvartalet en klump
      // på to tusen adresser — knyttes til bygningen i stedet, slik
      // takterrassene gjør. Ellers ble den «annet» og vist til hele nabolaget.
      if (erFelles && !erBygning && !bygardId) {
        if (!adresser && lat !== null && lng !== null) {
          const nærmeste = adresseFraPunkt(lat, lng, 40);
          if (nærmeste) adresser = [nærmeste];
        }
        if (adresser) adresser = heleBygningen(adresser);
      }

      // Et fellesareal lover at bildet hører til nettopp denne adressen.
      // Klarer vi ikke å innfri løftet, skal bildet heller ikke bære
      // merkelappen — da ville et gårdsrom blitt vist til hele nabolaget.
      const kanKnyttes = !!bygardId || !!adresser?.length;
      const category = erFelles && !kanKnyttes ? "annet" : ønsket;

      // Et fellesareal bør stå med adressen sin. Dropbox-mappene har Scott
      // navngitt selv og skal stå som de er, men Immich-navnene er slått opp
      // fra kartet — og da endte et gårdsrom opp med å hete «Dronningens
      // kebab» etter nærmeste butikk. Navn som allerede bærer et husnummer
      // er gode nok som de er.
      const navn = overstyring?.navn ?? p.placeName;
      const fraKart = p.id.startsWith("immich:") && !/\d/.test(navn);
      const stedsnavn =
        (erFelles && fraKart && kanKnyttes
          ? adresser?.[0] ??
            (lat !== null && lng !== null ? adresseFraPunkt(lat, lng) : null)
          : null) ?? navn;

      return {
        ...p,
        lat,
        lng,
        thumb: thumbFor(p.id),
        category,
        placeName: stedsnavn,
        adresser,
        bygardId,
      };
    })
    .filter((p) => p.lat !== null && p.lng !== null && p.thumb)
    .filter(ikkeKopi())
    .filter(ikkeUtelatt(utelatte));

  const slim = publishable.map((p) => ({
    id: p.id,
    category: p.category,
    placeName: p.placeName,
    lat: p.lat,
    lng: p.lng,
    thumb: p.thumb,
    ...(p.bygardId ? { bygardId: p.bygardId } : {}),
    ...(p.adresser?.length ? { adresser: p.adresser } : {}),
    ...(p.original ? { original: p.original, filnavn: p.filnavn ?? null } : {}),
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

  const bortvalgt = index.photos.filter((p) => !ikkeUtelatt(utelatte)(p)).length;
  const uten = index.photos.length - publishable.length - bortvalgt;
  console.log(`Publiserer ${publishable.length} av ${index.photos.length} bilder.`);
  console.log(`  ${uten} utelatt (mangler posisjon eller miniatyr)`);
  if (bortvalgt) console.log(`  ${bortvalgt} holdt utenfor via data/utelat.json`);
  console.log(`  index.json: ${await size("index.json")} MB`);
  console.log(
    `  adresse-til-bygard.json: ${await size("adresse-til-bygard.json")} MB (${addresses} adresser, ${relevante.size} kvartaler)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
