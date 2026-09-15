/**
 * Koden som åpner portalen og nedlastingene.
 *
 * Den sjekkes i nettleseren mot en sjekksum, så selve koden står ikke i
 * kildekoden. Men dette er en dørterskel, ikke en lås: siden er statisk,
 * og bilder og data ligger på faste adresser for den som leter. Riktig
 * kode huskes i nettleseren, så den skrives bare én gang.
 */

export const KODE_SJEKKSUM = "5db1fee4b5703808c48078a76768b155b421b210c0761cd6a5d223f4d99f1eaa";
const KODE_NØKKEL = "omradebilder-kode";

export async function sjekksum(tekst: string): Promise<string> {
  const data = new TextEncoder().encode(tekst);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function erLåstOpp(): boolean {
  try {
    return localStorage.getItem(KODE_NØKKEL) === KODE_SJEKKSUM;
  } catch {
    return false;
  }
}

// Porten på forsiden lytter her, så den forsvinner i det koden godtas.
const lyttere = new Set<() => void>();

export function låsOpp() {
  try {
    localStorage.setItem(KODE_NØKKEL, KODE_SJEKKSUM);
  } catch {
    // Uten lagring må koden skrives igjen neste gang — det går fint.
  }
  for (const cb of lyttere) cb();
}

/** For useSyncExternalStore: varsler ved opplåsing, også fra en annen fane. */
export function abonner(cb: () => void) {
  lyttere.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    lyttere.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
