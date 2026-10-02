/**
 * Innloggingen til portalen.
 *
 * Tre meglerkontorer med hvert sitt brukernavn og felles passord. Det sjekkes i nettleseren mot en sjekksum,
 * så selve passordet står ikke i kildekoden — men dette er en dør med lås,
 * ikke en vegg: siden er statisk, og bilder og data ligger på faste
 * adresser for den som leter. Riktig passord huskes i nettleseren, sammen
 * med hvem som logget inn, så det skrives bare én gang.
 */

export type Bruker = { id: string; brukernavn: string; navn: string };

export const BRUKERE: Bruker[] = [
  { id: "renomme", brukernavn: "PMR", navn: "PrivatMegleren Renommé" },
  { id: "premium", brukernavn: "PMP", navn: "PrivatMegleren Premium" },
  { id: "em1", brukernavn: "EM1", navn: "Eiendomsmegler 1" },
];

/** Brukernavnet slås opp uten hensyn til store bokstaver og mellomrom. */
export function finnBruker(brukernavn: string): Bruker | null {
  const søkt = brukernavn.trim().toLowerCase();
  return BRUKERE.find((b) => b.brukernavn.toLowerCase() === søkt) ?? null;
}

/** SHA-256 av passordet. Passordet selv ligger ikke i repoet. */
export const PASSORD_SJEKKSUM = "2d10da64f48f3f13143d2ca467d110ce2b9ee730d1835898ed7668ca9cadf463";

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
    if (nøkkel !== PASSORD_SJEKKSUM) return null;
    return BRUKERE.find((b) => b.id === id) ?? null;
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
    localStorage.setItem(NØKKEL, JSON.stringify({ id: bruker.id, nøkkel: PASSORD_SJEKKSUM }));
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
