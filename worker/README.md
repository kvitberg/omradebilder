# Mellomtjener for originalfiler

Holder Immich-nøkkelen utenfor den publiserte siden. Se kommentaren i `src/index.ts`.

Første gang:

    cd worker
    npx wrangler login                       # åpner nettleseren, logg inn i Cloudflare
    npx wrangler deploy                      # gir en adresse: https://omradebilder-originaler.<konto>.workers.dev
    npx wrangler secret put IMMICH_SHARE_KEY # lim inn nøkkelen fra .env.local
    npx wrangler secret put KODE_SJEKKSUM    # SHA-256 av koden: printf 'koden' | shasum -a 256

Deretter settes `ORIGINAL_PROXY=https://omradebilder-originaler.<konto>.workers.dev` i `.env.local`,
og `npm run deploy` bygger siden med lenker til tjeneren i stedet for til Immich.
