"""
Henter navngitte kjøpesentre, torg og markeder i Oslo fra OpenStreetMap og
skriver dem som polygoner til data/stedsflater.json.

Samme mekanikk som parkene: et bilde tatt inne på Storo Storsenter fikk
nærmeste virksomhet som navn — «Joe & The Juice», «Silverland smykker» —
fordi punktoppslaget tar det nærmeste skiltet, ikke stedet man står på.
En navngitt flate slår det.

Bare flater man står *inne i* tas med. Bydeler og nabolag er bevisst holdt
utenfor: en flate som dekker hele Torshov ville døpt om hver kafé og hver
bakgård der til «Torshov».

Bruk:  python3 scripts/hent-steder.py            (henter fra Overpass)
       python3 scripts/hent-steder.py fil.json   (bruker en ferdig nedlastet fil)
"""

import json
import sys
import urllib.parse
import urllib.request

BBOX = "59.78,10.50,60.02,10.98"
SPØRRING = (
    f"[out:json][timeout:180];("
    f'way["shop"~"^(mall|department_store)$"]["name"]({BBOX});'
    f'relation["shop"~"^(mall|department_store)$"]["name"]({BBOX});'
    f'way["place"="square"]["name"]({BBOX});'
    f'relation["place"="square"]["name"]({BBOX});'
    f'way["amenity"="marketplace"]["name"]({BBOX});'
    f");out geom;"
)
SPEIL = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Hvilken kategori flaten gir bildet.
KATEGORI = {"mall": "butikk", "department_store": "butikk", "square": "nabolag", "marketplace": "butikk"}


def hent():
    data = urllib.parse.urlencode({"data": SPØRRING}).encode()
    for url in SPEIL:
        try:
            req = urllib.request.Request(
                url, data=data, headers={"User-Agent": "omradebilder/1.0 (scott.kvitberg@gmail.com)"}
            )
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 — prøv neste speil
            print(f"  {url}: {e}", file=sys.stderr)
    raise SystemExit("Ingen Overpass-speil svarte.")


def ring(geom):
    return [[round(p["lat"], 6), round(p["lon"], 6)] for p in geom]


def sy_sammen(deler):
    """Ytre kanter i en relasjon er ofte delt i flere veier; sy dem til ringer."""
    deler = [list(d) for d in deler if len(d) >= 2]
    ringer = []
    while deler:
        r = deler.pop()
        vokste = True
        while vokste and r[0] != r[-1]:
            vokste = False
            for i, d in enumerate(deler):
                if d[0] == r[-1]:
                    r += d[1:]
                elif d[-1] == r[-1]:
                    r += d[-2::-1]
                elif d[-1] == r[0]:
                    r = d[:-1] + r
                elif d[0] == r[0]:
                    r = d[::-1][:-1] + r
                else:
                    continue
                deler.pop(i)
                vokste = True
                break
        if len(r) >= 4:
            ringer.append(r)
    return ringer


def main():
    osm = json.load(open(sys.argv[1], encoding="utf-8")) if len(sys.argv) > 1 else hent()
    steder = []
    for e in osm["elements"]:
        t = e.get("tags", {})
        navn = t.get("name")
        if not navn:
            continue
        slag = t.get("shop") or t.get("place") or t.get("amenity")
        if e["type"] == "way" and "geometry" in e:
            ringer = [ring(e["geometry"])]
        elif e["type"] == "relation":
            ringer = sy_sammen(
                ring(m["geometry"]) for m in e.get("members", []) if m.get("role") == "outer" and "geometry" in m
            )
        else:
            continue
        ringer = [r for r in ringer if len(r) >= 4]
        if ringer:
            steder.append(
                {"navn": navn, "slag": slag, "kategori": KATEGORI.get(slag, "nabolag"), "ringer": ringer}
            )
    with open("data/stedsflater.json", "w", encoding="utf-8") as f:
        json.dump(steder, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(steder)} stedsflater skrevet til data/stedsflater.json")
    for s in sorted(steder, key=lambda x: x["navn"])[:200]:
        print(f"   {s['kategori']:8} {s['navn']}")


if __name__ == "__main__":
    main()
