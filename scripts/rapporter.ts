/**
 * Leser feilmeldingene som er sendt inn fra portalen.
 *
 * Meldingene ligger i KV-en til mellomtjeneren, én nøkkel per melding, med
 * tidspunktet først så de sorterer seg selv. `--slett` tømmer listen når
 * det som står der er tatt tak i.
 */
import { execFileSync } from "node:child_process";

const SLETT = process.argv.includes("--slett");

function wrangler(...args: string[]): string {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: new URL("../worker", import.meta.url).pathname,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

type Rapport = {
  mottatt: string;
  tekst: string;
  kontor: string | null;
  adresse: string | null;
  sted: string | null;
  kategori: string | null;
  bildeId: string | null;
  filnavn: string | null;
};

const nøkler = (
  JSON.parse(wrangler("kv", "key", "list", "--binding", "RAPPORTER", "--remote")) as Array<{
    name: string;
  }>
).map((k) => k.name);

if (nøkler.length === 0) {
  console.log("Ingen feilmeldinger.");
  process.exit(0);
}

nøkler.sort();
console.log(`${nøkler.length} ${nøkler.length === 1 ? "melding" : "meldinger"}\n`);

for (const nøkkel of nøkler) {
  const r = JSON.parse(
    wrangler("kv", "key", "get", nøkkel, "--binding", "RAPPORTER", "--remote")
  ) as Rapport;
  const dato = new Date(r.mottatt).toLocaleString("no-NO");
  // Stedet er det viktigste: det er som regel der feilen sitter.
  const hode = [r.sted, r.kategori, r.adresse].filter(Boolean).join(" · ");
  console.log(`── ${dato}${r.kontor ? `  (${r.kontor})` : ""}`);
  if (hode) console.log(`   ${hode}`);
  if (r.filnavn) console.log(`   ${r.filnavn}`);
  console.log(`   ${r.tekst.replace(/\n/g, "\n   ")}\n`);
}

if (SLETT) {
  for (const nøkkel of nøkler) {
    wrangler("kv", "key", "delete", nøkkel, "--binding", "RAPPORTER", "--remote");
  }
  console.log(`Slettet ${nøkler.length}.`);
}
