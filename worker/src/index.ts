/**
 * Mellomtjener for originalfiler fra Immich.
 *
 * Siden er statisk, så alt den vet, vet alle som finner den. Derfor lå
 * delingsnøkkelen til Immich i den publiserte datafila. Nå ber siden om
 * /original/<id>, og denne tjeneren legger på nøkkelen på sin side.
 *
 * Nedlasting krever koden til siden, sendt som sjekksum i `t`. Det er
 * samme dørterskel som porten på forsiden — ikke mer, ikke mindre.
 */

type Env = {
  IMMICH_URL: string;
  IMMICH_SHARE_KEY: string;
  KODE_SJEKKSUM: string;
  RAPPORTER: KVNamespace;
};

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-expose-headers": "content-disposition, content-length",
};

/**
 * En feilmelding fra portalen.
 *
 * Under beta er det meglerne som ser hva som er galt — at et bakgårdsbilde
 * er bundet til feil adresse, eller at et sted heter noe annet enn det gjør
 * i virkeligheten. Meldingen lagres som den kom, med det portalen visste om
 * hva brukeren så på, og leses med `npm run rapporter`.
 */
const MAKS_TEKST = 4000;

async function taImotRapport(req: Request, env: Env): Promise<Response> {
  if (req.headers.get("content-type")?.includes("application/json") !== true) {
    return new Response("Forventet JSON", { status: 415, headers: CORS });
  }

  let inn: Record<string, unknown>;
  try {
    inn = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response("Ugyldig JSON", { status: 400, headers: CORS });
  }

  const tekst = String(inn.tekst ?? "").trim();
  if (!tekst) return new Response("Tom melding", { status: 400, headers: CORS });

  const rapport = {
    mottatt: new Date().toISOString(),
    tekst: tekst.slice(0, MAKS_TEKST),
    // Konteksten portalen sendte med. Alt er frivillig; en melding uten
    // sted er fortsatt verdt å ta vare på.
    kontor: String(inn.kontor ?? "").slice(0, 80) || null,
    adresse: String(inn.adresse ?? "").slice(0, 200) || null,
    sted: String(inn.sted ?? "").slice(0, 200) || null,
    kategori: String(inn.kategori ?? "").slice(0, 80) || null,
    bildeId: String(inn.bildeId ?? "").slice(0, 80) || null,
    filnavn: String(inn.filnavn ?? "").slice(0, 200) || null,
  };

  // Nøkkelen sorterer kronologisk av seg selv, og halen skiller to
  // meldinger sendt i samme millisekund.
  const nøkkel = `${rapport.mottatt}-${crypto.randomUUID().slice(0, 8)}`;
  await env.RAPPORTER.put(nøkkel, JSON.stringify(rapport));

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "content-type": "application/json" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);

    if (url.pathname === "/rapport") {
      if (req.method !== "POST") {
        return new Response("Bruk POST", { status: 405, headers: CORS });
      }
      if (url.searchParams.get("t") !== env.KODE_SJEKKSUM) {
        return new Response("Koden mangler eller er feil", { status: 403, headers: CORS });
      }
      return taImotRapport(req, env);
    }

    const m = url.pathname.match(/^\/original\/([0-9a-f-]{36})$/);
    if (!m) return new Response("Ikke funnet", { status: 404, headers: CORS });

    if (url.searchParams.get("t") !== env.KODE_SJEKKSUM) {
      return new Response("Koden mangler eller er feil", { status: 403, headers: CORS });
    }

    const id = m[1];
    const nøkkel = (env.IMMICH_SHARE_KEY ?? "").trim();
    let meta: Response;
    let fil: Response;
    try {
      const hoder = { "user-agent": "omradebilder/1.0", accept: "*/*" };
      [meta, fil] = await Promise.all([
        fetch(`${env.IMMICH_URL}/api/assets/${id}?key=${nøkkel}`, { headers: hoder }),
        fetch(`${env.IMMICH_URL}/api/assets/${id}/original?key=${nøkkel}`, { headers: hoder }),
      ]);
    } catch (err) {
      return new Response(`Nådde ikke Immich: ${(err as Error).message}`, {
        status: 502,
        headers: CORS,
      });
    }
    if (!fil.ok) {
      // Statusen tas med: en 403 er feil nøkkel, en 5xx er Immich som sliter.
      const hvorfor = (await fil.text()).slice(0, 200);
      return new Response(`Immich svarte ${fil.status}: ${hvorfor}`, { status: 502, headers: CORS });
    }

    const navn = meta.ok
      ? ((await meta.json()) as { originalFileName?: string }).originalFileName ?? `${id}.jpg`
      : `${id}.jpg`;

    return new Response(fil.body, {
      headers: {
        ...CORS,
        "content-type": fil.headers.get("content-type") ?? "image/jpeg",
        "content-length": fil.headers.get("content-length") ?? "",
        // Tvinger nedlasting med originalfilnavnet — da slipper siden blob-omveien.
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(navn)}`,
        "cache-control": "private, max-age=3600",
      },
    });
  },
};
