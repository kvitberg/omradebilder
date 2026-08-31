import { config } from "dotenv";
config({ path: ".env.local" });

import readline from "node:readline/promises";
import { DropboxAuth } from "dropbox";

async function main() {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (!appKey || !appSecret) {
    console.error("Sett DROPBOX_APP_KEY og DROPBOX_APP_SECRET i .env.local først (fra Dropbox App Console).");
    process.exit(1);
  }

  const auth = new DropboxAuth({ clientId: appKey, clientSecret: appSecret });

  const authUrl = await auth.getAuthenticationUrl(
    "", // redirectUri - ikke i bruk her, vi limer inn koden manuelt
    undefined, // state
    "code",
    "offline", // offline => vi får en refresh token som ikke utløper
    undefined,
    undefined,
    false
  );

  console.log("1. Åpne denne lenken i nettleseren og logg inn / godkjenn appen:\n");
  console.log(authUrl);
  console.log("\n2. Dropbox viser deg en kode etterpå. Lim den inn her.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("Kode fra Dropbox: ")).trim();
  rl.close();

  const response = await auth.getAccessTokenFromCode("", code);
  const result = response.result as { refresh_token?: string };

  if (!result.refresh_token) {
    console.error("Fikk ikke refresh token tilbake. Sjekk at appen er satt opp med 'offline' tilgang.");
    process.exit(1);
  }

  console.log("\nLegg denne linjen til i .env.local:\n");
  console.log(`DROPBOX_REFRESH_TOKEN=${result.refresh_token}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
