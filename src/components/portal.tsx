"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEvent, MouseEvent } from "react";
import {
  search,
  suggest,
  adresseVedPunkt,
  loadBygg,
  SearchError,
  type Group,
  type Category,
  type SearchPhoto as Photo,
  type Suggestion,
} from "@/lib/search-client";
import { FELLESAREAL_KATEGORIER, rekkefølge } from "@/lib/categories";
import {
  PASSORD_SJEKKSUM,
  abonner,
  erAdmin,
  innloggetKort,
  innloggetNavn,
  loggUt,
} from "@/lib/kode";
import { hentNedlastinger, type Nedlasting } from "@/lib/nedlasting";
import AreaMap, {
  KATEGORI_FARGER,
  type Kvartal,
  type MapDot,
} from "@/components/area-map";
import { sendRapport, type RapportKontekst } from "@/lib/rapport";
import { loggNedlasting } from "@/lib/nedlasting";

/**
 * Ett sted i presentasjonen: ett bilde vises, resten av serien ligger bak.
 * Lilleborg har 101 bilder; som 34 oppslag på rad slutter man å se dem,
 * som ett sted med «· 101 bilder» i bildeteksten blir de en ressurs.
 */
type Sted = { navn: string; bilde: Photo; serie: Photo[] };

/** Kontoret som er logget inn, lest i nettleseren. */
function useKontor(): string | null {
  return useSyncExternalStore(abonner, innloggetNavn, () => null);
}

function useKontorKort(): string | null {
  return useSyncExternalStore(abonner, innloggetKort, () => null);
}

/** Er den innloggede admin? Usant på tjeneren, så siden ikke blinker. */
function useAdmin(): boolean {
  return useSyncExternalStore(abonner, erAdmin, () => false);
}

/** Ett magasinoppslag: én kategori, maks tre steder. */
type SpreadData = {
  category: Category;
  steder: Sted[];
  part: number;
  partCount: number;
  /** Første oppslag i resultatet: én bildeplass er byttet ut med områdeteksten. */
  intro: boolean;
};

const PHOTOS_PER_SPREAD = 3;

/**
 * Kategorier som hører til adressen selv, ikke til nabolaget rundt. De
 * settes først i filteret og får en egen markering, siden det er dem som
 * skiller denne adressen fra naboen.
 */
const FELLESAREAL = FELLESAREAL_KATEGORIER;

