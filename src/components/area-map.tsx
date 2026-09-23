"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Kartet på første oppslag: adressen i sentrum, en stiplet sirkel for
 * gangavstanden, og en prikk per fotografert sted — farget etter kategori,
 * i samme dempede palett som resten av oppslaget.
 *
 * Kartet er en figur, ikke et verktøy: all panorering og zooming er slått
 * av, slik at det oppfører seg som et trykt kartutsnitt i en salgsoppgave.
 */

export type MapDot = {
  lat: number;
  lng: number;
  category: string;
  placeName: string;
  distanceMeters: number;
  thumb: string | null;
  /** Originalfilen, til nedlastingslenken i popup-en. */
  original: string | null;
  filnavn: string | null;
};

export const KATEGORI_FARGER: Record<string, string> = {
  kafe: "#b3892f",
  restaurant: "#b04a39",
  park: "#4a7c4e",
  natur: "#2f6b5a",
  kollektiv: "#2f5d8c",
  skole: "#c2703d",
  kultur: "#8a4f7d",
  butikk: "#7a6a3a",
  nabolag: "#8d857a",
  bakgard: "#8a6ea0",
  takterrasse: "#3f6e8c",
  fasade: "#6b6862",
  annet: "#9aa3ad",
};

const AKSENT = "#b3892f";

