/**
 * Bygger `data/bygarder.json` — en gruppering av Oslos eiendommer i
 * kvartaler ("bygårder"), slik at alle adressene rundt samme gårdsrom
 * kan slås opp fra én adresse.
 *
 * Grupperingen er rent geometrisk: to teiger som deler et hjørnepunkt
 * ligger vegg-i-vegg og hører til samme kvartal. Ved å runde koordinatene
 * til desimeter og kjøre union-find på delte punkter slipper vi å regne
 * polygon-union, og hele jobben går i ren TypeScript.
 *
 * Bare teiger som har minst én adresse er med. Veigrunn er nemlig også
 * registrert som teiger, og siden veinettet henger sammen gjennom hele
 * byen ville det ellers limt samtlige kvartaler til én klump. Gatene er
 * det som skiller kvartalene fra hverandre, så de må holdes utenfor.
 *
 * Datagrunnlaget er to åpne bulk-nedlastinger fra Geonorge — ingen API-nøkkel
 * og ingen titusenvis av enkeltkall mot Kartverket.
 *
 *   npm run bygarder
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const KOMMUNE = "0301";
const CACHE_DIR = path.join(process.cwd(), ".cache", "geonorge");
const OUT_FILE = path.join(process.cwd(), "data", "bygarder.json");

/** Koordinatene rundes til desimeter før de sammenlignes. */
const SNAP = 10;
/** Brukes til å pakke (x, y) i ett tall, så vi slipper strengnøkler i Map-en. */
const Y_SPAN = 1 << 27;

const TEIG_URL =
  `https://nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenEiendomskartTeig/GML/` +
  `Basisdata_${KOMMUNE}_Oslo_25832_MatrikkelenEiendomskartTeig_GML.zip`;
const ADRESSE_URL =
  `https://nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenAdresse/CSV/` +
  `Basisdata_${KOMMUNE}_Oslo_25832_MatrikkelenAdresse_CSV.zip`;

type Bygard = {
  id: string;
  /** Antall teiger som utgjør kvartalet. */
  teiger: number;
  /** Samlet areal i m², summert fra teigene. */
  arealM2: number;
  gater: string[];
  adresser: string[];
};

/* ------------------------------------------------------------ Nedlasting */

