import fs from "node:fs";
import path from "node:path";

/**
 * Stedet et punkt ligger *inni*, om noe — slått opp lokalt, uten nett.
 *
 * Punktoppslaget i poi.ts finner nærmeste skilt, og det er feil svar når
 * man står inne i noe stort: et bilde fra Stensparken fikk nærmeste adresse
 * som navn, og et fra Storo storsenter ble til «Joe & The Juice». En
 * navngitt flate slår begge deler.
 *
 * Tre kilder, i stigende tillit:
 *   data/parker.json      — parker og friområder (npm run hent-parker)
 *   data/stedsflater.json — kjøpesentre, torg og markeder (npm run hent-steder)
 *   data/egne-steder.json — dine egne, som punkt og radius
 *
 * Bydeler og nabolag er bevisst holdt utenfor: en flate over hele Torshov
 * ville døpt om hver kafé og hver bakgård der til «Torshov».
 */

type Flate = { navn: string; slag: string; kategori: string; ringer: number[][][] };
type Punkt = { navn: string; kategori: string; lat: number; lng: number; radius: number };

const IKKE_PARK = /borettslag|sameie|\bbrl\b|boligselskap/i;

let flater: Flate[] | null = null;
let egne: Punkt[] | null = null;

function les<T>(fil: string, standard: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", fil), "utf-8")) as T;
  } catch {
    return standard;
  }
}

function lastFlater(): Flate[] {
  if (flater) return flater;
  const parker = les<Flate[]>("parker.json", []).filter((p) => !IKKE_PARK.test(p.navn));
  const steder = les<Flate[]>("stedsflater.json", []);
  flater = [...parker, ...steder];
  return flater;
}

function lastEgne(): Punkt[] {
  if (egne) return egne;
  const rå = les<Record<string, Omit<Punkt, "navn"> | string>>("egne-steder.json", {});
  egne = Object.entries(rå)
    .filter(([navn, v]) => navn !== "_" && typeof v === "object")
    .map(([navn, v]) => ({ navn, ...(v as Omit<Punkt, "navn">) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  return egne;
}

/** Stråletesten: et punkt er inni en ring når en stråle ut krysser kanten et odde antall ganger. */
function inni(lat: number, lng: number, ring: number[][]): boolean {
  let inne = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ai, bi] = ring[i];
    const [aj, bj] = ring[j];
    if (bi > lng !== bj > lng && lat < ((aj - ai) * (lng - bi)) / (bj - bi) + ai) inne = !inne;
  }
  return inne;
}

/** Grovt areal, til å skille den minste flaten fra den som omslutter den. */
function utstrekning(f: Flate): number {
  let minLat = 90, maksLat = -90, minLng = 180, maksLng = -180;
  for (const r of f.ringer) {
    for (const [la, ln] of r) {
      if (la < minLat) minLat = la;
      if (la > maksLat) maksLat = la;
      if (ln < minLng) minLng = ln;
      if (ln > maksLng) maksLng = ln;
    }
  }
  return (maksLat - minLat) * (maksLng - minLng);
}

export function stedVedPunkt(lat: number, lng: number): { name: string; categoryId: string } | null {
  // Dine egne går foran alt: er et sted lagt inn for hånd, er det fordi
  // kartet tok feil eller ikke hadde det.
  for (const p of lastEgne()) {
    const dy = (p.lat - lat) * 111320;
    const dx = (p.lng - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
    if (Math.hypot(dx, dy) <= (p.radius || 60)) return { name: p.navn, categoryId: p.kategori };
  }

  const treff = lastFlater().filter((f) => f.ringer.some((r) => inni(lat, lng, r)));
  if (!treff.length) return null;
  // Den minste flaten vinner: kjøpesenteret framfor torget rundt det,
  // parken framfor friområdet, lekeplassen sist.
  treff.sort((a, b) => utstrekning(a) - utstrekning(b));
  return { name: treff[0].navn, categoryId: treff[0].kategori };
}
