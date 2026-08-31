/**
 * GitHub Pages serverer prosjektsider fra en underbane (/<repo>/), så alle
 * absolutte stier vi lager selv må ha dette foran. Next.js sin `basePath`
 * dekker lenker og bundlede ressurser, men ikke `src`-er vi setter fra data
 * — som miniatyrstiene i indeksen.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Gjør en absolutt sti fra prosjektroten klar til bruk i nettleseren. */
export function withBasePath(pathname: string): string {
  if (!pathname.startsWith("/")) return pathname;
  return `${BASE_PATH}${pathname}`;
}
