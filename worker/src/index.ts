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

type Env = { IMMICH_URL: string; IMMICH_SHARE_KEY: string; KODE_SJEKKSUM: string };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "content-disposition, content-length",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

    const url = new URL(req.url);
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
