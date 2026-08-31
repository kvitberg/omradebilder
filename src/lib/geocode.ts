import type { LatLng } from "@/lib/geo";

/**
 * Geokoder en fritekst-adresse/stedsbeskrivelse til koordinater.
 * Bruker Google Geocoding API hvis GOOGLE_GEOCODING_API_KEY er satt,
 * ellers gratis OpenStreetMap Nominatim (rate-begrenset til ~1 kall/sek).
 */
export async function geocodeAddress(query: string): Promise<LatLng | null> {
  const googleKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (googleKey) {
    return geocodeWithGoogle(query, googleKey);
  }
  return geocodeWithNominatim(query);
}


/**
 * Et enkelt nettverksglitch skal ikke rive ned en synkronisering som har holdt
 * på i et kvarter. Vi prøver noen ganger med økende pause, og gir til slutt
 * opp med null — kalleren behandler det som "fant ikke adressen".
 */
async function fetchMedRetry(url: string, init?: RequestInit, forsok = 3): Promise<Response | null> {
  for (let i = 0; i < forsok; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
      // 5xx og 429 er forbigående; 4xx ellers er det ingen vits å prøve på nytt.
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      // Nettverksfeil eller timeout — prøv igjen.
    }
    if (i < forsok - 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
  }
  return null;
}

async function geocodeWithGoogle(query: string, apiKey: string): Promise<LatLng | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);

  const res = await fetchMedRetry(url.toString());
  if (!res) return null;
  const data = await res.json();
  const loc = data?.results?.[0]?.geometry?.location;
  if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
  return { lat: loc.lat, lng: loc.lng };
}

async function geocodeWithNominatim(query: string): Promise<LatLng | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const res = await fetchMedRetry(url.toString(), {
    headers: { "User-Agent": "omradeportal/1.0 (personlig bildeportal)" },
  });
  if (!res) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  const first = data[0];
  if (!first) return null;
  return { lat: parseFloat(first.lat), lng: parseFloat(first.lon) };
}
