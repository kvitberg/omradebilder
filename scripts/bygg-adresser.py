"""
Setter sammen kartlaget over kvartalene: public/data/bygg.json.

Eiendomsgrensene kommer fra matrikkelen (data/teiger.json, hentet av
npm run teiger) — det er de som er kvartalet. Byggene inni kommer fra
OpenStreetMap (data/bygg.json, hentet av npm run hent-bygg) og kobles mot
adressepunktene her, slik at kartet kan vise adressen når man holder musa
over et bygg. Ingen nettbruk.

Bruk:  python3 scripts/bygg-adresser.py
"""

import json
import math
import re

from shapely.geometry import Polygon
from shapely.ops import unary_union

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


def kjente_navn(punkter):
    """
    Navn vi kjenner fra før: borettslag som spenner flere husnumre
    (data/borettslag.json) og kallenavn på bygårder (data/bakgard-navn.json).
    Begge er adresselister.
    """
    ut = {}
    for fil in ("data/borettslag.json", "data/bakgard-navn.json"):
        try:
            rå = json.load(open(fil, encoding="utf-8"))
        except FileNotFoundError:
            continue
        for navn, verdi in rå.items():
            if navn == "_":
                continue
            if isinstance(verdi, dict):
                adr = set(verdi.get("adresser") or [])
                for gate in verdi.get("gater") or []:
                    adr |= {a for a in punkter if a.startswith(gate + " ")}
            elif isinstance(verdi, list):
                adr = set(verdi)
            else:
                adr = {verdi}
            if adr:
                ut[navn] = adr
    return ut


def navngi(adresser, navneliste):
    """
    Navnet på laget, når vi kjenner det: Myrer borettslag, Grefsen
    Terrassehus. Kilden er data/borettslag.json og data/bakgard-navn.json,
    som Scott og jeg har fylt ut underveis.
    """
    sett = set(adresser)
    beste, treff = None, 0
    for navn, liste in navneliste.items():
        felles = len(sett & liste)
        if felles > treff:
            beste, treff = navn, felles
    # Halvparten av adressene må høre til laget før vi setter navnet.
    return beste if treff and treff >= min(2, len(sett)) else None


def forenkle(ring):
    """
    Grensene tegnes i småskala, så centimeterpresisjon er bare vekt.
    Halvannen meter toleranse og fem desimaler holder kartet skarpt og
    tar filen fra 1,8 til under en halv megabyte.
    """
    p = Polygon([(x, y) for y, x in ring])
    if not p.is_valid:
        p = p.buffer(0)
    if p.is_empty or p.geom_type != "Polygon":
        return [[round(y, 5), round(x, 5)] for y, x in ring]
    enkel = p.simplify(0.000015, preserve_topology=True)
    return [[round(y, 5), round(x, 5)] for x, y in enkel.exterior.coords]


def flate(ringer):
    """
    Teigene i et kvartal slås sammen til én flate.

    Et borettslag er gjerne flere teiger som ligger inntil hverandre; tegnet
    hver for seg blir det et lappeteppe med streker tvers gjennom gården.
    Sammenslått blir det ett svakt overlag, slik Scott ba om.
    """
    former = []
    for r in ringer:
        if len(r) < 4:
            continue
        p = Polygon([(x, y) for y, x in r])  # shapely vil ha (x, y)
        if not p.is_valid:
            p = p.buffer(0)
        if not p.is_empty:
            former.append(p)
    if not former:
        return []

    slått = unary_union(former)
    # En halv meter i grader: fjerner målestøy uten å flytte grensen synlig.
    slått = slått.simplify(0.000006, preserve_topology=True)
    deler = getattr(slått, "geoms", [slått])
    ut = []
    for d in deler:
        if d.geom_type != "Polygon" or d.is_empty:
            continue
        ut.append([[round(y, 6), round(x, 6)] for x, y in d.exterior.coords])
    return ut


def gardsrom(teiger):
    """
    Hvilke adresser deler et gårdsrom.

    Kvartalet er limt sammen av teiger som deler hjørner, og spenner av og
    til over en gate — da ble et gårdsrom vist til naboer tvers over veien.
    En eiendom og de eiendommene den grenser til er den rette kretsen: de
    ligger rundt det samme gårdsrommet.
    """
    ut = {}
    for bid, liste in teiger.items():
        former = []
        for t in liste:
            if len(t["r"]) < 4:
                continue
            p = Polygon([(x, y) for y, x in t["r"]])
            if not p.is_valid:
                p = p.buffer(0)
            if not p.is_empty:
                former.append((p, t))
        oppføringer = []
        for p, t in former:
            adresser = set(t["a"])
            for q, u in former:
                if q is p:
                    continue
                # En halv meter slingring: nabogrenser er ikke alltid helt like.
                if p.distance(q) <= 0.5 / 111320:
                    adresser.update(u["a"])
            if adresser:
                oppføringer.append({"r": t["r"], "a": sorted(adresser)})
        if oppføringer:
            ut[bid] = oppføringer
    return ut


