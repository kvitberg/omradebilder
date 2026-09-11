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

export type MapDot = { lat: number; lng: number; category: string };

export const KATEGORI_FARGER: Record<string, string> = {
  kafe: "#b3892f",
  restaurant: "#b04a39",
  park: "#4a7c4e",
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
}: {
  center: { lat: number; lng: number };
  radiusMeters: number;
  dots: MapDot[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

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
      const seen = new Set<string>();
      for (const dot of dots) {
        const key = `${dot.lat.toFixed(4)},${dot.lng.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        L.circleMarker([dot.lat, dot.lng], {
          radius: 4,
          color: "#f2f0ec",
          weight: 1,
          fillColor: KATEGORI_FARGER[dot.category] ?? KATEGORI_FARGER.annet,
          fillOpacity: 0.9,
        }).addTo(map);
      }

      // Adressen selv, øverst.
      L.circleMarker([center.lat, center.lng], {
        radius: 6,
        color: "#f2f0ec",
        weight: 2,
        fillColor: "#12110f",
        fillOpacity: 1,
      }).addTo(map);

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
