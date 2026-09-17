/**
 * Regresjonstester for koblingen mellom bilder og adresser, kjørt mot den
 * publiserte datafila. Hvert tilfelle er et problem Scott har meldt: et
 * gårdsrom, en takterrasse eller et borettslag som kom opp på feil adresse.
 *
 * Kjør etter `npm run prepare-static`:  npm run test:koblinger
 */
const path = require("node:path");
const root = path.join(__dirname, "..");
const idx = require(path.join(root, "public/data/index.json")).photos;
const a2b = require(path.join(root, "public/data/adresse-til-bygard.json"));

const FELLES = new Set(["bakgard", "takterrasse", "fasade"]);

/** Samme regel som søket i nettleseren (src/lib/search-client.ts). */
function bundetTil(adr) {
  const b = a2b[adr] ?? null;
  return idx.filter((p) => {
    if (p.adresser?.length) return p.adresser.includes(adr) || (!!p.bygardId && p.bygardId === b);
    if (p.bygardId) return b !== null && p.bygardId === b;
    return false;
  });
}
const felles = (adr) => bundetTil(adr).filter((p) => FELLES.has(p.category)).length;
const viser = (adr, navn) => bundetTil(adr).filter((p) => p.placeName === navn).length;

const tester = [
  // Torshov: gårdsrommet bak Hegermanns gate 9C (også «Kvartal VI»)
  ["Omsens gate 6 har gårdsrommet", () => felles("Omsens gate 6") > 0],
  ["Hegermanns gate 7 har gårdsrommet", () => felles("Hegermanns gate 7") > 0],
  ["Omsens gate 3 har det ikke", () => felles("Omsens gate 3") === 0],
  ["Knud Graahs gate 6 har Søylegården", () => viser("Knud Graahs gate 6", "Søylegården") > 0],
  ["Vogts gate 57A har ingen av Torshov-gårdene", () => felles("Vogts gate 57A") === 0],
  // Grefsen terrassehus og Brekkeveien
  ["Grefsenkollveien 12C har terrassehuset", () => viser("Grefsenkollveien 12C", "Grefsen Terrassehus") > 0],
  ["Grefsenkollveien 14A har ikke terrassehuset", () => viser("Grefsenkollveien 14A", "Grefsen Terrassehus") === 0],
  ["Brekkeveien 19 har fasaden", () => viser("Brekkeveien 19", "Fasade -Brekkeveien 19") > 0],
  ["Brekkeveien 16 har ingen fellesarealer", () => felles("Brekkeveien 16") === 0],
  // Takterrasse hører til bygningen, ikke kvartalet
  ["Magnus' gate 1B deler terrassen med 1A", () => viser("Magnus' gate 1B", "Magnus' gate 1A") > 0],
  ["Magnus' gate 13 har ikke terrassen", () => viser("Magnus' gate 13", "Magnus' gate 1A") === 0],
  ["Sverres gate 4 har ingen fellesarealer", () => felles("Sverres gate 4") === 0],
  // Eiendomsbilder med adresse som navn
  ["Grefsenkollveien 16B deler blokkbildet med 16A", () => viser("Grefsenkollveien 16B", "Grefsenkollveien 16A") > 0],
  ["Grefsenkollveien 12C har ikke 16A", () => viser("Grefsenkollveien 12C", "Grefsenkollveien 16A") === 0],
  ["Ludvig Karstens vei 12 har ikke nr. 10", () => viser("Ludvig Karstens vei 12", "Ludvig Karstens vei 10") === 0],
  // Borettslag
  ["Christian Schous vei 3A har 3F sine bilder", () => viser("Christian Schous vei 3A", "Christian Schous vei 3F") > 0],
  ["Christian Schous vei 5 har dem ikke", () => viser("Christian Schous vei 5", "Christian Schous vei 3F") === 0],
  ["Akebakkeskogen 33 har borettslagets bilder", () => bundetTil("Akebakkeskogen 33").length >= 3],
  ["Nordstjerneveien 6 har Myrer-bildene", () => viser("Nordstjerneveien 6", "Kurveien 42") > 0],
  ["Myrerskogveien 12 er ikke i Myrer borettslag", () => viser("Myrerskogveien 12", "Kurveien 42") === 0],
  // Grefsenkollen fra Dropbox holdes utenfor
  ["Grefsenkollen kommer bare fra Immich", () => idx.filter((p) => p.placeName === "Grefsenkollen").every((p) => p.id.startsWith("immich:"))],
  // Alle fellesarealer må være knyttet til noe
  ["Alle fellesarealer er koblet", () => idx.filter((p) => FELLES.has(p.category)).every((p) => p.bygardId || p.adresser?.length)],
];

let feil = 0;
for (const [navn, sjekk] of tester) {
  const ok = sjekk();
  if (!ok) feil++;
  console.log(`${ok ? "✓" : "✗"} ${navn}`);
}
console.log(feil ? `\n${feil} av ${tester.length} feilet` : `\nAlle ${tester.length} tester OK`);
process.exit(feil ? 1 : 0);
