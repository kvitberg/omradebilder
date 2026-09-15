import fs from "node:fs";
import path from "node:path";

/**
 * Parken et punkt ligger *inni*, om noen — slått opp lokalt i
 * data/parker.json, som `npm run hent-parker` lager fra OpenStreetMap.
 *
 * Nærmeste-sted-oppslaget finner ikke en park man står midt i, for dens
 * punkt er langt unna; et bilde fra Stensparken fikk nærmeste adresse som
 * navn og ble bundet til den. Bare navngitte flater teller, og et
 * borettslags egen plen er ikke en park selv om noen har tegnet den slik.
 */

type Park = { navn: string; slag: string; kategori: string; ringer: number[][][] };

const IKKE_PARK = /borettslag|sameie|\bbrl\b|boligselskap/i;

let parker: Park[] | null = null;

function last(): Park[] {
  if (parker) return parker;
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "data", "parker.json"), "utf-8");
    parker = (JSON.parse(raw) as Park[]).filter((p) => !IKKE_PARK.test(p.navn));
  } catch {
    parker = [];
  }
  return parker;
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

export function parkVedPunkt(lat: number, lng: number): { name: string; categoryId: string } | null {
  const treff = last().filter((p) => p.ringer.some((r) => inni(lat, lng, r)));
  if (!treff.length) return null;
  // Parken framfor lekeplassen inni den.
  treff.sort((a, b) => (a.slag === "park" ? 0 : 1) - (b.slag === "park" ? 0 : 1));
  return { name: treff[0].navn, categoryId: treff[0].kategori };
}
