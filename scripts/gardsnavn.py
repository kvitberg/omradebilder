"""
Kobler navngitte bygårder til adressene de består av.

Torshov-kvartalene er kjent under kallenavn — Søylegården, Funkisgården,
Tysklandsgården — og det er de navnene som står på mappene. OpenStreetMap har
et punkt midt i hvert gårdsrom (place=locality). Herfra finner vi kvartalet
punktet ligger i og skriver alle adressene i det til data/bakgard-navn.json.

Oppføringer som allerede står i fila og ikke finnes i OSM, beholdes urørt.

Bruk:  python3 scripts/gardsnavn.py <overpass-eksport.json>
"""

import json
import math
import sys
from collections import Counter

# Kvartaler som er limt sammen til noe større enn ett gårdsrom, stoler vi
# ikke på som helhet. Da tar vi bare adressene nær punktet.
MAKS_ADRESSER = 40
MAKS_UTSTREKNING_M = 250
NÆR_M = 60
# Punktet må ligge i et gårdsrom. Langt fra nærmeste adresse er det noe annet.
MAKS_TIL_NÆRMESTE_M = 40


def avstand(a, b):
    dlat = math.radians(b[0] - a[0])
    dlng = math.radians(b[1] - a[1])
    h = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlng / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(h))


def main(osm_sti):
    osm = json.load(open(osm_sti, encoding="utf-8"))
    bygarder = json.load(open("data/bygarder.json", encoding="utf-8"))
    adresse_til_bygard = bygarder["adresseTilBygard"]
    adresser_i = {g["id"]: g["adresser"] for g in bygarder["bygarder"]}
    punkter = json.load(open("data/adressepunkter.json", encoding="utf-8"))

    sti = "data/bakgard-navn.json"
    try:
        navneliste = json.load(open(sti, encoding="utf-8"))
    except FileNotFoundError:
        navneliste = {}

    gårder = [
        e for e in osm["elements"]
        if e.get("tags", {}).get("place") == "locality"
        and e["tags"].get("name", "").lower().endswith("gården")
    ]

    for e in sorted(gårder, key=lambda e: e["tags"]["name"]):
        navn = e["tags"]["name"]
        senter = (e["lat"], e["lon"])

        nær = sorted(
            (avstand(senter, p), a) for a, p in punkter.items()
            if abs(p[0] - senter[0]) < 0.002 and abs(p[1] - senter[1]) < 0.004
        )
        if not nær or nær[0][0] > MAKS_TIL_NÆRMESTE_M:
            print(f"  – {navn}: ingen adresse nær nok, hoppes over")
            continue

        # Kvartalet flest av de åtte nærmeste adressene hører til. Det
        # nærmeste alene kan være en løs enkeltteig inne i kvartalet, slik
        # Mastrups gate 13 er det midt i Frankrikegården.
        stemmer = Counter(adresse_til_bygard.get(a) for _, a in nær[:8] if adresse_til_bygard.get(a))
        topp = stemmer.most_common()
        valgte = [b for b, n in topp if n == topp[0][1]]  # likt delt: begge

        adresser = set()
        for b in valgte:
            i_kvartal = [a for a in adresser_i[b] if a in punkter]
            spenn = max((avstand(punkter[x], punkter[y]) for x in i_kvartal for y in i_kvartal), default=0)
            if len(i_kvartal) <= MAKS_ADRESSER and spenn <= MAKS_UTSTREKNING_M:
                adresser.update(i_kvartal)
            else:
                adresser.update(a for d, a in nær if d <= NÆR_M and adresse_til_bygard.get(a) == b)
        # Enkeltteiger midt i gårdsrommet hører med.
        adresser.update(a for d, a in nær if d <= 20)

        gamle = navneliste.get(navn)
        if gamle:
            adresser.update([gamle] if isinstance(gamle, str) else gamle)

        navneliste[navn] = sorted(adresser)
        print(f"  ✓ {navn:16} {len(adresser):3} adresser  ({', '.join(valgte)})")

    with open(sti, "w", encoding="utf-8") as f:
        json.dump(navneliste, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
