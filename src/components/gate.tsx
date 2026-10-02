"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { PASSORD_SJEKKSUM, abonner, erLåstOpp, finnBruker, loggInn, sjekksum } from "@/lib/kode";

/**
 * Innloggingen foran portalen: samme forside-typografi som resten, med
 * brukernavn og passord. Siden er statisk eksportert, så den første
 * rendringen kjenner ikke nettleserens lagring — porten vises til
 * useSyncExternalStore har lest om noen alt er logget inn.
 */
export default function Gate({ children }: { children: ReactNode }) {
  const åpen = useSyncExternalStore(abonner, erLåstOpp, () => false);
  if (åpen) return <>{children}</>;
  return <Port />;
}

function Port() {
  const [brukernavn, setBrukernavn] = useState("");
  const [passord, setPassord] = useState("");
  const [feil, setFeil] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const bruker = finnBruker(brukernavn);
    const riktig = (await sjekksum(passord.trim())) === PASSORD_SJEKKSUM;
    // Én felles beskjed: hvilken av delene som er feil, er ikke noe
    // innloggingen skal røpe.
    if (!bruker || !riktig) {
      setFeil(true);
      return;
    }
    loggInn(bruker);
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
            Arkivet er forbeholdt meglerne vi samarbeider med. Logg inn med brukernavnet og
            passordet du har fått.
          </p>

          <form onSubmit={send} className="cover-form">
            <label className="mb-7 flex items-center gap-4 border-b border-rule pb-3">
              <span className="sr-only">Brukernavn</span>
              <input
                type="text"
                autoComplete="username"
                autoCapitalize="characters"
                spellCheck={false}
                value={brukernavn}
                onChange={(e) => {
                  setBrukernavn(e.target.value);
                  setFeil(false);
                }}
                placeholder="Brukernavn"
                aria-label="Brukernavn"
                aria-invalid={feil || undefined}
                className="cover-input min-w-0 flex-1 bg-transparent font-light tracking-tight placeholder:text-ink-soft/70 focus:outline-none"
              />
            </label>

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
              {feil && "Feil brukernavn eller passord."}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
