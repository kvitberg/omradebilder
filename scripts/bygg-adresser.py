"""
Knytter hvert bygg til adressene det dekker, og skriver public/data/bygg.json.

hent-bygg.py henter omrissene; her kobles de mot adressepunktene, slik at
kartet kan vise adressen når man holder musa over et bygg. Ingen nettbruk.

Bruk:  python3 scripts/bygg-adresser.py
"""

import json
import math

NÆRMESTE_M = 12


def avstand(a, b):
    return math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 55660)


def inni(lat, lon, ring):
    inne = False
    n = len(ring)
    for i in range(n):
        j = (i - 1) % n
        ai, bi = ring[i]
        aj, bj = ring[j]
        if (bi > lon) != (bj > lon) and lat < (aj - ai) * (lon - bi) / (bj - bi) + ai:
            inne = not inne
    return inne


def omriss(punkter):
    """Konveks innhylling (monoton kjede) — kvartalets ytre form."""
    pts = sorted(set((round(y, 6), round(x, 6)) for y, x in punkter))
    if len(pts) < 3:
        return [list(p) for p in pts]

    def kryss(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    under, over = [], []
    for p in pts:
        while len(under) >= 2 and kryss(under[-2], under[-1], p) <= 0:
            under.pop()
        under.append(p)
    for p in reversed(pts):
        while len(over) >= 2 and kryss(over[-2], over[-1], p) <= 0:
            over.pop()
        over.append(p)
    return [list(p) for p in under[:-1] + over[:-1]]


def main():
    bygg = json.load(open("data/bygg.json", encoding="utf-8"))
    punkter = json.load(open("data/adressepunkter.json", encoding="utf-8"))
    bygarder = json.load(open("data/bygarder.json", encoding="utf-8"))
    blokk = {g["id"]: g["adresser"] for g in bygarder["bygarder"]}

    ut = {}
    for bid, ringer in bygg.items():
        adresser = [a for a in blokk.get(bid, []) if a in punkter]
        oppføringer = []
        for ring in ringer:
            treff = [a for a in adresser if inni(punkter[a][0], punkter[a][1], ring)]
            if not treff:
                # Punktet kan ligge rett utenfor veggen; ta de nærmeste.
                treff = [
                    a
                    for a in adresser
                    if min(avstand(punkter[a], p) for p in ring) <= NÆRMESTE_M
                ]
            oppføringer.append({"r": ring, "a": sorted(treff)})
        alle_punkter = [p for b in oppføringer for p in b["r"]]
        ut[bid] = {"omriss": omriss(alle_punkter), "bygg": oppføringer}

    with open("public/data/bygg.json", "w", encoding="utf-8") as f:
        json.dump(ut, f, ensure_ascii=False, separators=(",", ":"))

    navnløse = sum(1 for v in ut.values() for b in v["bygg"] if not b["a"])
    antall = sum(len(v["bygg"]) for v in ut.values())
    print(f"{len(ut)} kvartaler, {antall} bygg ({navnløse} uten adresse)")


if __name__ == "__main__":
    main()
