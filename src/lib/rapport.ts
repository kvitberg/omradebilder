import { PASSORD_SJEKKSUM } from "./kode";

/**
 * Feilmeldinger fra portalen, under beta.
 *
 * Siden er statisk og har ingen baksted å sende til. Mellomtjeneren som
 * allerede henter originalfilene tar imot dem også, og koden til siden er
 * samme dørterskel her som der. Meldingene leses med `npm run rapporter`.
 *
 * Hele denne veien skal ut før lansering.
 */
const RAPPORT_URL = "https://omradebilder-originaler.scott-kvitberg.workers.dev/rapport";

export type RapportKontekst = {
  /** Adressen som ble søkt opp. */
  adresse: string;
  /** Stedet bildet er bundet til, når meldingen gjelder ett bilde. */
  sted?: string;
  kategori?: string;
  bildeId?: string;
  filnavn?: string | null;
};

export async function sendRapport(
  kontekst: RapportKontekst,
  tekst: string,
  kontor: string | null
): Promise<void> {
  const res = await fetch(`${RAPPORT_URL}?t=${PASSORD_SJEKKSUM}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...kontekst, tekst, kontor }),
  });
  if (!res.ok) throw new Error(`Tjeneren svarte ${res.status}`);
}