def farger(flater):
    """
    Nabokvartaler skal ha ulik farge, slik at de lar seg skille.

    Grådig fargelegging: kvartaler som ligger nærmere enn 80 meter regnes
    som naboer, og hvert kvartal får den laveste fargen ingen nabo har.
    """
    from shapely.geometry import MultiPolygon

    former = {
        bid: MultiPolygon([Polygon([(x, y) for y, x in r]) for r in ringer if len(r) >= 4])
        for bid, ringer in flater.items()
        if ringer
    }
    grense = 80 / 111320  # ca. 80 meter i grader
    naboer = {bid: set() for bid in former}
    ider = sorted(former)
    for i, a in enumerate(ider):
        for b in ider[i + 1 :]:
            if former[a].distance(former[b]) <= grense:
                naboer[a].add(b)
                naboer[b].add(a)

    valgt = {}
    for bid in ider:
        brukt = {valgt[n] for n in naboer[bid] if n in valgt}
        valgt[bid] = next(i for i in range(12) if i not in brukt)
    return valgt


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
    try:
        teiger = json.load(open("data/teiger.json", encoding="utf-8"))
    except FileNotFoundError:
        teiger = {}
    punkter = json.load(open("data/adressepunkter.json", encoding="utf-8"))
    navneliste = kjente_navn(punkter)
    ut = {}
    for bid, liste in teiger.items():
        # Kartet tegner kvartalet som én flate og viser gatene i boblen.
        # Grensene for hver enkelt eiendom ville vært fire megabyte å laste
        # ned, og de vises aldri.
        # Teiger med samme matrikkelnummer er én eiendom — et borettslag
        # eier gjerne grunnen som flere teiger, og tegnet hver for seg blir
        # laget et lappeteppe. På Grefsen og Kjelsås er det regelen, ikke
        # unntaket.
        grupper = {}
        for t in liste:
            if len(t["r"]) < 4:
                continue
            nøkkel = ",".join(sorted(set(t.get("m") or []))) or f"teig{len(grupper)}"
            g = grupper.setdefault(nøkkel, {"ringer": [], "a": set(), "m": set()})
            g["ringer"].append(t["r"])
            g["a"].update(t["a"])
            g["m"].update(t.get("m") or [])

        eiendommer = []
        for g in grupper.values():
            adresser = sorted(g["a"])
            navn = navngi(adresser, navneliste)
            for del_ in flate(g["ringer"]):
                if len(del_) < 4:
                    continue
                oppføring = {"r": forenkle(del_), "a": adresser, "m": sorted(g["m"])}
                if navn:
                    oppføring["navn"] = navn
                eiendommer.append(oppføring)
        adresser = sorted({a for t in liste for a in t["a"]})
        # «209/346» er en matrikkeladresse uten gatenavn, ikke en gate.
        gater = sorted(
            {
                re.sub(r"\s+\d+\s*\w?$", "", a)
                for a in adresser
                if not re.match(r"^\d+/\d+", a)
            }
        )
        ut[bid] = {
            "flate": flate([t["r"] for t in liste]),
            "gater": gater,
            "antall": len(adresser),
            "teiger": eiendommer,
        }

    with open("data/gardsrom.json", "w", encoding="utf-8") as f:
        json.dump(gardsrom(teiger), f, ensure_ascii=False, separators=(",", ":"))

    for bid, farge in farger({b: v["flate"] for b, v in ut.items()}).items():
        ut[bid]["farge"] = farge

    with open("public/data/bygg.json", "w", encoding="utf-8") as f:
        json.dump(ut, f, ensure_ascii=False, separators=(",", ":"))

    antall = sum(v["antall"] for v in ut.values())
    teiger_ut = sum(len(v["teiger"]) for v in ut.values())
    deler = sum(len(v["flate"]) for v in ut.values())
    fra_matrikkel = sum(1 for bid in ut if bid in teiger)
    brukte = len({v.get("farge") for v in ut.values()})
    print(
        f"{len(ut)} kvartaler: {deler} flater ({fra_matrikkel} fra matrikkelen), "
        f"{antall} adresser, {teiger_ut} eiendommer, {brukte} farger"
    )


if __name__ == "__main__":
    main()