export default function AreaMap({
  center,
  radiusMeters,
  dots,
  onFlytt,
}: {
  center: { lat: number; lng: number };
  radiusMeters: number;
  dots: MapDot[];
  /** Kalles når markøren slippes et nytt sted; søket gjøres på nytt der. */
  onFlytt?: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  // Kartet bygges én gang; uten denne ville markøren kalt en utdatert
  // funksjon etter neste rendring.
  const flyttRef = useRef(onFlytt);
  useEffect(() => {
    flyttRef.current = onFlytt;
  }, [onFlytt]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Leaflet tar i window ved import, så den kan først lastes i nettleseren.
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        attributionControl: true,
      });
      mapRef.current = map;
      map.attributionControl.setPrefix(false);

      // Lag kan ikke projiseres før kartet har et utsnitt — uten dette
      // feiler sirkelen med «layerPointToLatLng of undefined».
      map.setView([center.lat, center.lng], 15);

      // OSM-flisene er fargerike; gråtonefilteret i globals.css demper dem
      // ned til papirpaletten. CARTO/Mapbox-stilene krever API-nøkkel.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap-bidragsyterne",
        maxZoom: 19,
      }).addTo(map);

      const circle = L.circle([center.lat, center.lng], {
        radius: radiusMeters,
        color: AKSENT,
        weight: 1.5,
        dashArray: "6 6",
        fillColor: AKSENT,
        fillOpacity: 0.04,
      }).addTo(map);

      // Én prikk per sted, ikke per bilde — bildeserier ligger oppå hverandre.
      // Popup-en lar en bla gjennom serien.
      const perSted = new Map<string, MapDot[]>();
      for (const dot of dots) {
        const key = `${dot.lat.toFixed(4)},${dot.lng.toFixed(4)}`;
        const serie = perSted.get(key);
        if (serie) serie.push(dot);
        else perSted.set(key, [dot]);
      }

      for (const serie of perSted.values()) {
        const [første] = serie;
        const markør = L.circleMarker([første.lat, første.lng], {
          radius: 4,
          color: "#f2f0ec",
          weight: 1,
          fillColor: KATEGORI_FARGER[første.category] ?? KATEGORI_FARGER.annet,
          fillOpacity: 0.9,
        }).addTo(map);

        markør.bindPopup(lagPopup(serie), { closeButton: false, offset: [0, -2] });
      }

      /**
       * Innholdet bygges som DOM, ikke som HTML-streng, fordi pilene trenger
       * klikk-lyttere. Klikkene må heller ikke nå kartet — da ville Leaflet
       * lukket popup-en.
       */
      function lagPopup(serie: MapDot[]): HTMLElement {
        const rot = L.DomUtil.create("div");
        rot.style.cssText = "width:170px;font-family:inherit";
        L.DomEvent.disableClickPropagation(rot);

        const bilde = L.DomUtil.create("img", "", rot);
        bilde.alt = "";
        bilde.style.cssText =
          "width:100%;height:96px;object-fit:cover;display:block;margin-bottom:6px";

        const navn = L.DomUtil.create("div", "", rot);
        navn.style.cssText =
          "font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#12110f";

        const meta = L.DomUtil.create("div", "", rot);
        meta.style.cssText =
          "display:flex;align-items:baseline;justify-content:space-between;gap:8px;" +
          "font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#6b6862;margin-top:2px";
        const avstand = L.DomUtil.create("span", "", meta);

        // Nedlasting av bildet som vises, som under bildene i oppslaget.
        const last = L.DomUtil.create("a", "download-link", rot);
        last.textContent = "Last ned";
        last.style.cssText =
          "display:inline-block;margin-top:8px;font-size:10px;letter-spacing:.1em;" +
          "text-transform:uppercase;cursor:pointer";
        last.addEventListener("click", async (e) => {
          const d = serie[i];
          if (!d.original) return;
          // Immich sender fila «inline»; da må den hentes som blob for å
          // lastes ned med riktig navn. Dropbox-lenkene laster ned selv.
          if (!d.original.includes("/api/assets/")) return;
          e.preventDefault();
          last.textContent = "Henter…";
          try {
            const res = await fetch(d.original);
            const blob = await res.blob();
            const href = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = href;
            a.download = d.filnavn ?? "bilde.jpg";
            a.click();
            setTimeout(() => URL.revokeObjectURL(href), 10_000);
          } catch {
            window.open(d.original, "_blank", "noopener");
          } finally {
            last.textContent = "Last ned";
          }
        });

        let i = 0;
        const vis = () => {
          const d = serie[i];
          bilde.hidden = !d.thumb;
          if (d.thumb) bilde.src = d.thumb;
          navn.textContent = d.placeName;
          avstand.textContent = `${d.distanceMeters} m`;
          last.hidden = !d.original;
          if (d.original) {
            last.setAttribute("href", d.original);
            if (d.filnavn) last.setAttribute("download", d.filnavn);
          }
          if (teller) teller.textContent = `${i + 1} / ${serie.length}`;
        };

        // Bla-knappene finnes bare når det er noe å bla i.
        let teller: HTMLElement | null = null;
        if (serie.length > 1) {
          const nav = L.DomUtil.create("span", "", meta);
          nav.style.cssText = "display:inline-flex;align-items:baseline;gap:6px;white-space:nowrap";
          const knapp = (tekst: string, label: string, steg: number) => {
            const b = L.DomUtil.create("button", "", nav);
            b.type = "button";
            b.textContent = tekst;
            b.setAttribute("aria-label", label);
            b.style.cssText =
              "background:none;border:0;padding:0 2px;margin:0;cursor:pointer;" +
              "font:inherit;font-size:12px;line-height:1;color:#12110f";
            b.addEventListener("click", () => {
              i = (i + steg + serie.length) % serie.length;
              vis();
            });
            return b;
          };
          knapp("\u2190", "Forrige bilde", -1);
          teller = L.DomUtil.create("span", "", nav);
          knapp("\u2192", "Neste bilde", 1);
        }

        vis();
        return rot;
      }

      // Adressen selv, øverst. Den kan dras: slipper man den et nytt sted,
      // søkes det opp på nytt der, og sirkelen flytter seg med.
      const kanDras = !!flyttRef.current;
      const adresse = L.marker([center.lat, center.lng], {
        draggable: kanDras,
        keyboard: false,
        title: kanDras ? "Dra for å flytte søket" : undefined,
        icon: L.divIcon({
          className: "adressemarkor",
          iconSize: [16, 16],
          iconAnchor: [8, 8],
          html: `<span class="adressemarkor-prikk${kanDras ? " kan-dras" : ""}"></span>`,
        }),
      }).addTo(map);

      if (kanDras) {
        adresse.on("drag", () => circle.setLatLng(adresse.getLatLng()));
        adresse.on("dragend", () => {
          const p = adresse.getLatLng();
          flyttRef.current?.(p.lat, p.lng);
        });
      }

      map.fitBounds(circle.getBounds(), { padding: [16, 16] });

      // Flex-oppsettet kan gi beholderen endelig høyde et øyeblikk etter
      // første rendring; da må Leaflet måle seg selv på nytt.
      setTimeout(() => {
        if (!cancelled && mapRef.current) {
          map.invalidateSize();
          map.fitBounds(circle.getBounds(), { padding: [16, 16] });
        }
      }, 150);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [center.lat, center.lng, radiusMeters, dots]);

  return <div ref={containerRef} className="area-map h-full w-full bg-paper-deep" aria-hidden />;
}
