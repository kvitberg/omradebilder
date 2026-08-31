"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  search,
  suggest,
  SearchError,
  type Group,
  type Category,
  type SearchPhoto as Photo,
  type Suggestion,
} from "@/lib/search-client";

/** Ett magasinoppslag: én kategori, maks tre bilder. */
type SpreadData = {
  category: Category;
  photos: Photo[];
  part: number;
  partCount: number;
};

const PHOTOS_PER_SPREAD = 3;

const RADIUS_OPTIONS = [
  { value: 300, label: "300 m" },
  { value: 500, label: "500 m" },
  { value: 750, label: "750 m" },
  { value: 1000, label: "1 km" },
  { value: 2000, label: "2 km" },
];

function buildSpreads(groups: Group[]): SpreadData[] {
  return groups.flatMap((group) => {
    const chunks: Photo[][] = [];
    for (let i = 0; i < group.photos.length; i += PHOTOS_PER_SPREAD) {
      chunks.push(group.photos.slice(i, i + PHOTOS_PER_SPREAD));
    }
    return chunks.map((photos, i) => ({
      category: group.category,
      photos,
      part: i + 1,
      partCount: chunks.length,
    }));
  });
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
  const [spreads, setSpreads] = useState<SpreadData[] | null>(null);
  const [searched, setSearched] = useState<{ address: string; radius: number } | null>(null);
  const [page, setPage] = useState(0); // 0 = forside

  // Koordinater fra et valgt adresseforslag, så vi slipper å geokode på nytt.
  const chosenCoords = useRef<Suggestion | null>(null);

  const totalPages = 1 + (spreads?.length ?? 0);

  const goTo = useCallback(
    (next: number) => setPage(Math.max(0, Math.min(next, totalPages - 1))),
    [totalPages]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") goTo(page + 1);
      if (e.key === "ArrowLeft") goTo(page - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, goTo]);

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
        setSpreads(built);
        setWarning(data.warning ?? null);
        setSearched({ address: trimmed, radius: radiusMeters });
        setPage(built.length > 0 ? 1 : 0);
      } catch (err) {
        setError(
          err instanceof SearchError ? err.message : "Noe gikk galt under søket"
        );
        setSpreads(null);
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
          goTo={goTo}
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
        const found = await suggest(query);
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
          className="absolute left-0 right-0 top-full z-30 mt-px max-h-72 overflow-y-auto border-x border-b border-rule bg-paper shadow-sm"
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
  goTo,
}: {
  spread: SpreadData;
  page: number;
  totalPages: number;
  address: string;
  radius: number;
  goTo: (n: number) => void;
}) {
  const [hero, ...rest] = spread.photos;
  const soloHero = rest.length === 0;

  return (
    <section className="flex min-h-screen flex-col px-10 py-12 sm:px-16 sm:py-14 lg:h-screen">
      <header className="flex shrink-0 items-start justify-between text-[10px] uppercase tracking-[0.28em] text-ink-soft">
        <span className="truncate pr-6">{address}</span>
        <span className="shrink-0 text-ink">{spread.category.label}</span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-10 py-8 lg:grid-cols-12 lg:gap-12">
        {/* Venstre: hovedbildet med tittel og brødtekst under. */}
        <div className={`flex min-h-0 flex-col ${soloHero ? "lg:col-span-9" : "lg:col-span-7"}`}>
          <Frame photo={hero} className="min-h-[220px] flex-1" />

          <div className="mt-6 grid shrink-0 grid-cols-1 gap-5 sm:grid-cols-12">
            <h2 className="text-xl font-semibold uppercase leading-[0.95] tracking-tight sm:col-span-4">
              {spread.category.label}
            </h2>
            <p className="text-[13px] leading-relaxed text-ink-soft sm:col-span-8">
              {spread.category.description} Bildene her er tatt innen {formatRadius(radius)} fra{" "}
              {address}.
            </p>
          </div>
        </div>

        {/* Høyre: rotert etikett og de mindre bildene stablet. */}
        <div className={`flex min-h-0 gap-5 ${soloHero ? "lg:col-span-3" : "lg:col-span-5"}`}>
          <span className="vertical-rl hidden shrink-0 rotate-180 self-start text-[10px] uppercase tracking-[0.3em] text-ink-soft lg:block">
            {spread.partCount > 1
              ? `Del ${spread.part} av ${spread.partCount}`
              : `${spread.photos.length} bilder`}
          </span>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-5">
            {rest.map((photo) => (
              <Frame key={photo.id} photo={photo} className="min-h-[150px] flex-1" />
            ))}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 items-center justify-between border-t border-rule pt-5 text-[10px] uppercase tracking-[0.2em] text-ink-soft">
        <span>Side {pageLabel(page + 1)}</span>
        <span className="hidden sm:block">Områdebilder</span>
        <Nav page={page} totalPages={totalPages} goTo={goTo} />
      </footer>
    </section>
  );
}

function Frame({ photo, className }: { photo: Photo; className?: string }) {
  return (
    <figure className={`flex min-h-0 flex-col ${className ?? ""}`}>
      <div className="min-h-0 flex-1 overflow-hidden bg-paper-deep">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbnailUrl(photo)}
          alt={photo.placeName}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
      <figcaption className="mt-2 flex shrink-0 items-baseline justify-between gap-3 text-[10px] uppercase tracking-[0.18em] text-ink-soft">
        <span className="truncate">{photo.placeName}</span>
        <span className="shrink-0">{photo.distanceMeters} m</span>
      </figcaption>
    </figure>
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
