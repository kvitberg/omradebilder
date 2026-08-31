export type PhotoEntry = {
  id: string;
  dropboxPath: string;
  category: string;
  placeName: string;
  lat: number | null;
  lng: number | null;
  locationSource: "exif" | "geocode" | "none";
  clientModified: string;
  /**
   * Sti til en ferdig generert miniatyr under /public, f.eks. "/thumbs/ab12.jpg".
   * Null før `npm run thumbs` har kjørt — da faller visningen tilbake på å
   * hente bildet fra Dropbox ved hvert kall.
   */
  thumb?: string | null;
  /**
   * Kvartalet bildet hører til, satt bare for bakgårdsbilder der mappenavnet
   * er entydig klassifisert. Bakgårdsbilder vises for alle adressene rundt
   * samme gårdsrom i stedet for å filtreres på avstand.
   */
  bygardId?: string | null;
};

export type SearchIndex = {
  /** null før første `npm run sync`. */
  generatedAt: string | null;
  photos: PhotoEntry[];
};
