"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import {
  search,
  suggest,
  SearchError,
  type Group,
  type Category,
  type SearchPhoto as Photo,
  type Suggestion,
} from "@/lib/search-client";
import { FELLESAREAL_KATEGORIER } from "@/lib/categories";
import { KODE_SJEKKSUM, erLåstOpp, låsOpp, sjekksum } from "@/lib/kode";
import AreaMap, { KATEGORI_FARGER, type MapDot } from "@/components/area-map";

/**
 * Ett sted i presentasjonen: ett bilde vises, resten av serien ligger bak.
 * Lilleborg har 101 bilder; som 34 oppslag på rad slutter man å se dem,
 * som ett sted med «· 101 bilder» i bildeteksten blir de en ressurs.
 */
type Sted = { navn: string; bilde: Photo; serie: Photo[] };

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
      // Første oppslag: kartet tar hovedplassen og områdeteksten den tredje,
      // så bare én bildeplass er igjen.
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
const KJEDER = /mcdonald|burger king|\bkfc\b|subway|7-eleven|narvesen|deli de luca|pizzabakeren|domino/i;

/** De nærmeste navngitte stedene i en kategori, uten dubletter. */
function navngitte(groups: Group[], kategoriId: string, antall: number) {
  const gruppe = groups.find((g) => g.category.id === kategoriId);
  if (!gruppe) return [];
  const sett = new Set<string>();
  const ut: Array<{ navn: string; meter: number }> = [];
  for (const p of [...gruppe.photos].sort((a, b) => a.distanceMeters - b.distanceMeters)) {
    if (!p.placeName || erAdresse(p.placeName) || KJEDER.test(p.placeName)) continue;
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
function composeAreaText(groups: Group[], address: string, radiusMeters: number): string {
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
      `Morgenkaffen tar du hos ${kafeer[0].navn}, ${gangtid(kafeer[0].meter)} unna, eller hos ${kafeer[1].navn} litt lenger bort.`
    );
  } else if (kafeer.length === 1) {
    setninger.push(`Morgenkaffen tar du hos ${kafeer[0].navn}, ${gangtid(kafeer[0].meter)} unna.`);
  }

  if (restauranter.length === 2) {
    setninger.push(
      `Til middag frister ${restauranter[0].navn} og ${restauranter[1].navn} — og flere spisesteder ligger i gatene rundt.`
    );
  } else if (restauranter.length === 1) {
    setninger.push(
      `Til middag frister ${restauranter[0].navn}, ${gangtid(restauranter[0].meter)} unna.`
    );
  }

  if (parker.length === 1) {
    setninger.push(
      `${parker[0].navn} gir en grønn lunge ${gangtid(parker[0].meter)} fra døra — for trening, lek eller bare en benk i sola.`
    );
  }

  const kollektiv = navngitte(groups, "kollektiv", 1);
  if (kollektiv.length === 1) {
    setninger.push(
      `${kollektiv[0].navn} ligger ${gangtid(kollektiv[0].meter)} unna, så morgenen inn til byen blir kort.`
    );
  }

  const skoler = navngitte(groups, "skole", 1);
  if (skoler.length === 1) {
    setninger.push(`${skoler[0].navn} ligger ${gangtid(skoler[0].meter)} fra døra.`);
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
    setninger.push(`Innenfor ${formatRadius(radiusMeters)} finner du til sammen ${liste}.`);
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
  const [mapLegend, setMapLegend] = useState<Array<{ id: string; label: string }>>([]);
  const [searched, setSearched] = useState<{
    address: string;
    radius: number;
    center: { lat: number; lng: number };
  } | null>(null);
  const [page, setPage] = useState(0); // 0 = forside
  const [åpentSted, setÅpentSted] = useState<Sted | null>(null);

  // Koordinater fra et valgt adresseforslag, så vi slipper å geokode på nytt.
  const chosenCoords = useRef<Suggestion | null>(null);

  // Oppslagene avledes av gruppene og filteret, så et filterklikk bygger
  // sidene på nytt uten et nytt søk.
  const spreads = useMemo(() => {
    if (!groups) return null;
    const synlige = groups.filter((g) => !skjulte.has(g.category.id));
    // Fellesarealene åpner presentasjonen — de er det adressen har som
    // naboen ikke har.
    const sortert = [...synlige].sort(
      (a, b) =>
        (FELLESAREAL.has(b.category.id) ? 1 : 0) - (FELLESAREAL.has(a.category.id) ? 1 : 0)
    );
    return buildSpreads(sortert);
  }, [groups, skjulte]);

  // Kartet viser det samme som sidene — skrus en kategori av, forsvinner
  // også prikkene dens.
  const synligeDots = useMemo(
    () => mapDots.filter((d) => !skjulte.has(d.category)),
    [mapDots, skjulte]
  );

  const totalPages = 1 + (spreads?.length ?? 0);

  const goTo = useCallback(
    (next: number) => setPage(Math.max(0, Math.min(next, totalPages - 1))),
    [totalPages]
  );

  /** Skrur én kategori av eller på. */
  function vekslKategori(id: string) {
    setSkjulte((nå) => {
      const neste = new Set(nå);
      if (neste.has(id)) neste.delete(id);
      else neste.add(id);
      return neste;
    });
    setPage(1);
  }

  function visAlle() {
    setSkjulte(new Set());
    setPage(1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      // Med en serie åpen blar pilene i serien, ikke mellom oppslag.
      if (åpentSted) return;
      if (e.key === "ArrowRight") goTo(page + 1);
      if (e.key === "ArrowLeft") goTo(page - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, goTo, åpentSted]);

  const runSearch = useCallback(
    async (query: string, radiusMeters: number, coords: Suggestion | null) => {
      const trimmed = query.trim();
      if (!trimmed) return;

      setLoading(true);
      setError(null);
      setWarning(null);

      try {
        const data = await search(trimmed, radiusMeters, coords);
        const built = buildSpreads(data.groups);
        setGroups(data.groups);
        setSkjulte(new Set());
        setAreaText(composeAreaText(data.groups, trimmed, radiusMeters));
        setMapDots(
          data.groups.flatMap((g) =>
            g.photos.map((ph) => ({
              lat: ph.lat,
              lng: ph.lng,
              category: g.category.id,
              placeName: ph.placeName,
              distanceMeters: ph.distanceMeters,
              thumb: ph.thumb,
            }))
          )
        );
        // Fellesarealene står først: de er knyttet til nettopp denne
        // adressen, mens resten av nabolaget deles med alle rundt.
        setMapLegend(
          [...data.groups]
            .sort(
              (a, b) =>
                (FELLESAREAL.has(b.category.id) ? 1 : 0) - (FELLESAREAL.has(a.category.id) ? 1 : 0)
            )
            .map((g) => ({ id: g.category.id, label: g.category.label }))
        );
        setWarning(data.warning ?? null);
        setSearched({ address: trimmed, radius: radiusMeters, center: data.center });
        setPage(built.length > 0 ? 1 : 0);
      } catch (err) {
        setError(
          err instanceof SearchError ? err.message : "Noe gikk galt under søket"
        );
        setGroups(null);
      } finally {
        setLoading(false);
      }
    },
    []
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

  function handlePickSuggestion(s: Suggestion) {
    chosenCoords.current = s;
    setAddress(s.label);
    runSearch(s.label, radius, s);
  }

  const spread = page > 0 && spreads ? spreads[page - 1] : null;

  return (
    <div className="relative min-h-screen w-full bg-paper lg:h-screen lg:overflow-hidden">
      {/* Hårfin ramme, som kanten på et trykt oppslag. */}
      <div className="pointer-events-none fixed inset-4 z-20 border border-rule sm:inset-6" />

      {spread ? (
        <Spread
          spread={spread}
          page={page}
          totalPages={totalPages}
          address={searched?.address ?? ""}
          radius={searched?.radius ?? radius}
          center={searched?.center ?? null}
          mapDots={synligeDots}
          mapLegend={mapLegend}
          skjulte={skjulte}
          onVekslKategori={vekslKategori}
          onVisAlle={visAlle}
          onEndreRadius={endreRadius}
          laster={loading}
          areaText={areaText}
          goTo={goTo}
          onÅpne={setÅpentSted}
        />
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
          emptyResult={spreads !== null && spreads.length === 0 && searched !== null}
          searched={searched}
          resultPageCount={spreads?.length ?? 0}
          onResume={() => goTo(1)}
        />
      )}

      {åpentSted && <SeriesView sted={åpentSted} onClose={() => setÅpentSted(null)} />}
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
          (s) => s.label.toLowerCase() !== query.toLowerCase()
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
            <li key={`${s.label}-${s.lat}-${s.lng}`} role="option" aria-selected={i === active}>
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
}) {
  return (
    <section className="relative flex min-h-screen flex-col px-10 py-12 sm:px-16 sm:py-14 lg:h-screen">

      <header className="relative z-10 flex shrink-0 items-start justify-between text-[10px] uppercase tracking-[0.28em] text-ink-soft">
        <span>Områdebilder</span>
        <span>Fotografisk arkiv</span>
      </header>

      <div className="relative z-10 flex flex-1 items-center py-10">
        {/* Skalaen på forsiden er definert samlet i globals.css. */}
        <div className="cover-block">
          <p className="mb-5 text-[10px] uppercase tracking-[0.32em] text-ink-soft">
            Nabolagsfotografi
          </p>

          <h1 className="cover-title">Områdebilder</h1>

          <p className="cover-lede mt-7 text-ink-soft">
            Et fotografisk arkiv over nabolag, bygget opp bilde for bilde på stedet. Skriv inn en
            adresse, så finner portalen kafeene, restaurantene, parkene, fasadene, takterrassene og
            bakgårdene som faktisk ligger innen gangavstand.
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
              <span className="text-[10px] uppercase tracking-[0.28em] text-ink-soft">Radius</span>
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
                Ingen bilder er registrert innen {formatRadius(searched.radius)} fra «
                {searched.address}».
              </p>
            )}
            {resultPageCount > 0 && searched && (
              <button
                type="button"
                onClick={onResume}
                className="text-[11px] uppercase tracking-[0.18em] text-ink underline underline-offset-[6px] transition-opacity hover:opacity-60"
              >
                Se {resultPageCount} {resultPageCount === 1 ? "side" : "sider"} for «
                {searched.address}» →
              </button>
            )}
          </div>
        </div>
      </div>

      <footer className="relative z-10 grid shrink-0 grid-cols-2 gap-6 border-t border-rule pt-5 text-[10px] uppercase tracking-[0.2em] sm:grid-cols-4">
        <MetaCell label="Arkiv" value="Områdebilder" />
        <MetaCell label="Bilder i samlingen" value={photoCount > 0 ? String(photoCount) : "—"} />
        <MetaCell
          label="Sist oppdatert"
          value={updatedAt ? new Date(updatedAt).toLocaleDateString("no-NO") : "—"}
        />
        <MetaCell label="Side" value="01" align="right" />
      </footer>
    </section>
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

function Spread({
  spread,
  page,
  totalPages,
  address,
  radius,
  center,
  mapDots,
  mapLegend,
  skjulte,
  onVekslKategori,
  onVisAlle,
  onEndreRadius,
  laster,
  areaText,
  goTo,
  onÅpne,
}: {
  spread: SpreadData;
  page: number;
  totalPages: number;
  address: string;
  radius: number;
  center: { lat: number; lng: number } | null;
  mapDots: MapDot[];
  mapLegend: Array<{ id: string; label: string }>;
  skjulte: Set<string>;
  onVekslKategori: (id: string) => void;
  onVisAlle: () => void;
  onEndreRadius: (meter: number) => void;
  laster: boolean;
  areaText: string;
  goTo: (n: number) => void;
  onÅpne: (sted: Sted) => void;
}) {
  const [hero, ...rest] = spread.steder;
  // På første oppslag står kartet i hovedplassen; alle fotoene går til høyre.
  const heroIsMap = spread.intro && center !== null;
  const rightSteder = heroIsMap ? spread.steder : rest;
  const soloHero = !heroIsMap && rest.length === 0;

  return (
    <section className="flex min-h-screen flex-col px-10 py-12 sm:px-16 sm:py-14 lg:h-screen">
      <header className="flex shrink-0 items-baseline justify-between text-[10px] uppercase tracking-[0.28em] text-ink-soft">
        <button type="button" onClick={() => goTo(0)} title="Til forsiden" className="home-link">
          Områdebilder
        </button>
        <span className="shrink-0 text-ink">{spread.category.label}</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-10 py-8 lg:grid-cols-12 lg:gap-12">
        {/* Venstre: kartet (første oppslag) eller hovedbildet, med tekst under. */}
        <div className={`flex min-h-0 flex-col ${soloHero ? "lg:col-span-9" : "lg:col-span-7"}`}>
          {heroIsMap && center ? (
            <figure className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-[220px] flex-1 overflow-hidden border border-rule">
                <AreaMap center={center} radiusMeters={radius} dots={mapDots} />
              </div>
              <figcaption className="mt-2 shrink-0 text-[10px] uppercase tracking-[0.18em] text-ink-soft">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">{address.split(",")[0]}</span>
                  <span className="shrink-0">{formatRadius(radius)} gangavstand</span>
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
                              : KATEGORI_FARGER[item.id] ?? KATEGORI_FARGER.annet,
                            boxShadow: av
                              ? `inset 0 0 0 1px ${KATEGORI_FARGER[item.id] ?? KATEGORI_FARGER.annet}`
                              : undefined,
                          }}
                        />
                        {item.label}
                        {FELLESAREAL.has(item.id) && <span aria-hidden>&#9642;</span>}
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
          ) : (
            <Frame sted={hero} onÅpne={onÅpne} className="min-h-[220px] flex-1" />
          )}

          {heroIsMap ? (
            // Kartet tegner allerede radius-sirkelen, så kontrollen hører
            // hjemme her framfor kategoriteksten.
            <div className="mt-6 grid shrink-0 grid-cols-1 gap-5 sm:grid-cols-12">
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
                  Juster hvor stort område presentasjonen dekker. Sirkelen på kartet viser
                  utsnittet.
                </p>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid shrink-0 grid-cols-1 gap-5 sm:grid-cols-12">
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
        <div className={`flex min-h-0 gap-5 ${soloHero ? "lg:col-span-3" : "lg:col-span-5"}`}>
          <span className="vertical-rl hidden shrink-0 rotate-180 self-start text-[10px] uppercase tracking-[0.3em] text-ink-soft lg:block">
            {spread.partCount > 1
              ? `Del ${spread.part} av ${spread.partCount}`
              : `${spread.steder.length} ${spread.steder.length === 1 ? "sted" : "steder"}`}
          </span>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
            {rightSteder.map((sted) => (
              <Frame key={sted.bilde.id} sted={sted} onÅpne={onÅpne} className="min-h-[150px] flex-1" />
            ))}
            {/* På første oppslag står områdeteksten der det tredje bildet
                ellers ville stått — en kort tekst om det søket faktisk fant. */}
            {spread.intro && areaText && (
              <div className="flex min-h-0 flex-1 flex-col justify-end">
                <p className="mb-3 border-t border-rule pt-4 text-[10px] uppercase tracking-[0.3em] text-ink-soft">
                  Området
                </p>
                <p className="text-[13px] leading-relaxed text-ink-soft">{areaText}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-rule pt-5 text-[10px] uppercase tracking-[0.2em] text-ink-soft">
        <span>Side {pageLabel(page + 1)}</span>
        <span className="hidden truncate px-4 sm:block">{address}</span>
        <Nav page={page} totalPages={totalPages} goTo={goTo} />
      </footer>
    </section>
  );
}

function Frame({
  sted,
  onÅpne,
  className,
}: {
  sted: Sted;
  onÅpne: (sted: Sted) => void;
  className?: string;
}) {
  const photo = sted.bilde;
  const antall = sted.serie.length;
  return (
    <figure className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onÅpne(sted)}
        title={antall > 1 ? `Se alle ${antall} bildene` : "Se bildet ubeskåret"}
        className="block min-h-0 flex-1 cursor-zoom-in overflow-hidden bg-paper-deep"
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
        <span className="truncate">
          {sted.navn}
          {antall > 1 && <span className="text-ink"> · {antall} bilder</span>}
        </span>
        <span className="flex shrink-0 items-baseline gap-3">
          <span>{photo.distanceMeters} m</span>
          {photo.original && <DownloadLink url={photo.original} filnavn={photo.filnavn} />}
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
function SeriesView({ sted, onClose }: { sted: Sted; onClose: () => void }) {
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
    <div className="serie-veil" onClick={onClose} role="dialog" aria-modal aria-label={sted.navn}>
      <div className="serie-card" onClick={(e) => e.stopPropagation()}>
        <header className="flex shrink-0 items-baseline justify-between gap-4 text-[10px] uppercase tracking-[0.28em] text-ink-soft">
          <span className="min-w-0 truncate text-ink">{photo.placeName}</span>
          <span className="flex shrink-0 items-baseline gap-5">
            <span>{photo.distanceMeters} m</span>
            <button type="button" onClick={onClose} className="download-link" aria-label="Lukk">
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
              <button type="button" onClick={forrige} aria-label="Forrige bilde" className="text-base leading-none text-ink transition-transform hover:-translate-x-1">
                ←
              </button>
              <span className="text-ink">
                {i + 1} / {n}
              </span>
              <button type="button" onClick={neste} aria-label="Neste bilde" className="text-base leading-none text-ink transition-transform hover:translate-x-1">
                →
              </button>
            </span>
          ) : (
            <span>1 bilde</span>
          )}
          <span className="flex items-baseline gap-5">
            {photo.original && <DownloadLink url={photo.original} filnavn={photo.filnavn} />}
            <span className="hidden sm:inline">Esc lukker</span>
          </span>
        </footer>
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
function DownloadLink({ url, filnavn }: { url: string; filnavn: string | null }) {
  const [henter, setHenter] = useState(false);
  const [spør, setSpør] = useState(false);
  const [kode, setKode] = useState("");
  const [feil, setFeil] = useState(false);
  // Gamle Immich-lenker (med nøkkel) må hentes som blob. Lenker via
  // mellomtjeneren får koden som sjekksum i adressen og laster ned selv.
  const viaBlob = url.includes("/api/assets/");
  const viaProxy = /\/original\/[0-9a-f-]{36}$/.test(url);
  const href = viaProxy ? `${url}?t=${KODE_SJEKKSUM}` : url;

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
    if (!erLåstOpp()) {
      e.preventDefault();
      setSpør(true);
      return;
    }
    // Dropbox-lenken laster ned av seg selv; bare Immich trenger omveien.
    if (viaBlob) {
      e.preventDefault();
      void hentBlob();
    }
  };

  const sendKode = async (e: FormEvent) => {
    e.preventDefault();
    if ((await sjekksum(kode.trim())) !== KODE_SJEKKSUM) {
      setFeil(true);
      return;
    }
    låsOpp();
    setSpør(false);
    setFeil(false);
    if (viaBlob) void hentBlob();
    else window.location.assign(href);
  };

  if (spør) {
    return (
      <form onSubmit={sendKode} className="download-code" title="Skriv koden for å laste ned">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={kode}
          onChange={(e) => {
            setKode(e.target.value);
            setFeil(false);
          }}
          placeholder="Kode"
          aria-label="Kode for nedlasting"
          aria-invalid={feil || undefined}
        />
        <button type="submit" aria-label="Lås opp">
          &rarr;
        </button>
        {feil && <span className="download-code-feil">Feil kode</span>}
      </form>
    );
  }

  return (
    <a href={href} onClick={lastNed} download={filnavn ?? undefined} className="download-link">
      {henter ? "Henter\u2026" : "Last ned"}
    </a>
  );
}

/* ------------------------------------------------------------ Navigasjon */

function Nav({
  page,
  totalPages,
  goTo,
}: {
  page: number;
  totalPages: number;
  goTo: (n: number) => void;
}) {
  return (
    <nav className="flex items-center gap-3">
      <span>
        {pageLabel(page + 1)} / {pageLabel(totalPages)}
      </span>
      <button
        onClick={() => goTo(page - 1)}
        aria-label={page === 1 ? "Tilbake til søk" : "Forrige side"}
        className="flex h-8 w-8 items-center justify-center border border-rule text-sm text-ink transition-colors hover:border-ink"
      >
        ←
      </button>
      <button
        onClick={() => goTo(page + 1)}
        disabled={page === totalPages - 1}
        aria-label="Neste side"
        className="flex h-8 w-8 items-center justify-center border border-rule text-sm text-ink transition-colors hover:border-ink disabled:opacity-30 disabled:hover:border-rule"
      >
        →
      </button>
    </nav>
  );
}
