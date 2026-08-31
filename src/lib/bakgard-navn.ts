import fs from "node:fs/promises";
import path from "node:path";

/**
 * Kallenavn på bygårder, f.eks. "Italiagården". Et slikt navn sier ingenting
 * i seg selv om at mappa er en bakgård — "Kaffebrenneriet" ser likedan ut —
 * så navnene må stå i denne lista for å bli regnet som en bakgård.
 *
 * Formatet er `{ "Italiagården": "Torshovgata 10" }`: kallenavn til en adresse
 * i samme kvartal. Adressen brukes til oppslaget, så resultatet ikke avhenger
 * av at OpenStreetMap tilfeldigvis kjenner kallenavnet.
 */
export type BakgardNavn = Record<string, string>;

const FILE = path.join(process.cwd(), "data", "bakgard-navn.json");

let cache: BakgardNavn | null = null;

export async function loadBakgardNavn(): Promise<BakgardNavn> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, "utf-8")) as BakgardNavn;
  } catch {
    cache = {};
  }
  return cache;
}

/** Slår opp uavhengig av store/små bokstaver. */
export function lookupKallenavn(navn: string, tabell: BakgardNavn): string | null {
  const key = navn.trim().toLowerCase();
  for (const [k, v] of Object.entries(tabell)) {
    if (k.trim().toLowerCase() === key) return v;
  }
  return null;
}
