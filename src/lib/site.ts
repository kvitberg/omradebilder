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

/**
 * Settes ved bygging og henges på datafilene. GitHub Pages' CDN bufrer
 * /data/*.json, så uten dette kan en fersk deploy fortsatt servere gamle
 * data i timevis.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "dev";

/** Datafil med bufferbryter. */
export function dataUrl(pathname: string): string {
  return `${withBasePath(pathname)}?v=${BUILD_ID}`;
}
