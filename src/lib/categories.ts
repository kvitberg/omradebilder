export type Category = {
  id: string;
  label: string;
  /** Kort redaksjonell tekst som vises på kategoriens magasinside. */
  description: string;
  keywords: string[];
};

// Rediger denne listen slik at den matcher din egen mappestruktur i Dropbox.
// Rekkefølgen her avgjør rekkefølgen på sidene i portalen.
/**
 * Kategoriene som lover at bildet hører til én bestemt bygning.
 *
 * Disse vises bare til adressene de er knyttet til, aldri til nabolaget
 * rundt. Derfor stilles det strengere krav til dem enn til de øvrige.
 */
export const FELLESAREAL_KATEGORIER = new Set(["bakgard", "takterrasse", "fasade"]);

/**
 * Fellesarealene som hører til én bygning, ikke til kvartalet. Et gårdsrom
 * deles av alle rundt det, men en takterrasse og en fasade er ett hus —
 * de vises bare for oppgangene med samme husnummer.
 */
export const BYGNING_KATEGORIER = new Set(["takterrasse", "fasade"]);

export const CATEGORIES: Category[] = [
  {
    id: "kafe",
    label: "Kafé",
    description:
      "Steder å sette seg ned med en kopp. Fotografert på stedet, i det lyset dagen faktisk hadde.",
    keywords: ["cafe", "café", "kafe", "kafé", "kaffebar", "coffee"],
  },
  {
    id: "restaurant",
    label: "Restaurant",
    description:
      "Spisesteder i nabolaget — fasader, inngangspartier og uteserveringer slik de møter deg fra fortauet.",
    keywords: ["restaurant", "resturant", "spisested", "bistro"],
  },
  {
    id: "park",
    label: "Park",
    description:
      "Grøntområdene som avgjør hvordan et nabolag føles. Plasser, parker og friområder innen gangavstand.",
    keywords: ["park", "grøntområde", "grontomrade", "friområde", "friomrade", "plass"],
  },
  {
    id: "fasade",
    label: "Fasade",
    description:
      "Bygningene selv. Materialbruk, høyder og gatebilde — det som blir stående lenge etter at butikkene har byttet navn.",
    keywords: ["fasade", "facade"],
  },
  {
    id: "takterrasse",
    label: "Takterrasse",
    description:
      "Felles takflater og terrasser. Tilgangen følger bygningen, ikke nødvendigvis den enkelte adressen.",
    // «tak» og «terrasse» alene er for løst: «Margaretakirken» inneholder
    // «tak», og «Victoria terrasse» og «Schouterrassen» er gatenavn.
    // Sammensetningene er derimot entydige.
    keywords: ["takterrasse", "takhage", "terrassehus", "rooftop"],
  },
  {
    id: "bakgard",
    label: "Bakgård",
    description:
      "Gårdsrommene bak fasadene — de som avgjør om en leilighet har et sted å sitte ute.",
    keywords: ["bakgård", "bakgard", "gårdsrom", "gardsrom", "innhage", "fellesareal"],
  },
  {
    id: "kollektiv",
    label: "Kollektiv",
    description:
      "T-bane, tog og trikk i nærheten — det som avgjør hvor lang morgenen faktisk blir.",
    keywords: ["t-bane", "tbane", "stasjon", "holdeplass", "trikk", "kollektiv"],
  },
  {
    id: "skole",
    label: "Skole og barnehage",
    description:
      "Skolene og barnehagene i nabolaget, fotografert fra gata slik de møter deg på veien forbi.",
    keywords: ["skole", "barnehage", "gymnas", "videregående"],
  },
  {
    id: "natur",
    label: "Natur",
    description:
      "Vann, marka og utsiktspunktene rundt — nabolagets pusterom utenfor kvartalene.",
    keywords: ["vann", "marka", "skogen", "kollen", "elva", "badeplass", "strand"],
  },
  {
    id: "kultur",
    label: "Kultur",
    description:
      "Kino, museer og scener i nærområdet — det som gjør en kveld hjemme til et valg.",
    keywords: ["kino", "museum", "teater", "galleri", "bibliotek", "scene"],
  },
  {
    id: "butikk",
    label: "Handel",
    description:
      "Dagligvare og butikker innen gangavstand — hverdagslogistikken som avgjør hvor enkelt livet blir.",
    keywords: ["dagligvare", "butikk", "kjøpesenter", "senter", "bunnpris", "kiwi", "rema", "meny", "coop", "joker"],
  },
  {
    id: "aktivitet",
    label: "Idrett og aktivitet",
    description:
      "Banene, hallene og badene i nærheten — der nabolaget holder seg i bevegelse.",
    // «hall», «bad» og «bane» treffer for mye på egen hånd (Marshall,
    // Badehusgata, urbane), så de må stå i sammensatte former.
    keywords: ["stadion", "idrettshall", "svømmehall", "idrett", "løkka", "buldrevegg", "treningssenter"],
  },
  {
    id: "nabolag",
    label: "Nabolag",
    description:
      "Selve området — gatene, plassene og stemningen som ikke lar seg feste til én adresse.",
    keywords: [],
  },
  {
    id: "annet",
    label: "Annet",
    description: "Bilder som ikke faller inn under de andre kategoriene.",
    keywords: [],
  },
];

