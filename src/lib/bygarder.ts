import fs from "node:fs/promises";
import path from "node:path";

/**
 * Oppslag mot `data/bygarder.json` — kvartalsgrupperingen bygget av
 * `npm run bygarder`. Fila er på ~6 MB, så den leses én gang og holdes
 * i minnet mellom forespørsler.
 */
export type Bygard = {
  id: string;
  teiger: number;
  arealM2: number;
  gater: string[];
  adresser: string[];
};

type BygardData = {
  generatedAt: string;
  kommune: string;
  bygarder: Bygard[];
  adresseTilBygard: Record<string, string>;
};

let cache: BygardData | null = null;
let pending: Promise<BygardData | null> | null = null;

async function load(): Promise<BygardData | null> {
  if (cache) return cache;
  // Flere samtidige forespørsler skal ikke lese fila hver sin gang.
  pending ??= (async () => {
    try {
      const file = path.join(process.cwd(), "data", "bygarder.json");
      cache = JSON.parse(await fs.readFile(file, "utf-8")) as BygardData;
      return cache;
    } catch {
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/**
 * Adressene i datasettet er skrevet uten postnummer ("Toftes gate 10A"),
 * mens et valgt adresseforslag har med både postnummer og poststed.
 */
export function normalizeAddress(address: string): string {
  return address.split(",")[0].trim().replace(/\s+/g, " ");
}

/** Bygård-IDen en adresse hører til, eller null om adressen er ukjent. */
export async function bygardIdForAddress(address: string): Promise<string | null> {
  const data = await load();
  if (!data) return null;
  return data.adresseTilBygard[normalizeAddress(address)] ?? null;
}

export async function bygardById(id: string): Promise<Bygard | null> {
  const data = await load();
  if (!data) return null;
  return data.bygarder.find((b) => b.id === id) ?? null;
}

/** Hele bygården en adresse hører til — brukt av oppslaget i portalen. */
export async function bygardForAddress(address: string): Promise<Bygard | null> {
  const id = await bygardIdForAddress(address);
  return id ? bygardById(id) : null;
}
