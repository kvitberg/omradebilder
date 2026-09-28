import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createWriteStream } from "node:fs";

const execFileAsync = promisify(execFile);

/**
 * Henter eiendomsgrensene (teigene) for kvartalene som har bilder.
 *
 * Kvartalene i data/bygarder.json er bygget av de samme teigene, men
 * build-bygarder.ts kaster koordinatene etter grupperingen og beholder bare
 * adresser, areal og antall. Dette skriptet leser grensene ut — uten å røre
 * bygarder.json, for bilde-koblingene peker på id-ene der, og en ny
 * generering ville nummerert kvartalene om.
 *
 * GML-fila er 1,3 GB og lastes ned til .cache/geonorge/ (utenfor git).
 *
 * Bruk:  npm run teiger
 */

const KOMMUNE = "0301";
const CACHE_DIR = path.join(process.cwd(), ".cache", "geonorge");
const TEIG_URL =
  `https://nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenEiendomskartTeig/GML/` +
  `Basisdata_${KOMMUNE}_Oslo_25832_MatrikkelenEiendomskartTeig_GML.zip`;
const ADRESSE_URL =
  `https://nedlasting.geonorge.no/geonorge/Basisdata/MatrikkelenAdresse/CSV/` +
  `Basisdata_${KOMMUNE}_Oslo_25832_MatrikkelenAdresse_CSV.zip`;

const MATRIKKEL_RE = /<app:matrikkelnummerTekst>([^<]+)<\/app:matrikkelnummerTekst>/g;
const POSLIST_RE = /<gml:posList[^>]*>([\s\S]*?)<\/gml:posList>/g;

/* ------------------------------------------------ UTM 32N → lengde/bredde */

/**
 * Invers transversal Mercator på WGS84. Teigene ligger i EPSG:25832, mens
 * kartet i nettleseren regner i lengde- og breddegrad.
 */
function utm32TilWgs84(east: number, north: number): [number, number] {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = east - 500000;
  const M = north / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));

  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const ep2 = e2 / (1 - e2);
  const C1 = ep2 * cos1 ** 2;
  const T1 = tan1 ** 2;
  const N1 = a / Math.sqrt(1 - e2 * sin1 ** 2);
  const R1 = (a * (1 - e2)) / (1 - e2 * sin1 ** 2) ** 1.5;
  const D = x / (N1 * k0);

  const lat =
    phi1 -
    ((N1 * tan1) / R1) *
      (D ** 2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6) / 720);
  const lon =
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2) * D ** 5) / 120) /
    cos1;

  const grader = (r: number) => (r * 180) / Math.PI;
  // Sone 32 har midtmeridian 9° øst.
  return [Number(grader(lat).toFixed(6)), Number((9 + grader(lon)).toFixed(6))];
}

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
    console.log(`${((await fsp.stat(zipPath)).size / 1e6).toFixed(1)} MB`);
  }
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

/* --------------------------------------------------------------- Hovedløp */

async function main() {
  const bygarder = JSON.parse(await fsp.readFile("data/bygarder.json", "utf-8")) as {
    bygarder: Array<{ id: string; adresser: string[] }>;
    adresseTilBygard: Record<string, string>;
  };
  const kart = JSON.parse(
    await fsp.readFile("public/data/adresse-til-bygard.json", "utf-8")
  ) as Record<string, string>;
  const ønskede = new Set(Object.values(kart));
  const bygardFor = bygarder.adresseTilBygard;
  console.log(`${ønskede.size} kvartaler har bilder.`);

  const teigDir = await ensureDownloaded(TEIG_URL, `teig_${KOMMUNE}.zip`);
  const adresseDir = await ensureDownloaded(ADRESSE_URL, `adresse_${KOMMUNE}.zip`);
  const gmlPath = await findFile(teigDir, ".gml");
  const csvPath = await findFile(adresseDir, ".csv");

  // Matrikkelnummer → kvartal, for de kvartalene vi vil ha grensene til.
  console.log("Leser adresser …");
  const kvartalPerMatrikkel = new Map<string, string>();
  {
    const rl = readline.createInterface({
      input: fs.createReadStream(csvPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });
    let header: string[] | null = null;
    for await (const rawLine of rl) {
      const line = rawLine.replace(/^﻿/, "");
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
      const kvartal = bygardFor[tekst];
      if (!kvartal || !ønskede.has(kvartal)) continue;
      const key = fnr && fnr !== "0" ? `${gnr}/${bnr}/${fnr}` : `${gnr}/${bnr}`;
      kvartalPerMatrikkel.set(key, kvartal);
    }
  }
  console.log(`${kvartalPerMatrikkel.size} matrikkelenheter hører til disse kvartalene.`);

  console.log("Leser teiger …");
  const ut: Record<string, [number, number][][]> = {};
  let lest = 0;
  let brukt = 0;
  for await (const el of teigElements(gmlPath)) {
    if (++lest % 20000 === 0) console.log(`  ${lest.toLocaleString("nb-NO")} teiger lest …`);
    const matrikler = [...el.matchAll(MATRIKKEL_RE)].map((m) => m[1].trim());
    const kvartal = matrikler.map((m) => kvartalPerMatrikkel.get(m)).find(Boolean);
    if (!kvartal) continue;

    for (const posMatch of el.matchAll(POSLIST_RE)) {
      const nums = posMatch[1].trim().split(/\s+/).map(Number);
      const ring: [number, number][] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        ring.push(utm32TilWgs84(nums[i], nums[i + 1]));
      }
      if (ring.length >= 4) (ut[kvartal] ??= []).push(ring);
    }
    brukt++;
  }

  await fsp.writeFile("data/teiger.json", JSON.stringify(ut));
  const ringer = Object.values(ut).reduce((n, r) => n + r.length, 0);
  console.log(
    `\n${brukt} teiger i ${Object.keys(ut).length} kvartaler → ${ringer} grenser i data/teiger.json`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
