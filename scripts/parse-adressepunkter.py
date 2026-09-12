"""
Henter koordinaten til hver adresse i Oslo fra matrikkelen.

Brukes til å koble et bakgårdsbilde til riktig kvartal ut fra hvor bildet
faktisk er tatt. Bilder fra Immich har ekte GPS, men mappenavnet sier
gjerne bare «Torshov» — og da er punktet det eneste vi kan stole på.

Fila er et byggeverktøy og publiseres ikke; den trimmes bort i
prepare-static.
"""

import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from pyproj import Transformer

GML = sys.argv[1]
UT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/adressepunkter.json")
APP = "{http://skjema.geonorge.no/SOSI/produktspesifikasjon/Matrikkelen-Adresse/20200501}"
GML_NS = "{http://www.opengis.net/gml/3.2}"

# Matrikkelen leveres i EUREF89 UTM sone 33.
TIL_WGS84 = Transformer.from_crs("EPSG:25833", "EPSG:4326", always_xy=True)


def tekst(el, sti):
    funn = el.find(sti)
    return funn.text.strip() if funn is not None and funn.text else None


def main():
    punkter = {}
    antall = 0

    for _, el in ET.iterparse(GML, events=("end",)):
        if not el.tag.endswith("Vegadresse"):
            continue

        adresse = tekst(el, f"{APP}adresseTekstUtenAdressetilleggsnavn") or tekst(
            el, f"{APP}adresseTekst"
        )
        pos = tekst(el, f"{APP}representasjonspunkt/{GML_NS}Point/{GML_NS}pos")

        if adresse and pos:
            try:
                east, north = (float(v) for v in pos.split()[:2])
                lon, lat = TIL_WGS84.transform(east, north)
                punkter[adresse] = [round(lat, 6), round(lon, 6)]
                antall += 1
            except ValueError:
                pass

        el.clear()
        if antall % 20000 == 0 and antall:
            print(f"  {antall} punkter ...", flush=True)

    UT.parent.mkdir(parents=True, exist_ok=True)
    UT.write_text(json.dumps(punkter, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(punkter)} adressepunkter skrevet til {UT} ({UT.stat().st_size/1024/1024:.1f} MB)")


if __name__ == "__main__":
    main()
