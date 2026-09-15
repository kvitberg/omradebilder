"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { KODE_SJEKKSUM, abonner, erLåstOpp, låsOpp, sjekksum } from "@/lib/kode";

/**
 * Porten foran portalen: samme forside-typografi, men i stedet for
 * søkefeltet står ett kodefelt. Siden er statisk eksportert, så den
 * første rendringen kjenner ikke nettleserens lagring — porten vises til
 * useSyncExternalStore har lest om koden alt er skrevet.
 */
export default function Gate({ children }: { children: ReactNode }) {
  const åpen = useSyncExternalStore(abonner, erLåstOpp, () => false);
  if (åpen) return <>{children}</>;
  return <Port />;
}

function Port() {
  const [kode, setKode] = useState("");
  const [feil, setFeil] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    if ((await sjekksum(kode.trim())) !== KODE_SJEKKSUM) {
      setFeil(true);
      return;
    }
    låsOpp();
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
            Arkivet er forbeholdt meglere og samarbeidspartnere. Skriv inn koden du har fått for å
            åpne det.
          </p>

          <form onSubmit={send} className="cover-form">
            <div className="flex items-center gap-4 border-b border-ink pb-3">
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={kode}
                onChange={(e) => {
                  setKode(e.target.value);
                  setFeil(false);
                }}
                placeholder="Kode"
                aria-label="Kode"
                aria-invalid={feil || undefined}
                className="cover-input min-w-0 flex-1 bg-transparent font-light tracking-tight placeholder:text-ink-soft/70 focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Åpne"
                className="shrink-0 text-xl leading-none transition-transform hover:translate-x-1"
              >
                →
              </button>
            </div>
            <p aria-live="polite" className="mt-7 min-h-[1.5em] text-[13px] text-ink">
              {feil && "Feil kode."}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
