"""
Bygger data/bygarder.json fra Kartverkets matrikkeldata.

Adresser som deler gårds- og bruksnummer ligger på samme eiendom, og det er
den beste åpne tilnærmingen til «hvilke adresser deler gårdsrom». Et bilde av
en bakgård vises dermed for alle adressene rundt den, i stedet for å filtreres
på avstand — som ville spredt gårdsrommet ut over hele nabolaget.

GML-fila er på 288 MB, så den strømmes gjennom med iterparse i stedet for å
leses inn i minnet.
"""

import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

GML = sys.argv[1]
UT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/bygarder.json")
APP = "{http://skjema.geonorge.no/SOSI/produktspesifikasjon/Matrikkelen-Adresse/20200501}"


def tekst(el, sti):
    funn = el.find(sti)
    return funn.text.strip() if funn is not None and funn.text else None


def main():
    # gnr/bnr -> adresser
    eiendommer = defaultdict(set)
    gater = defaultdict(set)
    antall = 0

    for _, el in ET.iterparse(GML, events=("end",)):
        if not el.tag.endswith("Vegadresse"):
            continue

        adresse = tekst(el, f"{APP}adresseTekstUtenAdressetilleggsnavn") or tekst(
            el, f"{APP}adresseTekst"
        )
        gnr = tekst(el, f"{APP}matrikkelnummerAdresse/{APP}Matrikkelnummer/{APP}gardsnummer")
        bnr = tekst(el, f"{APP}matrikkelnummerAdresse/{APP}Matrikkelnummer/{APP}bruksnummer")
        gate = tekst(el, f"{APP}adressenavn")

        if adresse and gnr and bnr:
            nokkel = f"{gnr}/{bnr}"
            eiendommer[nokkel].add(adresse)
            if gate:
                gater[nokkel].add(gate)
            antall += 1

        # Frigjør minne underveis — ellers vokser treet til hele fila.
        el.clear()

        if antall % 20000 == 0 and antall:
            print(f"  {antall} adresser ...", flush=True)

    print(f"\n{antall} gateadresser i {len(eiendommer)} eiendommer.")

    # Bare eiendommer med flere adresser er interessante: det er der en adresse
    # kan «arve» et bakgårdsbilde fra naboen.
    flere = {k: v for k, v in eiendommer.items() if len(v) > 1}
    print(f"{len(flere)} eiendommer har mer enn én adresse.")

    # Kolonihager, Lindøya og store borettslag ligger på én eiendom med
    # hundrevis av adresser. Et gårdsrom deles ikke av så mange, så de
    # utelates — ellers ville ett bakgårdsbilde dukket opp i et helt strøk.
    MAKS_ADRESSER = 50
    for tuple_ in [k for k, v in eiendommer.items() if len(v) > MAKS_ADRESSER]:
        del eiendommer[tuple_]
    print(f"{len(eiendommer)} eiendommer etter at de over {MAKS_ADRESSER} adresser er utelatt.")

    bygarder = []
    adresse_til_bygard = {}
    for nokkel, adresser in sorted(eiendommer.items()):
        bygard_id = f"oslo-{nokkel.replace('/', '-')}"
        bygarder.append(
            {
                "id": bygard_id,
                "matrikkel": nokkel,
                "gater": sorted(gater.get(nokkel, [])),
                "adresser": sorted(adresser),
            }
        )
        for a in adresser:
            adresse_til_bygard[a] = bygard_id

    UT.parent.mkdir(parents=True, exist_ok=True)
    UT.write_text(
        json.dumps(
            {
                "generatedAt": datetime.now(timezone.utc).isoformat(),
                "kommune": "0301",
                "kilde": "Kartverket, Matrikkelen adresse",
                "bygarder": bygarder,
                "adresseTilBygard": adresse_til_bygard,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    print(f"\nSkrevet {UT} ({UT.stat().st_size / 1024 / 1024:.1f} MB)")


if __name__ == "__main__":
    main()
