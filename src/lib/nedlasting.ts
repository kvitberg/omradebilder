import { ADMIN_SJEKKSUM, PASSORD_SJEKKSUM, erAdmin } from "./kode";

/**
 * Nedlastingsloggen.
 *
 * Originalfilene hentes rett fra Dropbox eller Immich, ikke gjennom vår
 * egen tjener, så det er nettleseren som melder fra idet nedlastingen
 * starter. Det fanger den som trykker på knappen — ikke den som
 * høyreklikker og lagrer — men meglerne trykker.
 *
 * Meldingen sendes uten å vente: en treg logg skal aldri forsinke
 * nedlastingen, og en logg som feiler skal ikke stoppe den.
 */
const TJENER = "https://omradebilder-originaler.scott-kvitberg.workers.dev";

export type Nedlasting = {
  tid: string;
  kontor: string | null;
  bruker: string | null;
  bildeId: string | null;
  filnavn: string | null;
  sted: string | null;
  kategori: string | null;
  adresse: string | null;
};

/** Brukernavnet admin logger inn med. Loggen skal ikke telle egne runder. */
export const ADMIN_BRUKER = "ADMIN";

export function loggNedlasting(rad: Omit<Nedlasting, "tid">): void {
  // Fotostallens egne gjennomganger er ikke bruk. De ville ligget i samme
  // pott som meglernes, og potten skal etter hvert deles ut i penger.
  if (erAdmin()) return;
  try {
    void fetch(`${TJENER}/nedlasting?t=${PASSORD_SJEKKSUM}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rad),
      keepalive: true,
    }).catch(() => {
      /* loggen er ikke verdt en feilmelding til megleren */
    });
  } catch {
    /* samme */
  }
}

/** Hele loggen. Krever admin-passordets sjekksum, ikke meglernes. */
export async function hentNedlastinger(): Promise<Nedlasting[]> {
  const res = await fetch(`${TJENER}/nedlastinger?t=${ADMIN_SJEKKSUM}`);
  if (!res.ok) throw new Error(`Tjeneren svarte ${res.status}`);
  const data = (await res.json()) as { rader?: Nedlasting[] };
  return (data.rader ?? []).sort((a, b) => b.tid.localeCompare(a.tid));
}