/**
 * Tagger satt i Immich, oversatt til kategori.
 *
 * Tagger slås opp eksakt, ikke som delstreng slik mappenavn gjør. En tagg er
 * en kuratert verdi fra en kort liste, og delstrengsøk ville her gjort
 * «Bar» til et treff i «Barnehage».
 *
 * Ukjente tagger faller videre til nøkkelordsøket.
 */
export const TAGG_TIL_KATEGORI: Record<string, string> = {
  // Servering
  cafe: "kafe",
  kafe: "kafe",
  kafé: "kafe",
  bakeri: "kafe",
  restaurant: "restaurant",
  bar: "restaurant",
  pub: "restaurant",
  // Uteområder
  park: "park",
  lekeplass: "park",
  badeplass: "natur",
  natur: "natur",
  utsikt: "natur",
  // Fellesarealer — følger bygningen, ikke gangavstanden
  fellesareal: "bakgard",
  bakgård: "bakgard",
  bakgard: "bakgard",
  gårdsrom: "bakgard",
  innhage: "bakgard",
  takterrasse: "takterrasse",
  // Kollektiv
  busstopp: "kollektiv",
  trikkestopp: "kollektiv",
  togstasjon: "kollektiv",
  "t-banestasjon": "kollektiv",
  tbanestasjon: "kollektiv",
  kollektiv: "kollektiv",
  // Handel
  matbutikk: "butikk",
  dagligvare: "butikk",
  butikk: "butikk",
  kjøpesenter: "butikk",
  // Øvrig
  skole: "skole",
  barnehage: "skole",
  museum: "kultur",
  kino: "kultur",
  teater: "kultur",
  bibliotek: "kultur",
  kultur: "kultur",
  idrettsarena: "aktivitet",
  idrett: "aktivitet",
  treningssenter: "aktivitet",
  fasade: "fasade",
  nabolag: "nabolag",
};

/** Første tagg som er kjent, eller null. */
export function categoryFromTags(tags: string[]): string | null {
  for (const tag of tags) {
    const treff = TAGG_TIL_KATEGORI[tag.trim().toLowerCase()];
    if (treff) return treff;
  }
  return null;
}

const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category {
  return CATEGORY_BY_ID.get(id) ?? CATEGORIES[CATEGORIES.length - 1];
}

/**
 * Ser gjennom mappe-segmentene (fra rot til fil) og finner første segment
 * som matcher et kategori-nøkkelord.
 */
/**
 * Nøkkelordet må starte et ord.
 *
 * Med ren delstreng ble «Margaretakirken» en takterrasse, fordi navnet
 * inneholder bokstavene «tak». Ordgrensen tillater fortsatt norske
 * sammensetninger og bøyninger i enden — «takterrassen» treffer
 * «takterrasse» — men ikke midt inne i et annet ord.
 */
function treffer(tekst: string, nøkkelord: string): boolean {
  const i = tekst.indexOf(nøkkelord);
  if (i === -1) return false;
  if (i === 0) return true;
  // Foran må det stå noe som ikke er en bokstav eller et tall.
  return !/[\p{L}\p{N}]/u.test(tekst[i - 1]);
}

export function detectCategory(
  pathSegments: string[],
  /**
   * Er siste segment et filnavn? Da får det ikke avgjøre et fellesareal.
   *
   * En mappe som heter «Fasade - Brekkeveien 19» er en påstand om hvilken
   * bygning bildene hører til. Et filnavn som «fasade01_kveld.jpg» er bare
   * en notis i en bildeserie — den lå i mappa «Hanami - Tjuvholmen» og gjorde
   * en restaurant til en fasade uten adresse.
   */
  opts: { sisteErFilnavn?: boolean } = {}
): {
  categoryId: string;
  matchedSegmentIndex: number | null;
} {
  for (let i = 0; i < pathSegments.length; i++) {
    const erFilnavn = !!opts.sisteErFilnavn && i === pathSegments.length - 1;
    const normalized = pathSegments[i].toLowerCase();
    for (const category of CATEGORIES) {
      if (erFilnavn && FELLESAREAL_KATEGORIER.has(category.id)) continue;
      if (category.keywords.some((kw) => treffer(normalized, kw))) {
        return { categoryId: category.id, matchedSegmentIndex: i };
      }
    }
  }
  return { categoryId: "annet", matchedSegmentIndex: null };
}
