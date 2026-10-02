"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import {
  BRUKERE,
  PASSORD_SJEKKSUM,
  abonner,
  erLåstOpp,
  loggInn,
  sjekksum,
  type Bruker,
} from "@/lib/kode";

/**
 * Innloggingen foran portalen: samme forside-typografi som resten, men
 * med meglerhusene på rad og ett passordfelt. Siden er statisk eksportert,
 * så den første rendringen kjenner ikke nettleserens lagring — porten
 * vises til useSyncExternalStore har lest om noen alt er logget inn.
 */
export default function Gate({ children }: { children: ReactNode }) {
  const åpen = useSyncExternalStore(abonner, erLåstOpp, () => false);
  if (åpen) return <>{children}</>;
  return <Port />;
}

function Port() {
  const [valgt, setValgt] = useState<Bruker>(BRUKERE[0]);
  const [passord, setPassord] = useState("");
  const [feil, setFeil] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    if ((await sjekksum(passord.trim())) !== PASSORD_SJEKKSUM) {
      setFeil(true);
      return;
    }
    loggInn(valgt);
  }

  return (
    <section className="relative flex min-h-screen flex-col px-10 py-12 sm:px-16 sm:py-14 lg:h-screen">
      <header className="relative z-10 flex shrink-0 items-start justify-between text-[10px] uppercase tracking-[0.28em] text-ink-soft">
        <span>Områdebilder</span>
        <span>Fotografisk arkiv</span>
      </header>

      <div className="relative z-10 flex flex-1 items-center py-10">
        <div className="cover-block">
          <p className="mb-5 text-[10px] uppercase tracking-[0.32em] text-ink-soft">
            Nabolagsfotografi
          </p>
          <h1 className="cover-title">Områdebilder</h1>
          <p className="cover-lede mt-7 text-ink-soft">
            Arkivet er forbeholdt meglerne vi samarbeider med. Velg kontoret ditt og skriv
            passordet du har fått.
          </p>

          <form onSubmit={send} className="cover-form">
            <fieldset className="border-0 p-0">
              <legend className="mb-4 text-[10px] uppercase tracking-[0.28em] text-ink-soft">
                Kontor
              </legend>
              <div className="mb-8 flex flex-col gap-px border-y border-rule">
                {BRUKERE.map((bruker) => {
                  const aktiv = bruker.id === valgt.id;
                  return (
                    <label
                      key={bruker.id}
                      className={`flex cursor-pointer items-center gap-4 py-3 text-[15px] transition-colors ${
                        aktiv ? "text-ink" : "text-ink-soft hover:text-ink"
                      }`}
                    >
                      <input
                        type="radio"
                        name="kontor"
                        value={bruker.id}
                        checked={aktiv}
                        onChange={() => setValgt(bruker)}
                        className="sr-only"
                      />
                      {/* Samme lille kvadrat som markerer fellesarealer i filteret. */}
                      <span
                        aria-hidden
                        className={`h-2.5 w-2.5 shrink-0 border transition-colors ${
                          aktiv ? "border-ink bg-ink" : "border-rule"
                        }`}
                      />
                      {bruker.navn}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex items-center gap-4 border-b border-ink pb-3">
              <input
                type="password"
                autoComplete="current-password"
                value={passord}
                onChange={(e) => {
                  setPassord(e.target.value);
                  setFeil(false);
                }}
                placeholder="Passord"
                aria-label="Passord"
                aria-invalid={feil || undefined}
                className="cover-input min-w-0 flex-1 bg-transparent font-light tracking-tight placeholder:text-ink-soft/70 focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Logg inn"
                className="shrink-0 text-xl leading-none transition-transform hover:translate-x-1"
              >
                →
              </button>
            </div>
            <p aria-live="polite" className="mt-7 min-h-[1.5em] text-[13px] text-ink">
              {feil && "Feil passord."}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
