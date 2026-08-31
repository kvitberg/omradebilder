import { Dropbox, DropboxAuth } from "dropbox";

function buildAuth(): DropboxAuth {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const accessToken = process.env.DROPBOX_ACCESS_TOKEN;

  if (appKey && appSecret && refreshToken) {
    // Refresh-token-flyten fornyer access token selv, og er det som holder
    // en hostet app i gang over tid.
    return new DropboxAuth({ clientId: appKey, clientSecret: appSecret, refreshToken });
  }

  if (accessToken) {
    return new DropboxAuth({ accessToken });
  }

  throw new Error(
    "Mangler Dropbox-legitimasjon. Sett DROPBOX_APP_KEY + DROPBOX_APP_SECRET + DROPBOX_REFRESH_TOKEN " +
      "(se README), eller DROPBOX_ACCESS_TOKEN, i .env.local"
  );
}

let cached: Promise<Dropbox> | null = null;

/**
 * Dropbox-klient som peker på riktig navnerom.
 *
 * Bildene ligger under «Felles», som er et team-område. En vanlig klient ser
 * bare medlemmets personlige mappe, og da finnes ikke stien i det hele tatt.
 * Vi spør derfor kontoen om rot-navnerommet og setter det som path root.
 */
export function getDropboxClient(): Promise<Dropbox> {
  if (cached) return cached;

  cached = (async () => {
    const auth = buildAuth();
    const probe = new Dropbox({ auth });

    try {
      const account = await probe.usersGetCurrentAccount();
      const rootInfo = account.result.root_info;

      // Er de like, har kontoen ikke noe eget team-område, og vi lar den være.
      if (rootInfo && rootInfo.root_namespace_id !== rootInfo.home_namespace_id) {
        return new Dropbox({
          auth,
          pathRoot: JSON.stringify({ ".tag": "root", root: rootInfo.root_namespace_id }),
        });
      }
    } catch (err) {
      // Slår oppslaget feil, er en vanlig klient fortsatt bedre enn ingenting.
      console.warn("Klarte ikke å avgjøre Dropbox-navnerom, bruker personlig mappe:", err);
    }

    return probe;
  })();

  return cached;
}
