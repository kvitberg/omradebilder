export type Category = {
  id: string;
  label: string;
  /** Kort redaksjonell tekst som vises på kategoriens magasinside. */
  description: string;
  keywords: string[];
};

// Rediger denne listen slik at den matcher din egen mappestruktur i Dropbox.
// Rekkefølgen her avgjør rekkefølgen på sidene i portalen.
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
    keywords: ["fasade", "facade", "bygg", "bygning"],
  },
  {
    id: "takterrasse",
    label: "Takterrasse",
    description:
      "Felles takflater og terrasser. Tilgangen følger bygningen, ikke nødvendigvis den enkelte adressen.",
    keywords: ["takterrasse", "tak", "terrasse", "rooftop"],
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
    keywords: ["stadion", "hall", "bad", "idrett", "bane", "løkka", "gym", "buldrevegg"],
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
export function detectCategory(pathSegments: string[]): {
  categoryId: string;
  matchedSegmentIndex: number | null;
} {
  for (let i = 0; i < pathSegments.length; i++) {
    const normalized = pathSegments[i].toLowerCase();
    for (const category of CATEGORIES) {
      if (category.keywords.some((kw) => normalized.includes(kw))) {
        return { categoryId: category.id, matchedSegmentIndex: i };
      }
    }
  }
  return { categoryId: "annet", matchedSegmentIndex: null };
}