const RADIUS_OPTIONS = [
  { value: 300, label: "300 m" },
  { value: 500, label: "500 m" },
  { value: 750, label: "750 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
];

/** Grupperer på stedsnavn; det første bildet — det nærmeste — får vise stedet. */
function grupperSteder(photos: Photo[]): Sted[] {
  const steder = new Map<string, Sted>();
  for (const bilde of photos) {
    const key = bilde.placeName.trim().toLowerCase();
    const sted = steder.get(key);
    if (sted) sted.serie.push(bilde);
    else steder.set(key, { navn: bilde.placeName, bilde, serie: [bilde] });
  }
  return [...steder.values()];
}

function buildSpreads(groups: Group[]): SpreadData[] {
  const spreads: SpreadData[] = [];
  for (const group of groups) {
    const queue = grupperSteder(group.photos);
    const mine: SpreadData[] = [];
    while (queue.length) {
      const isFirstOverall = spreads.length + mine.length === 0;
      // Åpningsoppslaget: kartet tar hovedplassen, og høyre spalte deles
      // mellom ett bilde og områdeteksten.
      const take = isFirstOverall ? 1 : PHOTOS_PER_SPREAD;
      mine.push({
        category: group.category,
        steder: queue.splice(0, take),
        part: 0,
        partCount: 0,
        intro: isFirstOverall,
      });
    }
    mine.forEach((sp, i) => {
      sp.part = i + 1;
      sp.partCount = mine.length;
    });
    spreads.push(...mine);
  }
  return spreads;
}

/* -------------------------------------------------------- Områdetekst */

/**
 * Entallsformen står med artikkel, siden norsk skiller kjønn: det heter
 * «én kafé», men «ett kollektivpunkt».
 */
const KATEGORI_BOYNING: Record<string, [string, string]> = {
  kafe: ["én kafé", "kafeer"],
  restaurant: ["én restaurant", "restauranter"],
  park: ["én park", "parker"],
  natur: ["én naturperle", "naturperler"],
  kollektiv: ["ett kollektivpunkt", "kollektivpunkter"],
  skole: ["én skole", "skoler og barnehager"],
  kultur: ["ett kulturtilbud", "kulturtilbud"],
  aktivitet: ["ett idrettsanlegg", "idrettsanlegg"],
  butikk: ["én butikk", "butikker"],
  nabolag: ["ett nabolagsmotiv", "nabolagsmotiver"],
  fasade: ["én fasade", "fasader"],
  takterrasse: ["én takterrasse", "takterrasser"],
  bakgard: ["én bakgård", "bakgårder"],
};

/** Ser navnet ut som en ren gateadresse ("Kjølberggata 17B")? */
const erAdresse = (navn: string) => /\d+\s*[A-ZÆØÅ]?$/.test(navn.trim());

/** "Godt brød - Økologisk Bakeverksted" -> "Godt brød". */
const kortNavn = (navn: string) => navn.split(/\s+[–—-]\s+/)[0].trim();

/** Gangtid ved 80 m/min, formulert slik en megler ville sagt det. */
function gangtid(meter: number): string {
  const min = Math.max(1, Math.round(meter / 80));
  if (min <= 1) return "et knapt minutts gange";
  if (min <= 3) return "et par minutters gange";
  return `${min} minutters gange`;
}

/** Deterministisk variasjon: samme adresse gir samme tekst, naboadressen en annen. */
function frø(tekst: string): number {
  let h = 0;
  for (const c of tekst) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * Kjeder som gjerne ligger i nabolaget, men som ikke selger det. Bildene
 * deres vises fortsatt — de nevnes bare ikke ved navn i beliggenhetsteksten.
 */
const KJEDER =
  /mcdonald|burger king|\bkfc\b|subway|7-eleven|narvesen|deli de luca|pizzabakeren|domino/i;

/** De nærmeste navngitte stedene i en kategori, uten dubletter. */
function navngitte(groups: Group[], kategoriId: string, antall: number) {
  const gruppe = groups.find((g) => g.category.id === kategoriId);
  if (!gruppe) return [];
  const sett = new Set<string>();
  const ut: Array<{ navn: string; meter: number }> = [];
  for (const p of [...gruppe.photos].sort(
    (a, b) => a.distanceMeters - b.distanceMeters,
  )) {
    if (!p.placeName || erAdresse(p.placeName) || KJEDER.test(p.placeName))
      continue;
    const navn = kortNavn(p.placeName);
    const key = navn.toLowerCase();
    // «Håndbakt» og «Håndbakt Tøyen» er samme sted i denne sammenhengen.
    if ([...sett].some((k) => k.startsWith(key) || key.startsWith(k))) continue;
    sett.add(key);
    ut.push({ navn, meter: p.distanceMeters });
    if (ut.length === antall) break;
  }
  return ut;
}

/**
 * Beliggenhetstekst i prospekt-stil, generert fra det søket faktisk fant.
 * Skal kunne stå rett i en salgsoppgave: varm og konkret, men uten å påstå
 * noe bildene ikke dekker — ingen skoler, kollektivtilbud eller solforhold
 * vi ikke vet noe om.
 */
function composeAreaText(
  groups: Group[],
  address: string,
  radiusMeters: number,
): string {
  const all = groups.flatMap((g) => g.photos);
  if (all.length === 0) return "";

  const shortAddr = address.split(",")[0].trim();
  const gate = shortAddr.replace(/\s+\d+.*$/, "");
  const velg = frø(shortAddr);

  const kafeer = navngitte(groups, "kafe", 2);
  const restauranter = navngitte(groups, "restaurant", 2);
  const parker = navngitte(groups, "park", 1);

  const setninger: string[] = [];

  const apninger = [
    `Fra ${shortAddr} har du nabolaget for hånden — det meste ligger innen en kort spasertur.`,
    `Rundt ${shortAddr} ligger hverdagen tett på: gatene her rommer det meste du trenger i løpet av en uke.`,
    `${gate} ligger midt i et nabolag der det meste kan nås til fots.`,
  ];
  setninger.push(apninger[velg % apninger.length]);

  if (kafeer.length === 2) {
    setninger.push(
      `Morgenkaffen tar du hos ${kafeer[0].navn}, ${gangtid(kafeer[0].meter)} unna, eller hos ${kafeer[1].navn} litt lenger bort.`,
    );
  } else if (kafeer.length === 1) {
    setninger.push(
      `Morgenkaffen tar du hos ${kafeer[0].navn}, ${gangtid(kafeer[0].meter)} unna.`,
    );
  }

  if (restauranter.length === 2) {
    setninger.push(
      `Til middag frister ${restauranter[0].navn} og ${restauranter[1].navn} — og flere spisesteder ligger i gatene rundt.`,
    );
  } else if (restauranter.length === 1) {
    setninger.push(
      `Til middag frister ${restauranter[0].navn}, ${gangtid(restauranter[0].meter)} unna.`,
    );
  }

  if (parker.length === 1) {
    setninger.push(
      `${parker[0].navn} gir en grønn lunge ${gangtid(parker[0].meter)} fra døra — for trening, lek eller bare en benk i sola.`,
    );
  }

  const kollektiv = navngitte(groups, "kollektiv", 1);
  if (kollektiv.length === 1) {
    setninger.push(
      `${kollektiv[0].navn} ligger ${gangtid(kollektiv[0].meter)} unna, så morgenen inn til byen blir kort.`,
    );
  }

  const skoler = navngitte(groups, "skole", 1);
  if (skoler.length === 1) {
    setninger.push(
      `${skoler[0].navn} ligger ${gangtid(skoler[0].meter)} fra døra.`,
    );
  }

  const deler: string[] = [];
  for (const g of groups) {
    if (g.category.id === "annet") continue;
    // Steder, ikke bilder — ellers ble 101 bilder av Lilleborg «101 kollektivpunkter».
    const n = grupperSteder(g.photos).length;
    const [entall, flertall] = KATEGORI_BOYNING[g.category.id] ?? [
      `én ${g.category.label.toLowerCase()}`,
      g.category.label.toLowerCase(),
    ];
    deler.push(n === 1 ? entall : `${n} ${flertall}`);
  }
  if (deler.length > 1) {
    const liste = `${deler.slice(0, -1).join(", ")} og ${deler[deler.length - 1]}`;
    setninger.push(
      `Innenfor ${formatRadius(radiusMeters)} finner du til sammen ${liste}.`,
    );
  }

  const avslutninger = [
    `Alt i denne presentasjonen er fotografert på stedet — ${all.length} bilder av nabolaget slik det faktisk møter deg.`,
    `De ${all.length} bildene på disse sidene er tatt her, i dette nabolaget, slik det så ut den dagen fotografen gikk gatelangs.`,
  ];
  setninger.push(avslutninger[velg % avslutninger.length]);

  return setninger.join(" ");
}

const pageLabel = (n: number) => String(n).padStart(2, "0");
const formatRadius = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
/** Miniatyrstien er allerede gjort klar med basePath av søkemodulen. */
const thumbnailUrl = (photo: Photo) => photo.thumb ?? "";

export default function Portal({
  photoCount,
  updatedAt,
}: {
  photoCount: number;
  updatedAt: string | null;
}) {
  const [address, setAddress] = useState("");
  const [radius, setRadius] = useState(750);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[] | null>(null);
  // Kategorier som er skrudd av. Tom mengde betyr at alt vises.
  const [skjulte, setSkjulte] = useState<Set<string>>(new Set());
  const [areaText, setAreaText] = useState("");
  const [mapDots, setMapDots] = useState<MapDot[]>([]);
  const [mapLegend, setMapLegend] = useState<
    Array<{ id: string; label: string }>
  >([]);
  const [searched, setSearched] = useState<{
    address: string;
    radius: number;
    center: { lat: number; lng: number };
  } | null>(null);
  // Forsiden, eller hele presentasjonen. Oppslagene står under hverandre.
  const [forside, setForside] = useState(true);
  const [åpentSted, setÅpentSted] = useState<Sted | null>(null);
  // Betaverktøy: skjemaet for å melde fra om noe som er galt.
  const [melding, setMelding] = useState<RapportKontekst | null>(null);
  // Nedlastingsloggen, bare for admin.
  const [visAdmin, setVisAdmin] = useState(false);
  const [bygg, setBygg] = useState<Kvartal[]>([]);

  // Koordinater fra et valgt adresseforslag, så vi slipper å geokode på nytt.
  const chosenCoords = useRef<Suggestion | null>(null);

  // Oppslagene avledes av gruppene og filteret, så et filterklikk bygger
  // sidene på nytt uten et nytt søk.
  const spreads = useMemo(() => {
    if (!groups) return null;
    const synlige = groups.filter((g) => !skjulte.has(g.category.id));
    const sortert = [...synlige].sort(
      (a, b) => rekkefølge(a.category.id) - rekkefølge(b.category.id),
    );
    return buildSpreads(sortert);
  }, [groups, skjulte]);

  // Kartet viser det samme som sidene — skrus en kategori av, forsvinner
  // også prikkene dens.
  const synligeDots = useMemo(
    () => mapDots.filter((d) => !skjulte.has(d.category)),
    [mapDots, skjulte],
  );

  /** Skrur én kategori av eller på. */
  function vekslKategori(id: string) {
    setSkjulte((nå) => {
      const neste = new Set(nå);
      if (neste.has(id)) neste.delete(id);
      else neste.add(id);
      return neste;
    });
  }

  function visAlle() {
    setSkjulte(new Set());
  }

  const runSearch = useCallback(
    async (query: string, radiusMeters: number, coords: Suggestion | null) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);
      setWarning(null);

      try {
        const data = await search(trimmed, radiusMeters, coords);
        setGroups(data.groups);
        setSkjulte(new Set());
        setAreaText(composeAreaText(data.groups, trimmed, radiusMeters));
        setMapDots(
          data.groups.flatMap((g) =>
            g.photos.map((ph) => ({
              id: ph.id,
              lat: ph.lat,
              lng: ph.lng,
              category: g.category.id,
              placeName: ph.placeName,
              distanceMeters: ph.distanceMeters,
              thumb: ph.thumb,
              original: ph.original,
              filnavn: ph.filnavn,
            })),
          ),
        );
        // Fellesarealene står først: de er knyttet til nettopp denne
        // adressen, mens resten av nabolaget deles med alle rundt.
        setMapLegend(
          [...data.groups]
            .sort(
              (a, b) => rekkefølge(a.category.id) - rekkefølge(b.category.id),
            )
            .map((g) => ({ id: g.category.id, label: g.category.label })),
        );
        // Eiendommene i utsnittet, ikke bare den man søkte på: kartet viser
        // hvilke gårder arkivet faktisk dekker i nabolaget.
        const alle = await loadBygg();
        const nær = (k: Kvartal) =>
          k.teiger.some((t) =>
            t.r.some(([lat, lng]) => {
              const dx =
                (lng - data.center.lng) *
                111320 *
                Math.cos((lat * Math.PI) / 180);
              const dy = (lat - data.center.lat) * 111320;
              return Math.hypot(dx, dy) <= radiusMeters + 150;
            }),
          );
        setBygg(alle ? Object.values(alle).filter(nær) : []);
        setWarning(data.warning ?? null);
        setSearched({
          address: trimmed,
          radius: radiusMeters,
          center: data.center,
        });
        setForside(data.groups.length === 0);
        // Et nytt søk er en ny presentasjon; den begynner på første oppslag.
        window.scrollTo({ top: 0 });
      } catch (err) {
        setError(
          err instanceof SearchError
            ? err.message
            : "Noe gikk galt under søket",
        );
        setGroups(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runSearch(address, radius, chosenCoords.current);
  }

  /** Nytt søk på samme adresse med annen radius. */
  function endreRadius(meter: number) {
    setRadius(meter);
    if (!searched) return;
    const senter = searched.center;
    runSearch(searched.address, meter, { label: searched.address, ...senter });
  }

  /**
   * Markøren er sluppet et nytt sted på kartet. Nærmeste offisielle
   * adresse blir det nye søket, så oppslagene og teksten følger med —
   * ikke bare sirkelen.
   */
  const flyttSøk = useCallback(
    async (lat: number, lng: number) => {
      setLoading(true);
      const treff = await adresseVedPunkt(lat, lng);
      setLoading(false);
      if (!treff) {
        setError("Fant ingen adresse der markøren ble sluppet");
        return;
      }
      setAddress(treff.label);
      chosenCoords.current = treff;
      runSearch(treff.label, radius, treff);
    },
    [radius, runSearch],
  );

  function handlePickSuggestion(s: Suggestion) {
    chosenCoords.current = s;
    setAddress(s.label);
    runSearch(s.label, radius, s);
  }

  const visOppslag = !forside && spreads !== null && spreads.length > 0;

  if (visAdmin) {
    return (
      <div className="relative min-h-screen w-full">
        <div className="pointer-events-none fixed inset-4 z-20 border border-rule sm:inset-6" />
        <Nedlastingslogg onLukk={() => setVisAdmin(false)} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full">
      {/* Hårfin ramme, som kanten på et trykt oppslag. */}
      <div className="pointer-events-none fixed inset-4 z-20 border border-rule sm:inset-6" />

      {visOppslag && spreads ? (
        spreads.map((sp, i) => (
          <Spread
            key={`${sp.category.id}-${sp.part}-${i}`}
            spread={sp}
            nummer={i + 1}
            antall={spreads.length}
            address={searched?.address ?? ""}
            radius={searched?.radius ?? radius}
            center={searched?.center ?? null}
            mapDots={synligeDots}
            bygg={bygg}
            mapLegend={mapLegend}
            skjulte={skjulte}
            onVekslKategori={vekslKategori}
            onVisAlle={visAlle}
            onEndreRadius={endreRadius}
            laster={loading}
            areaText={areaText}
            onForside={() => setForside(true)}
            onÅpne={setÅpentSted}
            onMeld={setMelding}
            onFlyttSøk={flyttSøk}
          />
        ))
      ) : (
        <Cover
          address={address}
          onAddressChange={(v) => {
            chosenCoords.current = null;
            setAddress(v);
          }}
          onPickSuggestion={handlePickSuggestion}
          radius={radius}
          setRadius={setRadius}
          loading={loading}
          error={error}
          warning={warning}
          onSubmit={handleSubmit}
          photoCount={photoCount}
          updatedAt={updatedAt}
          emptyResult={
            spreads !== null && spreads.length === 0 && searched !== null
          }
          searched={searched}
          resultPageCount={spreads?.length ?? 0}
          onResume={() => setForside(false)}
          onAdmin={() => setVisAdmin(true)}
        />
      )}

      {åpentSted && (
        <SeriesView
          sted={åpentSted}
          adresse={searched?.address ?? ""}
          onMeld={setMelding}
          onClose={() => setÅpentSted(null)}
        />
      )}

      {melding && (
        <Feilmelding kontekst={melding} onClose={() => setMelding(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------- Adressesøkefelt */

function AddressField({
  address,
  onAddressChange,
  onPickSuggestion,
  loading,
}: {
  address: string;
  onAddressChange: (v: string) => void;
  onPickSuggestion: (s: Suggestion) => void;
  loading: boolean;
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Siste forespørsel vinner, slik at treg respons ikke overskriver ferske treff.
  const requestId = useRef(0);
  const justPicked = useRef(false);

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false;
      return;
    }

    const query = address.trim();
    const id = ++requestId.current;

    const timer = setTimeout(async () => {
      if (query.length < 3) {
        if (id === requestId.current) {
          setSuggestions([]);
          setOpen(false);
        }
        return;
      }

      try {
        // Et forslag som er identisk med det som alt står i feltet tilfører
        // ingenting — da ville lista bare blitt stående og skygge for resten.
        const found = (await suggest(query)).filter(
          (s) => s.label.toLowerCase() !== query.toLowerCase(),
        );
        if (id !== requestId.current) return;
        setSuggestions(found);
        setOpen(found.length > 0);
        setActive(-1);
      } catch {
        if (id === requestId.current) setSuggestions([]);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [address]);

  function pick(s: Suggestion) {
    justPicked.current = true;
    setOpen(false);
    setSuggestions([]);
    setActive(-1);
    onPickSuggestion(s);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-4 border-b border-ink pb-3">
        <input
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Adresse eller sted"
          aria-label="Adresse eller sted"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="adresseforslag"
          className="cover-input min-w-0 flex-1 bg-transparent font-light tracking-tight placeholder:text-ink-soft/70 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading}
          aria-label="Søk"
          className="shrink-0 text-xl leading-none transition-transform hover:translate-x-1 disabled:opacity-40"
        >
          {loading ? "…" : "→"}
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul
          id="adresseforslag"
          role="listbox"
          className="max-h-56 overflow-y-auto border-x border-b border-rule bg-paper"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.label}-${s.lat}-${s.lng}`}
              role="option"
              aria-selected={i === active}
            >
              <button
                type="button"
                // onMouseDown, ellers rekker onBlur å lukke lista først.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`block w-full px-4 py-2.5 text-left text-[13px] leading-snug transition-colors ${
                  i === active ? "bg-paper-deep text-ink" : "text-ink-soft"
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Forside */

function Cover({
  address,
  onAddressChange,
  onPickSuggestion,
  radius,
  setRadius,
  loading,
  error,
  warning,
  onSubmit,
  photoCount,
  updatedAt,
  emptyResult,
  searched,
  resultPageCount,
  onResume,
  onAdmin,
}: {
  address: string;
  onAddressChange: (v: string) => void;
  onPickSuggestion: (s: Suggestion) => void;
  radius: number;
  setRadius: (v: number) => void;
  loading: boolean;
  error: string | null;
  warning: string | null;
  onSubmit: (e: FormEvent) => void;
  photoCount: number;
  updatedAt: string | null;
  emptyResult: boolean;
  searched: { address: string; radius: number } | null;
  resultPageCount: number;
  onResume: () => void;
  onAdmin: () => void;
}) {
  return (
    <section className="oppslag relative flex min-h-screen flex-col px-10 py-12 sm:px-16 sm:py-14">
      <header className="relative z-10 flex shrink-0 items-start justify-between gap-4 text-[10px] uppercase tracking-[0.28em] text-ink-soft">
        <span>Områdebilder</span>
        <Kontorlinje onAdmin={onAdmin} />
      </header>

      <div className="relative z-10 flex flex-1 items-center py-10">
        {/* Skalaen på forsiden er definert samlet i globals.css. */}
        <div className="cover-block">
          <p className="mb-5 text-[10px] uppercase tracking-[0.32em] text-ink-soft">
            Nabolagsfotografi
          </p>

          <h1 className="cover-title">Områdebilder</h1>

          <p className="cover-lede mt-7 text-ink-soft">
            Et fotografisk arkiv over nabolag, bygget opp bilde for bilde på
            stedet. Skriv inn en adresse, så finner portalen kafeene,
            restaurantene, parkene, fasadene, takterrassene og bakgårdene som
            faktisk ligger innen gangavstand.
          </p>

          {/* Delikat søkefelt: én hårfin linje og en pil. */}
          <form onSubmit={onSubmit} className="cover-form">
            <AddressField
              address={address}
              onAddressChange={onAddressChange}
              onPickSuggestion={onPickSuggestion}
              loading={loading}
            />

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2">
              <span className="text-[10px] uppercase tracking-[0.28em] text-ink-soft">
                Radius
              </span>
              {RADIUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRadius(opt.value)}
                  className={`text-[11px] uppercase tracking-[0.18em] transition-colors ${
                    radius === opt.value
                      ? "text-ink underline underline-offset-[6px]"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </form>

          <div aria-live="polite" className="mt-7 space-y-2 text-[13px]">
            {error && <p className="text-ink">{error}</p>}
            {warning && <p className="text-ink-soft">{warning}</p>}
            {emptyResult && !warning && !error && searched && (
              <p className="text-ink-soft">
                Ingen bilder er registrert innen {formatRadius(searched.radius)}{" "}
                fra «{searched.address}».
              </p>
            )}
            {resultPageCount > 0 && searched && (
              <button
                type="button"
                onClick={onResume}
                className="text-[11px] uppercase tracking-[0.18em] text-ink underline underline-offset-[6px] transition-opacity hover:opacity-60"
              >
                Se {resultPageCount} {resultPageCount === 1 ? "side" : "sider"}{" "}
                for «{searched.address}» →
              </button>
            )}
          </div>
        </div>
      </div>

      <footer className="relative z-10 grid shrink-0 grid-cols-2 gap-6 border-t border-rule pt-5 text-[10px] uppercase tracking-[0.2em] sm:grid-cols-4">
        <MetaCell label="Arkiv" value="Områdebilder" />
        <MetaCell
          label="Bilder i samlingen"
          value={photoCount > 0 ? String(photoCount) : "—"}
        />
        <MetaCell
          label="Sist oppdatert"
          value={
            updatedAt ? new Date(updatedAt).toLocaleDateString("no-NO") : "—"
          }
        />
        <MetaCell label="Side" value="01" align="right" />
      </footer>
    </section>
  );
}

/** Kontoret som er logget inn, med utlogging. Står der «Fotografisk arkiv» sto. */
function Kontorlinje({ onAdmin }: { onAdmin?: () => void }) {
  const kontor = useKontor();
  const kort = useKontorKort();
  const admin = useAdmin();
  if (!kontor) return <span>Fotografisk arkiv</span>;
  return (
    <span className="flex shrink-0 items-baseline gap-4 whitespace-nowrap">
      {admin && onAdmin && (
        <button type="button" onClick={onAdmin} className="download-link">
          Nedlastinger
        </button>
      )}
      {/* Fullt navn når det er plass, ellers brukernavnet: «PrivatMegleren
          Premium» med sperret versalsats er bredere enn en telefon. */}
      <span className="text-ink sm:hidden">{kort}</span>
      <span className="hidden text-ink sm:inline">{kontor}</span>
      <button type="button" onClick={loggUt} className="download-link">
        Logg ut
      </button>
    </span>
  );
}

function MetaCell({
  label,
  value,
  align = "left",
}: {
  label: string;
  value: string;
  align?: "left" | "right";
}) {
  return (
    <div className={align === "right" ? "sm:text-right" : undefined}>
      <p className="text-ink-soft">{label}</p>
      <p className="mt-1 text-ink">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------- Oppslagene */

/**
 * Sier fra når oppslaget er rullet inn i bildet, én gang.
 *
 * Elementene i oppslaget ligger 50 px under sin plass til det skjer, og
 * glir opp i tur og orden. Observatøren kobles fra etter første treff:
 * et oppslag man ruller tilbake til, skal stå ferdig — ikke spille om
 * igjen hver gang det passerer.
 */
function useInngang<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inne, setInne] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Uten observatør viser vi alt med én gang; et usynlig oppslag er
    // verre enn et uanimert.
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setInne(true));
      return () => cancelAnimationFrame(id);
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        // Vent én frame, ellers rekker ikke nettleseren å se
        // utgangsposisjonen og hopper rett til den ferdige.
        requestAnimationFrame(() => setInne(true));
        io.disconnect();
      },
      // Oppslaget skal være godt inne i bildet før det starter.
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return [ref, inne] as const;
}

function Spread({
  spread,
  nummer,
  antall,
  address,
  radius,
  center,
  mapDots,
  bygg,
  mapLegend,
  skjulte,
  onVekslKategori,
  onVisAlle,
  onEndreRadius,
  laster,
  areaText,
  onForside,
  onÅpne,
  onMeld,
  onFlyttSøk,
}: {
  spread: SpreadData;
  nummer: number;
  antall: number;
  address: string;
  radius: number;
  center: { lat: number; lng: number } | null;
  mapDots: MapDot[];
  bygg: Kvartal[];
  mapLegend: Array<{ id: string; label: string }>;
  skjulte: Set<string>;
  onVekslKategori: (id: string) => void;
  onVisAlle: () => void;
  onEndreRadius: (meter: number) => void;
  laster: boolean;
  areaText: string;
  onForside: () => void;
  onÅpne: (sted: Sted) => void;
  onMeld: (kontekst: RapportKontekst) => void;
  onFlyttSøk: (lat: number, lng: number) => void;
}) {
  const [oppslagsRef, inne] = useInngang<HTMLElement>();
  const [hero, ...rest] = spread.steder;
  // På første oppslag står kartet i hovedplassen; alle fotoene går til høyre.
  const heroIsMap = spread.intro;
  const rightSteder = heroIsMap ? spread.steder : rest;
  const soloHero = !heroIsMap && rest.length === 0;

  return (
    <section
      ref={oppslagsRef}
      data-inne={inne ? "ja" : undefined}
      className="oppslag flex min-h-screen flex-col px-10 py-12 sm:px-16 sm:py-14"
    >
      <header className="flex shrink-0 items-baseline justify-between text-[10px] uppercase tracking-[0.28em] text-ink-soft">
        {nummer === 1 ? (
          <button
            type="button"
            onClick={onForside}
            title="Til forsiden"
            className="home-link"
          >
            Områdebilder
          </button>
        ) : (
          <span>Områdebilder</span>
        )}
        <span className="shrink-0 text-ink">{spread.category.label}</span>
      </header>

      <div className="grid flex-auto grid-cols-1 gap-10 py-8 lg:grid-cols-12 lg:gap-12">
        {/* Venstre: kartet (første oppslag) eller hovedbildet, med tekst under. */}
        <div
          className={`flex flex-col ${soloHero ? "lg:col-span-9" : "lg:col-span-7"}`}
        >
          {heroIsMap ? (
            // Uten senter er det ikke noe kart å tegne; da står åpningen
            // med områdeteksten alene framfor å krasje på et bilde som
            // ikke finnes.
            center && (
              <figure data-inngang="1" className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-[220px] flex-1 overflow-hidden border border-rule">
                  <AreaMap
                    center={center}
                    radiusMeters={radius}
                    dots={mapDots}
                    bygg={bygg}
                    onFlytt={onFlyttSøk}
                  />
                </div>
                <figcaption className="mt-2 shrink-0 text-[10px] uppercase tracking-[0.18em] text-ink-soft">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate">
                      {address.split(",")[0]}
                    </span>
                    <span className="shrink-0">
                      {formatRadius(radius)} gangavstand
                    </span>
                  </div>
                  {/* Filteret får egen linje: med ni kategorier flyter det ellers
                    ut av kolonnen og legger seg over områdeteksten. */}
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {mapLegend.map((item) => {
                      const av = skjulte.has(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={!av}
                          onClick={() => onVekslKategori(item.id)}
                          title={
                            FELLESAREAL.has(item.id)
                              ? `Hører til denne adressen — ${av ? "vis" : "skjul"}`
                              : av
                                ? `Vis ${item.label.toLowerCase()}`
                                : `Skjul ${item.label.toLowerCase()}`
                          }
                          className={`flex items-center gap-1.5 whitespace-nowrap uppercase tracking-[0.18em] transition-opacity hover:text-ink ${
                            av ? "opacity-35 line-through" : ""
                          }`}
                        >
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{
                              background: av
                                ? "transparent"
                                : (KATEGORI_FARGER[item.id] ??
                                  KATEGORI_FARGER.annet),
                              boxShadow: av
                                ? `inset 0 0 0 1px ${KATEGORI_FARGER[item.id] ?? KATEGORI_FARGER.annet}`
                                : undefined,
                            }}
                          />
                          {item.label}
                          {FELLESAREAL.has(item.id) && (
                            <span aria-hidden>&#9642;</span>
                          )}
                        </button>
                      );
                    })}
                    {skjulte.size > 0 && (
                      <button
                        type="button"
                        onClick={onVisAlle}
                        className="whitespace-nowrap uppercase tracking-[0.18em] text-ink underline underline-offset-4"
                      >
                        Vis alle
                      </button>
                    )}
                  </div>
                </figcaption>
              </figure>
            )
          ) : (
            <Frame
              sted={hero}
              onÅpne={onÅpne}
              inngang={1}
              className="strekk min-h-[220px]"
            />
          )}

          {heroIsMap ? (
            // Kartet tegner allerede radius-sirkelen, så kontrollen hører
            // hjemme her framfor kategoriteksten.
            <div
              data-inngang="3"
              className="mt-6 grid shrink-0 grid-cols-1 gap-5 sm:grid-cols-12"
            >
              <h2 className="text-xl font-semibold uppercase leading-[0.95] tracking-tight sm:col-span-4">
                Gangavstand
              </h2>
              <div className="sm:col-span-8">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {RADIUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={laster}
                      onClick={() => onEndreRadius(opt.value)}
                      className={`text-[11px] uppercase tracking-[0.18em] transition-colors disabled:opacity-40 ${
                        radius === opt.value
                          ? "text-ink underline underline-offset-[6px]"
                          : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                  {laster && (
                    <span className="text-[10px] uppercase tracking-[0.2em] text-ink-soft">
                      Søker …
                    </span>
                  )}
                </div>
                <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                  Juster hvor stort område presentasjonen dekker. Sirkelen på
                  kartet viser utsnittet.
                </p>
              </div>
            </div>
          ) : (
            <div
              data-inngang="3"
              className="mt-6 grid shrink-0 grid-cols-1 gap-5 sm:grid-cols-12"
            >
              <h2 className="text-xl font-semibold uppercase leading-[0.95] tracking-tight sm:col-span-4">
                {spread.category.label}
              </h2>
              <p className="text-[13px] leading-relaxed text-ink-soft sm:col-span-8">
                {spread.category.description}
              </p>
            </div>
          )}
        </div>

        {/* Høyre: rotert etikett og de mindre bildene stablet. */}
        <div
          className={`flex gap-5 ${soloHero ? "lg:col-span-3" : "lg:col-span-5"}`}
        >
          <span className="vertical-rl hidden shrink-0 rotate-180 self-start text-[10px] uppercase tracking-[0.3em] text-ink-soft lg:block">
            {spread.partCount > 1
              ? `Del ${spread.part} av ${spread.partCount}`
              : `${spread.steder.length} ${spread.steder.length === 1 ? "sted" : "steder"}`}
          </span>

          <div className="flex min-w-0 flex-auto flex-col gap-5">
            {rightSteder.map((sted, i) => (
              <Frame
                key={sted.bilde.id}
                sted={sted}
                onÅpne={onÅpne}
                inngang={Math.min(2 + i, 4)}
                className="strekk min-h-[150px]"
              />
            ))}
            {/* På første oppslag står områdeteksten der det tredje bildet
                ellers ville stått — en kort tekst om det søket faktisk fant. */}
            {spread.intro && areaText && (
              <div data-inngang="4" className="order-first flex shrink-0 flex-col lg:order-none">
                <p className="mb-3 border-t border-rule pt-4 text-[10px] uppercase tracking-[0.3em] text-ink-soft">
                  Området
                </p>
                <p className="text-[13px] leading-relaxed text-ink-soft">
                  {areaText}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-rule pt-5 text-[10px] uppercase tracking-[0.2em] text-ink-soft">
        <span className="text-[13px] tracking-[0.18em] text-ink tabular-nums">
          {pageLabel(nummer)} / {pageLabel(antall)}
        </span>
        <span className="hidden min-w-0 truncate px-4 sm:block">{address}</span>
        <span className="flex shrink-0 items-baseline gap-5">
          {/* Betaverktøy — ut før lansering. */}
          <button
            type="button"
            onClick={() => onMeld({ adresse: address, kategori: spread.category.label })}
            className="download-link"
          >
            Meld feil
          </button>
          {nummer === antall ? (
            <button type="button" onClick={onForside} className="download-link">
              Nytt søk
            </button>
          ) : (
            <span>{spread.category.label}</span>
          )}
        </span>
      </footer>
    </section>
  );
}

function Frame({
  sted,
  onÅpne,
  className,
  inngang,
}: {
  sted: Sted;
  onÅpne: (sted: Sted) => void;
  className?: string;
  /** Plassen i inngangen, 1–4. Styrer bare forsinkelsen. */
  inngang?: number;
}) {
  const photo = sted.bilde;
  const antall = sted.serie.length;
  return (
    <figure
      data-inngang={inngang}
      className={`flex min-h-0 flex-col ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => onÅpne(sted)}
        title={antall > 1 ? `Se alle ${antall} bildene` : "Se bildet ubeskåret"}
        className="strekk strekk-bilde block aspect-[4/3] min-h-0 w-full cursor-zoom-in overflow-hidden bg-paper-deep"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailUrl(photo)}
          alt={photo.placeName}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </button>
      <figcaption className="mt-2 flex shrink-0 items-baseline justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-ink-soft">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate">{sted.navn}</span>
          {antall > 1 && (
            <span className="shrink-0 text-ink">· {antall} bilder</span>
          )}
        </span>
        <span className="flex shrink-0 items-baseline gap-3">
          <span>{photo.distanceMeters} m</span>
          {photo.original && (
            <DownloadLink url={photo.original} filnavn={photo.filnavn} photo={photo} />
          )}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Serien, åpnet oppå oppslaget: bildet ubeskåret med papir rundt, piler og
 * teller som i kartpopupen, og nedlasting av akkurat det bildet som vises.
 * Esc og klikk utenfor lukker.
 */
function SeriesView({
  sted,
  adresse,
  onMeld,
  onClose,
}: {
  sted: Sted;
  adresse: string;
  onMeld: (kontekst: RapportKontekst) => void;
  onClose: () => void;
}) {
  const [i, setI] = useState(() => Math.max(0, sted.serie.indexOf(sted.bilde)));
  const n = sted.serie.length;
  const photo = sted.serie[i];
  const forrige = () => setI((x) => (x - 1 + n) % n);
  const neste = () => setI((x) => (x + 1) % n);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (n > 1 && e.key === "ArrowLeft") setI((x) => (x - 1 + n) % n);
      if (n > 1 && e.key === "ArrowRight") setI((x) => (x + 1) % n);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, onClose]);

  return (
    <div
      className="serie-veil"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={sted.navn}
    >
      <div className="serie-card" onClick={(e) => e.stopPropagation()}>
        <header className="flex shrink-0 items-baseline justify-between gap-4 text-[10px] uppercase tracking-[0.28em] text-ink-soft">
          <span className="min-w-0 truncate text-ink">{photo.placeName}</span>
          <span className="flex shrink-0 items-baseline gap-5">
            <span>{photo.distanceMeters} m</span>
            <button
              type="button"
              onClick={onClose}
              className="download-link"
              aria-label="Lukk"
            >
              Lukk
            </button>
          </span>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={photo.id}
            src={thumbnailUrl(photo)}
            alt={photo.placeName}
            className="max-h-full max-w-full object-contain"
          />
        </div>

        <footer className="flex shrink-0 items-baseline justify-between gap-4 border-t border-rule pt-4 text-[10px] uppercase tracking-[0.2em] text-ink-soft">
          {n > 1 ? (
            <span className="flex items-baseline gap-4">
              <button
                type="button"
                onClick={forrige}
                aria-label="Forrige bilde"
                className="text-base leading-none text-ink transition-transform hover:-translate-x-1"
              >
                ←
              </button>
              <span className="text-ink">
                {i + 1} / {n}
              </span>
              <button
                type="button"
                onClick={neste}
                aria-label="Neste bilde"
                className="text-base leading-none text-ink transition-transform hover:translate-x-1"
              >
                →
              </button>
            </span>
          ) : (
            <span>1 bilde</span>
          )}
          <span className="flex items-baseline gap-5">
            {/* Betaverktøy — ut før lansering. Her vet vi nøyaktig hvilket
                bilde det gjelder, så meldingen tar med seg bildet. */}
            <button
              type="button"
              onClick={() =>
                onMeld({
                  adresse,
                  sted: sted.navn,
                  bildeId: photo.id,
                  filnavn: photo.filnavn,
                })
              }
              className="download-link"
            >
              Meld feil
            </button>
            {photo.original && (
              <DownloadLink url={photo.original} filnavn={photo.filnavn} photo={photo} />
            )}
            <span className="hidden sm:inline">Esc lukker</span>
          </span>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- Nedlastingsloggen */

/**
 * Hvem som har lastet ned hva.
 *
 * Originalfilene hentes rett fra Dropbox eller Immich, så loggen føres av
 * nettleseren idet nedlastingen starter. Den fanger knappetrykk, ikke
 * høyreklikk — men meglerne trykker, og det er dem vi vil vite om.
 *
 * Siden er bare synlig for admin, og loggen ligger bak admin-passordets
 * sjekksum hos mellomtjeneren. Å skrive om id-en i nettleseren gir ingen
 * tilgang.
 */
function Nedlastingslogg({ onLukk }: { onLukk: () => void }) {
  const [rader, setRader] = useState<Nedlasting[] | null>(null);
  /** Tidspunktet loggen ble hentet, så «siste sju dager» står stille. */
  const [hentet, setHentet] = useState(0);
  const [feil, setFeil] = useState<string | null>(null);
  const [kontor, setKontor] = useState<string | null>(null);
  const [søk, setSøk] = useState("");

  useEffect(() => {
    let avbrutt = false;
    hentNedlastinger()
      .then((r) => {
        if (avbrutt) return;
        setRader(r);
        setHentet(Date.now());
      })
      .catch((e) => {
        if (!avbrutt) setFeil(e instanceof Error ? e.message : "Noe gikk galt");
      });
    return () => {
      avbrutt = true;
    };
  }, []);

  const kontorer = useMemo(() => {
    const tell = new Map<string, number>();
    for (const r of rader ?? []) {
      const k = r.kontor ?? "Ukjent";
      tell.set(k, (tell.get(k) ?? 0) + 1);
    }
    return [...tell.entries()].sort((a, b) => b[1] - a[1]);
  }, [rader]);

  const synlige = useMemo(() => {
    const q = søk.trim().toLowerCase();
    return (rader ?? []).filter((r) => {
      if (kontor && (r.kontor ?? "Ukjent") !== kontor) return false;
      if (!q) return true;
      return [r.sted, r.filnavn, r.adresse, r.kategori].some((f) =>
        (f ?? "").toLowerCase().includes(q)
      );
    });
  }, [rader, kontor, søk]);

  const sisteUke = useMemo(() => {
    if (!hentet) return 0;
    const grense = hentet - 7 * 24 * 3600 * 1000;
    return (rader ?? []).filter((r) => Date.parse(r.tid) >= grense).length;
  }, [rader, hentet]);

  const unikeBilder = useMemo(
    () => new Set((rader ?? []).map((r) => r.bildeId).filter(Boolean)).size,
    [rader]
  );

  const tid = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString("no-NO")} ${d.toLocaleTimeString("no-NO", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };

  return (
    <section className="flex min-h-screen flex-col px-10 py-12 sm:px-16 sm:py-14">
      <header className="flex items-baseline justify-between gap-4 text-[10px] uppercase tracking-[0.28em] text-ink-soft">
        <button type="button" onClick={onLukk} className="home-link">
          Områdebilder
        </button>
        <span className="shrink-0 text-ink">Nedlastinger</span>
      </header>

      <h1 className="mt-10 text-2xl font-semibold uppercase leading-[0.95] tracking-tight sm:text-3xl">
        Hvem laster ned hva
      </h1>

      {feil && (
        <p className="mt-6 text-[15px] text-ink">
          Fikk ikke hentet loggen: {feil}. Er admin-passordet satt med{" "}
          <span className="font-mono text-[13px]">npm run admin-passord</span>?
        </p>
      )}

      {!rader && !feil && (
        <p className="mt-6 text-[15px] text-ink-soft">Henter loggen …</p>
      )}

      {rader && (
        <>
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-5 border-y border-rule py-5">
            <MetaCell label="Nedlastinger" value={String(rader.length)} />
            <MetaCell label="Siste sju dager" value={String(sisteUke)} />
            <MetaCell label="Ulike bilder" value={String(unikeBilder)} />
            <MetaCell label="Kontorer" value={String(kontorer.length)} />
          </dl>

          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              onClick={() => setKontor(null)}
              className={`text-[11px] uppercase tracking-[0.18em] transition-colors ${
                kontor === null ? "text-ink underline underline-offset-[6px]" : "text-ink-soft hover:text-ink"
              }`}
            >
              Alle
            </button>
            {kontorer.map(([navn, n]) => (
              <button
                key={navn}
                type="button"
                onClick={() => setKontor(navn)}
                className={`text-[11px] uppercase tracking-[0.18em] transition-colors ${
                  kontor === navn
                    ? "text-ink underline underline-offset-[6px]"
                    : "text-ink-soft hover:text-ink"
                }`}
              >
                {navn} ({n})
              </button>
            ))}
            <input
              type="search"
              value={søk}
              onChange={(e) => setSøk(e.target.value)}
              placeholder="Søk i sted, fil eller adresse"
              className="logg-sok"
              aria-label="Søk i loggen"
            />
          </div>

          {synlige.length === 0 ? (
            <p className="mt-10 text-[15px] text-ink-soft">
              {rader.length === 0
                ? "Ingen nedlastinger ennå. Loggen fylles idet noen trykker «Last ned»."
                : "Ingen treff."}
            </p>
          ) : (
            <div className="logg-tabell mt-8">
              <table>
                <thead>
                  <tr>
                    <th>Tid</th>
                    <th>Kontor</th>
                    <th>Sted</th>
                    <th>Fil</th>
                  </tr>
                </thead>
                <tbody>
                  {synlige.slice(0, 500).map((r, i) => (
                    <tr key={`${r.tid}-${i}`}>
                      <td className="logg-tid">{tid(r.tid)}</td>
                      <td>{r.kontor ?? "—"}</td>
                      <td>{r.sted ?? "—"}</td>
                      <td className="logg-fil">{r.filnavn ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {synlige.length > 500 && (
                <p className="mt-4 text-[13px] text-ink-soft">
                  Viser de 500 nyeste av {synlige.length}. Søk for å snevre inn.
                </p>
              )}
            </div>
          )}
        </>
      )}

      <footer className="mt-auto flex items-baseline justify-between gap-4 border-t border-rule pt-5 text-[10px] uppercase tracking-[0.2em] text-ink-soft">
        <span className="text-ink">Fotostallen</span>
        <button type="button" onClick={onLukk} className="download-link">
          Til forsiden
        </button>
      </footer>
    </section>
  );
}

/**
 * Skjemaet for å melde fra om noe som er galt.
 *
 * Under beta er det meglerne som ser feilene først — et sted som heter noe
 * annet enn det gjør i virkeligheten, et bakgårdsbilde som har havnet på
 * feil adresse. Meldingen går rett til mellomtjeneren sammen med det
 * portalen vet om hva de så på, og leses med `npm run rapporter`.
 *
 * Hele denne funksjonen skal ut før lansering.
 */
function Feilmelding({
  kontekst,
  onClose,
}: {
  kontekst: RapportKontekst;
  onClose: () => void;
}) {
  const kontor = useKontorKort();
  const [tekst, setTekst] = useState("");
  const [tilstand, setTilstand] = useState<
    "skriver" | "sender" | "sendt" | "feilet"
  >("skriver");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Kvitteringen står litt, så man rekker å se at den kom fram.
  useEffect(() => {
    if (tilstand !== "sendt") return;
    const id = setTimeout(onClose, 1600);
    return () => clearTimeout(id);
  }, [tilstand, onClose]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!tekst.trim()) return;
    setTilstand("sender");
    try {
      await sendRapport(kontekst, tekst.trim(), kontor);
      setTilstand("sendt");
    } catch {
      setTilstand("feilet");
    }
  }

  const om = [kontekst.sted, kontekst.kategori, kontekst.adresse]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="serie-veil"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="Meld feil"
    >
      <div className="melding-kort" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-baseline justify-between gap-4 text-[10px] uppercase tracking-[0.28em] text-ink-soft">
          <span className="text-ink">Meld feil</span>
          <button type="button" onClick={onClose} className="download-link">
            Lukk
          </button>
        </header>

        {om && (
          <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">{om}</p>
        )}

        {tilstand === "sendt" ? (
          <p className="mt-6 text-[15px] text-ink">
            Takk — meldingen er sendt.
          </p>
        ) : (
          <form onSubmit={send}>
            <label htmlFor="feiltekst" className="sr-only">
              Hva er feil?
            </label>
            <textarea
              id="feiltekst"
              autoFocus
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              placeholder="Hva er feil? For eksempel feil navn på stedet, eller et bilde som hører til en annen adresse."
              maxLength={4000}
            />
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-[11px] leading-relaxed text-ink-soft">
                {tilstand === "feilet"
                  ? "Meldingen kom ikke fram. Prøv en gang til."
                  : "Går rett til Fotostallen."}
              </p>
              <button
                type="submit"
                disabled={tilstand === "sender" || !tekst.trim()}
                className="melding-knapp"
              >
                {tilstand === "sender" ? "Sender …" : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Laster ned originalen i full størrelse.
 *
 * Dropbox-lenkene har dl=1 og svarer med «attachment», så en vanlig lenke
 * laster ned rett fra fortauet. Immich sender fila «inline» og ville bare
 * åpnet den i en fane; derfor hentes den som blob og gis originalfilnavnet.
 * Dropbox sender ingen CORS-header, så den omveien virker bare for Immich.
 */
function DownloadLink({
  url,
  filnavn,
  photo,
}: {
  url: string;
  filnavn: string | null;
  /** Til loggen: hvilket bilde det var. */
  photo?: Photo;
}) {
  const [henter, setHenter] = useState(false);
  // Gamle Immich-lenker (med nøkkel) må hentes som blob. Lenker via
  // mellomtjeneren får koden som sjekksum i adressen og laster ned selv.
  const viaBlob = url.includes("/api/assets/");
  const viaProxy = /\/original\/[0-9a-f-]{36}$/.test(url);
  const href = viaProxy ? `${url}?t=${PASSORD_SJEKKSUM}` : url;

  const hentBlob = async () => {
    setHenter(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filnavn ?? "bilde.jpg";
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      window.open(url, "_blank", "noopener");
    } finally {
      setHenter(false);
    }
  };

  const lastNed = (e: MouseEvent) => {
    if (henter) {
      e.preventDefault();
      return;
    }
    // Loggen føres uansett hvilken vei fila kommer, og venter aldri.
    loggNedlasting({
      kontor: innloggetNavn(),
      bruker: innloggetKort(),
      bildeId: photo?.id ?? null,
      filnavn: filnavn ?? null,
      sted: photo?.placeName ?? null,
      kategori: null,
      adresse: null,
    });
    // Dropbox-lenken laster ned av seg selv; bare Immich trenger omveien.
    if (viaBlob) {
      e.preventDefault();
      void hentBlob();
    }
  };

  return (
    <a
      href={href}
      onClick={lastNed}
      download={filnavn ?? undefined}
      className="download-link"
    >
      {henter ? "Henter\u2026" : "Last ned"}
    </a>
  );
}
