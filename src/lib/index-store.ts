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
  /**
   * Adressene bildet hører til, fra bildets eget navn eller fra
   * data/bakgard-navn.json. Bindes bildet til adresser, er det de som
   * gjelder — også når kvartalet rundt er for spredt til å si noe
   * meningsfullt. Et terrassehus dekker gjerne flere oppganger.
   */
  adresser?: string[] | null;
  /**
   * Lenke til originalfilen i full størrelse, for nedlastingsknappen.
   * Dropbox: en delingslenke med dl=1. Immich: originalen via delingsnøkkelen.
   * Settes av `npm run delingslenker`.
   */
  original?: string | null;
  /** Filnavnet nedlastingen får, f.eks. «1H0A1798.jpg». */
  filnavn?: string | null;
};

export type SearchIndex = {
  /** null før første `npm run sync`. */
  generatedAt: string | null;
  photos: PhotoEntry[];
};
