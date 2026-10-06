"use client";

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { abonner, erLåstOpp, finnBruker, loggInn, sjekksum } from "@/lib/kode";

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
  const [vis, setVis] = useState(false);
  const [feil, setFeil] = useState(false);

  async function send(e: FormEvent) {
    e.preventDefault();
    const bruker = finnBruker(brukernavn);
    // Mot brukerens eget passord, ikke mot ett felles: admin har sitt eget,
    // og de tre kontorene deler et annet.
    const skrevet = await sjekksum(passord.trim());
    const riktig = !!bruker && skrevet === bruker.sjekksum;
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

          <form onSubmit={send} className="logg-inn">
            <label className="logg-inn-felt">
              <span className="logg-inn-merke">Brukernavn</span>
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
                aria-invalid={feil || undefined}
              />
            </label>

            <div className="logg-inn-felt">
              <span className="logg-inn-merke">
                <label htmlFor="passord">Passord</label>
                <button type="button" onClick={() => setVis(!vis)} className="download-link">
                  {vis ? "Skjul" : "Vis"}
                </button>
              </span>
              <input
                id="passord"
                type={vis ? "text" : "password"}
                autoComplete="current-password"
                value={passord}
                onChange={(e) => {
                  setPassord(e.target.value);
                  setFeil(false);
                }}
                aria-invalid={feil || undefined}
              />
            </div>

            <button type="submit" className="logg-inn-knapp">
              Logg inn
              <span aria-hidden>&rarr;</span>
            </button>

            <p aria-live="polite" className="logg-inn-feil">
              {feil && "Feil brukernavn eller passord."}
            </p>
          </form>
        </div>
      </div>
    </section>
  );
}
