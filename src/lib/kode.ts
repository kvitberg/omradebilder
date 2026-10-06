/**
 * Innloggingen til portalen.
 *
 * Tre meglerkontorer deler ett passord, og admin har sitt eget. Passordene
 * sjekkes i nettleseren mot en sjekksum, så de står ikke i kildekoden — men
 * dette er en dør med lås, ikke en vegg: siden er statisk, og bilder og
 * data ligger på faste adresser for den som leter. Riktig passord huskes i
 * nettleseren sammen med hvem som logget inn, så det skrives bare én gang.
 *
 * Admin er ikke et kontor med flere rettigheter, men en egen bruker med
 * eget passord. Nedlastingsloggen ligger bak den samme sjekksummen hos
 * mellomtjeneren, så det hjelper ikke å skrive om id-en i nettleseren.
 */

export type Bruker = {
  id: string;
  brukernavn: string;
  navn: string;
  /** SHA-256 av brukerens passord. */
  sjekksum: string;
  /** Ser nedlastingsloggen. */
  admin?: boolean;
};

/** SHA-256 av passordet meglerkontorene deler. */
export const PASSORD_SJEKKSUM = "2d10da64f48f3f13143d2ca467d110ce2b9ee730d1835898ed7668ca9cadf463";

/**
 * SHA-256 av admin-passordet.
 *
 * Settes med `npm run admin-passord`, som spør om passordet, skriver
 * sjekksummen hit og legger den samme inn hos mellomtjeneren. Står den tom,
 * finnes ikke admin-brukeren, og loggen er utilgjengelig for alle.
 */
export const ADMIN_SJEKKSUM = "";

export const BRUKERE: Bruker[] = [
  { id: "renomme", brukernavn: "PMR", navn: "PrivatMegleren Renommé", sjekksum: PASSORD_SJEKKSUM },
  { id: "premium", brukernavn: "PMP", navn: "PrivatMegleren Premium", sjekksum: PASSORD_SJEKKSUM },
  { id: "em1", brukernavn: "EM1", navn: "Eiendomsmegler 1", sjekksum: PASSORD_SJEKKSUM },
  ...(ADMIN_SJEKKSUM
    ? [
        {
          id: "admin",
          brukernavn: "ADMIN",
          navn: "Fotostallen",
          sjekksum: ADMIN_SJEKKSUM,
          admin: true,
        },
      ]
    : []),
];

/** Brukernavnet slås opp uten hensyn til store bokstaver og mellomrom. */
export function finnBruker(brukernavn: string): Bruker | null {
  const søkt = brukernavn.trim().toLowerCase();
  return BRUKERE.find((b) => b.brukernavn.toLowerCase() === søkt) ?? null;
}

const NØKKEL = "omradebilder-bruker";

export async function sjekksum(tekst: string): Promise<string> {
  const data = new TextEncoder().encode(tekst);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Den innloggede brukeren, eller null. */
export function innlogget(): Bruker | null {
  try {
    const lagret = localStorage.getItem(NØKKEL);
    if (!lagret) return null;
    const { id, nøkkel } = JSON.parse(lagret) as { id?: string; nøkkel?: string };
    // Sjekksummen må stemme med nettopp denne brukerens passord, ikke med
    // et hvilket som helst av dem: ellers kunne et kontor skrive om id-en i
    // nettleseren og bli admin.
    const bruker = BRUKERE.find((b) => b.id === id);
    return bruker && nøkkel === bruker.sjekksum ? bruker : null;
  } catch {
    return null;
  }
}

export function erLåstOpp(): boolean {
  return innlogget() !== null;
}

// Porten på forsiden lytter her, så den forsvinner i det passordet godtas.
const lyttere = new Set<() => void>();

export function loggInn(bruker: Bruker) {
  try {
    localStorage.setItem(NØKKEL, JSON.stringify({ id: bruker.id, nøkkel: bruker.sjekksum }));
  } catch {
    // Uten lagring må passordet skrives igjen neste gang — det går fint.
  }
  for (const cb of lyttere) cb();
}

export function loggUt() {
  try {
    localStorage.removeItem(NØKKEL);
  } catch {
    // Ingenting å fjerne.
  }
  for (const cb of lyttere) cb();
}

/** For useSyncExternalStore: varsler ved innlogging, også fra en annen fane. */
export function abonner(cb: () => void) {
  lyttere.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    lyttere.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Navnet på den innloggede, til toppen av presentasjonen. */
export function innloggetNavn(): string | null {
  return innlogget()?.navn ?? null;
}

/** Brukernavnet, til smal skjerm der det fulle navnet ikke får plass. */
export function innloggetKort(): string | null {
  return innlogget()?.brukernavn ?? null;
}

/** Er den innloggede admin? Styrer om nedlastingsloggen vises. */
export function erAdmin(): boolean {
  return innlogget()?.admin === true;
}
