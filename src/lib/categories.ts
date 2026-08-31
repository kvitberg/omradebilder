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
    keywords: ["bakgård", "bakgard", "gårdsrom", "gardsrom", "innhage"],
  },
  {
    id: "annet",
    label: "Annet",
    description: "Bilder som ikke faller inn under de andre kategoriene.",
    keywords: [],
  },
];

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
