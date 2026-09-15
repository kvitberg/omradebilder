"""
Henter alle navngitte parkflater i Oslo fra OpenStreetMap og skriver dem
som enkle polygoner til data/parker.json.

Ett kall i stedet for ett per bilde: overpass-api.de stengte oss ute etter
hundre enkeltoppslag. Punkt-i-flate gjøres lokalt av src/lib/parker.ts.

Bruk:  python3 scripts/hent-parker.py            (henter fra Overpass)
       python3 scripts/hent-parker.py fil.json   (bruker en ferdig nedlastet fil)
"""

import json
import sys
import urllib.parse
import urllib.request

BBOX = "59.78,10.50,60.02,10.98"
FLATER = "^(park|garden|playground|dog_park|nature_reserve|recreation_ground)$"
SPØRRING = (
    f'[out:json][timeout:180];('
    f'way["leisure"~"{FLATER}"]["name"]({BBOX});'
    f'relation["leisure"~"{FLATER}"]["name"]({BBOX});'
    f'way["landuse"~"^(recreation_ground|village_green)$"]["name"]({BBOX});'
    f');out geom;'
)
SPEIL = [
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]


def hent():
    data = urllib.parse.urlencode({"data": SPØRRING}).encode()
    for url in SPEIL:
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "omradebilder/1.0 (scott.kvitberg@gmail.com)"})
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
    parker = []
    for e in osm["elements"]:
        t = e.get("tags", {})
        navn = t.get("name")
        if not navn:
            continue
        slag = t.get("leisure") or t.get("landuse")
        kategori = "natur" if slag == "nature_reserve" else "park"
        if e["type"] == "way" and "geometry" in e:
            ringer = [ring(e["geometry"])]
        elif e["type"] == "relation":
            ringer = sy_sammen(ring(m["geometry"]) for m in e.get("members", []) if m.get("role") == "outer" and "geometry" in m)
        else:
            continue
        ringer = [r for r in ringer if len(r) >= 4]
        if ringer:
            parker.append({"navn": navn, "slag": slag, "kategori": kategori, "ringer": ringer})
    with open("data/parker.json", "w", encoding="utf-8") as f:
        json.dump(parker, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(parker)} parkflater skrevet til data/parker.json")


if __name__ == "__main__":
    main()
