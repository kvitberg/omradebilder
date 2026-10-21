/**
 * Regresjonstester for hvilken tagg som vinner.
 *
 * Immich gir taggene i vilkårlig rekkefølge, og før rangeringen avgjorde
 * den klassifiseringen: en kafé tagget «fellesareal» ble bygningens
 * bakgård og dukket opp hos hver oppgang i huset. Rekkefølgen under er
 * derfor blandet med vilje — svaret skal være det samme uansett.
 *
 *   npm run test:tagger
 */
import { categoryFromTags } from "../src/lib/categories";

const tester: Array<[string[], string | null, string]> = [
  [["bakgård", "cafe", "restaurant", "fellesareal"], "bakgard",
    "et dronebilde av et gårdsrom med kafé i er fortsatt et gårdsrom"],
  [["cafe", "bakgård"], "bakgard", "samme svar med omvendt rekkefølge"],
  [["fellesareal", "bar"], "restaurant", "«fellesareal» alene taper mot stedet"],
  [["bar", "fellesareal"], "restaurant", "og rekkefølgen betyr ingenting"],
  [["fellesareal"], "bakgard", "«fellesareal» alene er fortsatt et fellesareal"],
  [["park", "nabolag", "fellesareal"], "park", "nabolag sier minst av alt"],
  [["nabolag", "restaurant"], "restaurant", "nabolag taper mot stedet"],
  [["nabolag"], "nabolag", "nabolag alene står"],
  [["takterrasse", "restaurant"], "takterrasse", "takterrassen hører til huset"],
  [["ukjent-tagg"], null, "en tagg portalen ikke kjenner gir ingenting"],
  [[], null, "ingen tagger gir ingenting"],
];

let feil = 0;
for (const [tagger, ventet, hvorfor] of tester) {
  const fikk = categoryFromTags(tagger);
  if (fikk === ventet) {
    console.log(`✓ [${tagger.join(", ")}] → ${fikk}`);
  } else {
    feil++;
    console.log(`✗ [${tagger.join(", ")}] → ${fikk}, ventet ${ventet} — ${hvorfor}`);
  }
}
console.log(feil ? `\n${feil} av ${tester.length} feilet` : `\nAlle ${tester.length} tester OK`);
process.exit(feil ? 1 : 0);