async function ensureDownloaded(url: string, zipName: string): Promise<string> {
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const zipPath = path.join(CACHE_DIR, zipName);
  const outDir = path.join(CACHE_DIR, zipName.replace(/\.zip$/, ""));

  if (fs.existsSync(outDir)) return outDir;

  if (!fs.existsSync(zipPath)) {
    process.stdout.write(`Laster ned ${zipName} … `);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Nedlasting feilet: ${res.status} ${url}`);
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));
    const mb = (await fsp.stat(zipPath)).size / 1e6;
    console.log(`${mb.toFixed(1)} MB`);
  }

  // unzip finnes på macOS og Linux; datasettene er for store til å pakkes ut i minnet.
  await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", outDir]);
  return outDir;
}

async function findFile(dir: string, ext: string): Promise<string> {
  const entries = await fsp.readdir(dir, { withFileTypes: true, recursive: true });
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase().endsWith(ext)) {
      return path.join(e.parentPath ?? dir, e.name);
    }
  }
  throw new Error(`Fant ingen ${ext}-fil under ${dir}`);
}

/* ------------------------------------------------------------- Union-find */

class UnionFind {
  private parent: Int32Array;
  constructor(size: number) {
    this.parent = new Int32Array(size);
    for (let i = 0; i < size; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    // Stiskomprimering, så gjentatte oppslag blir flate.
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

/* ----------------------------------------------------------- GML-parsing */

/**
 * Strømmer gjennom GML-fila (1,3 GB for Oslo) og samler ett Teig-element om
 * gangen. Å laste hele dokumentet som DOM ville sprengt minnet.
 */
async function* teigElements(gmlPath: string): AsyncGenerator<string> {
  const rl = readline.createInterface({
    input: fs.createReadStream(gmlPath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  let buffer: string[] = [];
  let inside = false;
  for await (const line of rl) {
    if (!inside && line.includes("<app:Teig ")) {
      inside = true;
      buffer = [];
    }
    if (inside) {
      buffer.push(line);
      if (line.includes("</app:Teig>")) {
        inside = false;
        yield buffer.join("\n");
      }
    }
  }
}

const MATRIKKEL_RE = /<app:matrikkelnummerTekst>([^<]+)<\/app:matrikkelnummerTekst>/g;
const AREAL_RE = /<app:lagretBeregnetAreal>([^<]+)<\/app:lagretBeregnetAreal>/;
const POSLIST_RE = /<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/g;

/* --------------------------------------------------------------- Hovedløp */

async function main() {
  const teigDir = await ensureDownloaded(TEIG_URL, `teig_${KOMMUNE}.zip`);
  const adresseDir = await ensureDownloaded(ADRESSE_URL, `adresse_${KOMMUNE}.zip`);
  const gmlPath = await findFile(teigDir, ".gml");
  const csvPath = await findFile(adresseDir, ".csv");

  // --- Pass 1: adresser, gruppert på matrikkelnummer ---
  console.log("Leser adresser …");
  const adresserPerMatrikkel = new Map<string, string[]>();
  {
    const rl = readline.createInterface({
      input: fs.createReadStream(csvPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    let header: string[] | null = null;
    for await (const rawLine of rl) {
      const line = rawLine.replace(/^\ufeff/, "");
      if (!line.trim()) continue;
      const cols = line.split(";");
      if (!header) {
        header = cols;
        continue;
      }
      const col = (name: string) => cols[header!.indexOf(name)] ?? "";
      const gnr = col("gardsnummer");
      const bnr = col("bruksnummer");
      const fnr = col("festenummer");
      const tekst = col("adresseTekst").trim();
      if (!gnr || !bnr || !tekst) continue;

      // Festenummer inngår i nøkkelen bare når det finnes, slik matrikkelen skriver den.
      const key = fnr && fnr !== "0" ? `${gnr}/${bnr}/${fnr}` : `${gnr}/${bnr}`;
      const list = adresserPerMatrikkel.get(key);
      if (list) list.push(tekst);
      else adresserPerMatrikkel.set(key, [tekst]);
    }
  }
  const adresseCount = [...adresserPerMatrikkel.values()].reduce((n, l) => n + l.length, 0);
  console.log(
    `${adresseCount.toLocaleString("nb-NO")} adresser på ${adresserPerMatrikkel.size.toLocaleString("nb-NO")} matrikkelenheter`
  );

  // --- Pass 2: teiger med adresse, knyttet sammen på delte hjørnepunkter ---
  console.log("Leser teiger …");
  const adresserPerTeig: string[][] = [];
  const arealPerTeig: number[] = [];
  const vertexOwner = new Map<number, number>();
  const pending: Array<[number, number]> = [];

  let lest = 0;
  let index = 0;
  for await (const el of teigElements(gmlPath)) {
    lest++;
    if (lest % 10000 === 0) console.log(`  ${lest.toLocaleString("nb-NO")} teiger lest …`);

    const matrikler = [...el.matchAll(MATRIKKEL_RE)].map((m) => m[1].trim());
    const adresser = matrikler.flatMap((m) => adresserPerMatrikkel.get(m) ?? []);
    // Teiger uten adresse (veigrunn, friarealer) holdes utenfor — se toppen av fila.
    if (adresser.length === 0) continue;

    adresserPerTeig.push(adresser);
    arealPerTeig.push(Number(el.match(AREAL_RE)?.[1] ?? 0));

    for (const posMatch of el.matchAll(POSLIST_RE)) {
      const nums = posMatch[1].trim().split(/\s+/);
      // posList er "x1 y1 x2 y2 …" i EPSG:25832.
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = Math.round(Number(nums[i]) * SNAP);
        const y = Math.round(Number(nums[i + 1]) * SNAP);
        const key = x * Y_SPAN + y;
        const owner = vertexOwner.get(key);
        if (owner === undefined) vertexOwner.set(key, index);
        else if (owner !== index) pending.push([owner, index]);
      }
    }
    index++;
  }
  const teigCount = index;
  console.log(
    `${teigCount.toLocaleString("nb-NO")} teiger med adresse (av ${lest.toLocaleString("nb-NO")}), ` +
      `${vertexOwner.size.toLocaleString("nb-NO")} unike punkter`
  );

  vertexOwner.clear();

  const uf = new UnionFind(teigCount);
  for (const [a, b] of pending) uf.union(a, b);
  pending.length = 0;

  const adresserPerRot = new Map<number, Set<string>>();
  for (let i = 0; i < teigCount; i++) {
    const root = uf.find(i);
    let set = adresserPerRot.get(root);
    if (!set) {
      set = new Set();
      adresserPerRot.set(root, set);
    }
    for (const a of adresserPerTeig[i]) set.add(a);
  }

  // --- Areal per kvartal ---
  const arealPerRot = new Map<number, number>();
  const teigerPerRot = new Map<number, number>();
  for (let i = 0; i < teigCount; i++) {
    const root = uf.find(i);
    arealPerRot.set(root, (arealPerRot.get(root) ?? 0) + (arealPerTeig[i] || 0));
    teigerPerRot.set(root, (teigerPerRot.get(root) ?? 0) + 1);
  }

  // --- Skriv ut ---
  const bygarder: Bygard[] = [];
  const adresseTilBygard: Record<string, string> = {};

  const roots = [...adresserPerRot.keys()].sort(
    (a, b) => (arealPerRot.get(b) ?? 0) - (arealPerRot.get(a) ?? 0)
  );

  roots.forEach((root, i) => {
    const adresser = [...adresserPerRot.get(root)!].sort();
    const id = `oslo-${String(i + 1).padStart(5, "0")}`;
    // Matrikkeladresser ("33/1144-2") har ikke gatenavn og holdes utenfor lista.
    const gater = [
      ...new Set(
        adresser
          .map((a) => /^(\D.*?)\s+\d+\s*\w*$/.exec(a)?.[1])
          .filter((g): g is string => Boolean(g))
      ),
    ].sort();
    bygarder.push({
      id,
      teiger: teigerPerRot.get(root) ?? 0,
      arealM2: Math.round(arealPerRot.get(root) ?? 0),
      gater,
      adresser,
    });
    for (const a of adresser) adresseTilBygard[a] = id;
  });

  await fsp.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fsp.writeFile(
    OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), kommune: KOMMUNE, bygarder, adresseTilBygard })
  );

  const mb = (await fsp.stat(OUT_FILE)).size / 1e6;
  console.log(`\nSkrev ${bygarder.length.toLocaleString("nb-NO")} bygårder til data/bygarder.json (${mb.toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
