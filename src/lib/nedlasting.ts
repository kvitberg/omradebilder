import { ADMIN_SJEKKSUM, PASSORD_SJEKKSUM } from "./kode";

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

export function loggNedlasting(rad: Omit<Nedlasting, "tid">): void {
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
