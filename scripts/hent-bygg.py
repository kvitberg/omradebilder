"""
Henter omrisset av byggene i kvartalene som har bilder, og skriver dem til
data/bygg.json.

Vi har ingen geometri selv: bygarder.json er adresser, gater og areal.
OpenStreetMap har byggene, men i Norge står adressene som egne punkter og
ikke som merkelapper på bygget. Derfor knyttes de sammen geometrisk:
et bygg hører til adressen hvis adressepunktet ligger inni det, ellers
hvis bygget er nærmeste innen 12 meter.

Bruk:  python3 scripts/hent-bygg.py
"""

import json
import math
import time
import urllib.parse
import urllib.request

SPEIL = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
NÆRMESTE_M = 12
PAUSE_S = 1.5


def overpass(query):
    data = urllib.parse.urlencode({"data": query}).encode()
    for url in SPEIL:
        try:
            req = urllib.request.Request(
                url, data=data, headers={"User-Agent": "omradebilder/1.0 (scott.kvitberg@gmail.com)"}
            )
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 — prøv neste speil
            print(f"    {url.split('/')[2]}: {e}")
    return None


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


def main():
    bygarder = json.load(open("data/bygarder.json", encoding="utf-8"))
    punkter = json.load(open("data/adressepunkter.json", encoding="utf-8"))
    blokk = {g["id"]: g for g in bygarder["bygarder"]}

    # Bare kvartalene den publiserte siden faktisk slår opp.
    kart = json.load(open("public/data/adresse-til-bygard.json", encoding="utf-8"))
    kvartaler = sorted(set(kart.values()))

    # Adresser som bilder er bundet til direkte, kan ligge utenfor disse.
    bilder = json.load(open("public/data/index.json", encoding="utf-8"))["photos"]
    løse = {a for p in bilder for a in (p.get("adresser") or []) if a in punkter}

    try:
        ut = json.load(open("data/bygg.json", encoding="utf-8"))
    except FileNotFoundError:
        ut = {}

    for nr, bid in enumerate(kvartaler, 1):
        if bid in ut:
            continue
        adresser = [a for a in blokk[bid]["adresser"] if a in punkter]
        if not adresser:
            continue
        lats = [punkter[a][0] for a in adresser]
        lons = [punkter[a][1] for a in adresser]
        bbox = f"{min(lats)-0.0005},{min(lons)-0.001},{max(lats)+0.0005},{max(lons)+0.001}"
        svar = overpass(f'[out:json][timeout:90];(way["building"]({bbox}););out geom;')
        if not svar:
            print(f"  {bid}: ingen svar, hoppes over")
            continue

        bygg = [e for e in svar["elements"] if e.get("geometry")]
        ringer = []
        brukt = set()
        for w in bygg:
            ring = [[round(p["lat"], 6), round(p["lon"], 6)] for p in w["geometry"]]
            for a in adresser:
                if inni(punkter[a][0], punkter[a][1], ring):
                    ringer.append(ring)
                    brukt.add(a)
                    break

        # Adresser uten treff: nærmeste bygg innen 12 m. Kartverket setter
        # punktet ved inngangen, som av og til havner rett utenfor veggen.
        for a in adresser:
            if a in brukt:
                continue
            beste = None
            for w in bygg:
                ring = [[round(p["lat"], 6), round(p["lon"], 6)] for p in w["geometry"]]
                d = min(avstand(punkter[a], p) for p in ring)
                if beste is None or d < beste[0]:
                    beste = (d, ring)
            if beste and beste[0] <= NÆRMESTE_M and beste[1] not in ringer:
                ringer.append(beste[1])
                brukt.add(a)

        ut[bid] = ringer
        print(f"  {nr}/{len(kvartaler)} {bid}: {len(ringer)} bygg, {len(brukt)}/{len(adresser)} adresser")
        with open("data/bygg.json", "w", encoding="utf-8") as f:
            json.dump(ut, f, ensure_ascii=False, separators=(",", ":"))
        time.sleep(PAUSE_S)

    print(f"\n{len(ut)} kvartaler i data/bygg.json ({sum(len(v) for v in ut.values())} bygg)")
    print(f"{len(løse)} adresser er bundet direkte til bilder")


if __name__ == "__main__":
    main()
