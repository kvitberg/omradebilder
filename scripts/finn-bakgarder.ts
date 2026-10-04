/**
 * Leter gjennom hele Dropbox etter bakgårder og fellesarealer som ikke er
 * med i portalen ennå.
 *
 * Arkivet er mye større enn mappa portalen synker fra: år for år, kunde for
 * kunde, med bakgårdsbilder liggende spredt i oppdragsmapper.
 *
 * Gjennomgangen tar lang tid og ryker på et nettverksbrudd, så den lagrer
 * pekeren underveis og fortsetter der den slapp. Opptaksmåneden samles med
 * det samme: bare sen vår, sommer og tidlig høst er brukbart — et gårdsrom
 * i november selger ingen leilighet.
 *
 *   npm run finn-bakgarder            — fortsetter, eller bruker ferdig tre
 *   npm run finn-bakgarder -- --nytt  — begynner forfra
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs/promises";
import path from "node:path";
import { getDropboxClient } from "../src/lib/dropbox";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const STATE = path.join(CACHE_DIR, "dropbox-tre-state.json");
const TRE = path.join(CACHE_DIR, "dropbox-tre.json");
const NYTT = process.argv.includes("--nytt");

/** Månedene det er grønt og lyst nok til at et gårdsrom ser ut som noe. */
export const SESONG = new Set([5, 6, 7, 8, 9]);

export type Mappe = {
  sti: string;
  bilder: number;
  /** Antall bilder per opptaksmåned, 1–12. */
  mnd: Record<number, number>;
};

type State = {
  cursor: string | null;
  ferdig: boolean;
  antall: number;
  mapper: string[];
  bilder: Record<string, { n: number; mnd: Record<number, number> }>;
};

const BILDE = /\.(jpe?g|png|tiff?|heic|webp|dng|cr2|cr3|arw|nef)$/i;

async function lesState(): Promise<State> {
  if (!NYTT) {
    try {
      return JSON.parse(await fs.readFile(STATE, "utf-8")) as State;
    } catch {
      /* ingen påbegynt gjennomgang */
    }
  }
  return { cursor: null, ferdig: false, antall: 0, mapper: [], bilder: {} };
}

/** Dropbox ryker av og til midt i en lang gjennomgang; da venter vi litt. */
async function medForsøk<T>(gjør: () => Promise<T>, hva: string): Promise<T> {
  let sist: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      return await gjør();
    } catch (err) {
      sist = err;
      const vent = 2000 * 2 ** i;
      console.log(`  ${hva} feilet (${String(err).slice(0, 60)}), venter ${vent / 1000}s`);
      await new Promise((r) => setTimeout(r, vent));
    }
  }
  throw sist;
}

async function gåGjennom(): Promise<Mappe[]> {
  const state = await lesState();

  if (!state.ferdig) {
    const dbx = await getDropboxClient();
    const mapper = new Set(state.mapper);
    let siden = 0;

    const lagre = async () => {
      state.mapper = [...mapper];
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(STATE, JSON.stringify(state));
    };

    for (;;) {
      const svar = await medForsøk(
        () =>
          state.cursor
            ? dbx.filesListFolderContinue({ cursor: state.cursor })
            : dbx.filesListFolder({ path: "", recursive: true, limit: 2000 }),
        "listing"
      );

      for (const e of svar.result.entries) {
        state.antall++;
        if (e[".tag"] === "folder") {
          if (e.path_display) mapper.add(e.path_display);
        } else if (e[".tag"] === "file" && BILDE.test(e.name)) {
          const mappe = (e.path_display ?? "").replace(/\/[^/]+$/, "");
          const b = (state.bilder[mappe] ??= { n: 0, mnd: {} });
          b.n++;
          // client_modified er fila slik kameraet la den fra seg, og er det
          // nærmeste vi kommer opptaksdato uten å åpne hvert bilde.
          const m = new Date(e.client_modified).getUTCMonth() + 1;
          if (m >= 1 && m <= 12) b.mnd[m] = (b.mnd[m] ?? 0) + 1;
        }
      }

      state.cursor = svar.result.cursor;
      // Lagres ofte: en avbrutt gjennomgang skal koste minutter, ikke timer.
      if (++siden % 2 === 0) {
        await lagre();
        console.log(`  ${state.antall} oppføringer, ${mapper.size} mapper`);
      }
      if (!svar.result.has_more) break;
    }

    state.ferdig = true;
    await lagre();
    console.log(`  ferdig: ${state.antall} oppføringer, ${mapper.size} mapper`);
  }

  const tre: Mappe[] = state.mapper
    .filter(Boolean)
    .map((sti) => ({
      sti,
      bilder: state.bilder[sti]?.n ?? 0,
      mnd: state.bilder[sti]?.mnd ?? {},
    }))
    .sort((a, b) => a.sti.localeCompare(b.sti, "no"));

  await fs.writeFile(TRE, JSON.stringify(tre));
  return tre;
}

async function main() {
  const tre = await gåGjennom();
  const medBilder = tre.filter((m) => m.bilder > 0);
  const iSesong = medBilder.filter((m) =>
    Object.entries(m.mnd).some(([mn, n]) => SESONG.has(Number(mn)) && n > 0)
  );
  console.log(
    `${tre.length} mapper, ${medBilder.length} med bilder, ${iSesong.length} med bilder i sesong.`
  );
  console.log(`Treet ligger i ${path.relative(process.cwd(), TRE)}`);
}

// Gjennomgangen skal bare starte når skriptet kjøres, ikke når noen
// importerer SESONG herfra. Uten denne sjekken satte analysen i gang en
// ny tur gjennom hele Dropbox ved import.
if (process.argv[1]?.endsWith("finn-bakgarder.ts")) {
  main().catch((e) => {
    console.error(String(e).slice(0, 600));
    process.exit(1);
  });
}
