/**
 * Setter admin-passordet.
 *
 * Passordet skrives her og går to steder: sjekksummen inn i
 * src/lib/kode.ts, så nettleseren kan slippe deg inn, og den samme
 * sjekksummen inn som hemmelighet hos mellomtjeneren, så loggen kan leses.
 * Selve passordet lagres ingen steder.
 *
 *   npm run admin-passord
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const KODE = path.join(process.cwd(), "src", "lib", "kode.ts");

/** Leser uten å vise det som skrives. */
function spør(spørsmål: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const inn = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
    const skjul = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    if (inn.isTTY) {
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s) {
        if (s.includes(spørsmål)) skjul.call(this, s);
      };
    }
    rl.question(spørsmål, (svar) => {
      rl.close();
      process.stdout.write("\n");
      resolve(svar);
    });
  });
}

async function main() {
  const passord = (await spør("Nytt admin-passord: ")).trim();
  if (passord.length < 8) {
    console.error("For kort — minst åtte tegn.");
    process.exit(1);
  }
  const igjen = (await spør("En gang til: ")).trim();
  if (passord !== igjen) {
    console.error("De to var ikke like.");
    process.exit(1);
  }

  const sum = createHash("sha256").update(passord).digest("hex");

  const kode = await fs.readFile(KODE, "utf-8");
  const nytt = kode.replace(
    /export const ADMIN_SJEKKSUM = "[0-9a-f]*";/,
    `export const ADMIN_SJEKKSUM = "${sum}";`
  );
  if (nytt === kode) {
    console.error("Fant ikke ADMIN_SJEKKSUM i src/lib/kode.ts.");
    process.exit(1);
  }
  await fs.writeFile(KODE, nytt);
  console.log("Sjekksummen er skrevet til src/lib/kode.ts.");

  // Mellomtjeneren må kjenne den samme, ellers slipper ikke loggen ut.
  execFileSync("npx", ["wrangler", "secret", "put", "ADMIN_SJEKKSUM"], {
    cwd: path.join(process.cwd(), "worker"),
    input: sum,
    stdio: ["pipe", "inherit", "inherit"],
  });

  console.log("\nFerdig. Logg inn som ADMIN med passordet du nettopp skrev.");
  console.log("Husk å kjøre `npm run build` og `npm run deploy`.");
}

main().catch((e) => {
  console.error(String(e).slice(0, 400));
  process.exit(1);
});
