# Oppgaver

Ting vi vet om og ikke har tatt ennå. Nyeste øverst i hver bolk.

## Venter på en avgjørelse

### Betaling til fotografer — to fundamenter mangler

Baktanken med admin-siden er å betale fotografene for bildene som lastes
ned. Det stiller to krav dagens data ikke tåler.

**Attribusjonen må være eksakt, ikke gjettet.** Fotografen står ingen
steder: alle Immich-bildene har samme eier, ingen har artist- eller
copyright-felt, og Dropbox-bildene ligger under `/Felles/Områdebilder JPG`
uten navn i stien. Kameramodellen er hentet inn (`npm run kamera`) og
dekker 1712 av 3433 bilder — men den er en gjetning: deler to fotografer et
hus, eller bruker én to, blir pengene feil. Til nysgjerrighet holder det,
til utbetaling gjør det ikke.

De 1721 øvrige har ingen EXIF i denne veien og får ingen fotograf uansett.

Veien videre er å tagge fotografen i Immich, slik kategoriene allerede
tagges. Det er manuelt, men presist, og taggen følger bildet.

**Tellingen må skje hos oss, ikke i nettleseren.** I dag går 1719
nedlastinger rett til Dropbox og 1714 rett til Immich — ingen innom vår
egen tjener. Loggen er nettleserens egen melding, sendt uten å vente:

- den kan gå tapt (nettverk, lukket fane) og teller for lite
- den kan sendes på nytt av hvem som helst med meglerkoden og teller for mye
- den sier at nedlastingen *startet*, ikke at fila kom fram

Det holder til å se hva meglerne bruker. Det holder ikke som grunnlag for
en faktura.

Mellomtjeneren i `worker/` teller riktig fordi fila går gjennom den — den
er ferdig bygget og står avslått (`ORIGINAL_PROXY` er tom). Slås den på,
blir Immich-halvparten talt hos oss. Dropbox-lenkene går utenom uansett.

**Det peker på Dropbox-spørsmålet.** Skal fotografer betales per
nedlasting, er det et problem at halve arkivet ligger utenfor den tellende
veien og uten attribusjon. Flyttes alt til Immich, løses begge deler på én
gang: taggen gir fotografen, mellomtjeneren gir tellingen.

**Uavklart uansett vei:** teller tre nedlastinger av samme bilde som tre,
eller som ett bruk? Og er enheten per nedlasting, per unike bilde i et
oppdrag, eller en andel?

### Gårdsrom som er for grove
Matrikkelen deler ikke alltid opp fellesgrunn i enkeltgårdsrom. Der den bare
har det grove laget, binder vi bakgårdsbilder altfor bredt:

- Kanonhallveien 34A: 200 adresser
- Ansgar Sørlies vei 24: 173 adresser i sju gater

Av 750 bakgårdsbilder ligger medianen på 9 adresser, men 165 er bundet til
21–40 og 35 til over 40. Akebakkeskogen med 147 er riktig — det er et
registrert borettslag i `borettslag.json`.

To veier:

1. **Avstandstak.** Et bakgårdsbilde vises ikke lenger unna enn f.eks. 60 m,
   uansett hva matrikkelen sier. Måler det som betyr noe for en megler.
   `heleBorettslaget` kjører etterpå og utvider ekte borettslag tilbake.
2. **Tak på antall.** Over f.eks. 40 adresser uten treff i `borettslag.json`
   er det en fellesgrunn, ikke en bakgård — da binder vi bare til bygningen.

Helningen er mot avstandstaket.

### 1060 Dropbox-bilder uten posisjon
Mappene er navngitt etter område, ikke adresse: Fornebu (84), Kampen (46),
Aker brygge og Tjuvholmen (46), Grünerløkka (39), Holmenkollen (30, stavet
«Homenkollen»), Frysja Sagadammen (29). 193 mapper, 26 med ti bilder eller
mer. Bare 8 av de 1060 har en ekte adresse i stien.

De kan geokodes på områdenavnet, men da havner alle bildene i en mappe på
samme punkt — «Kampen · 46 bilder» som ett sted. For nabolagsbilder er det
trolig riktig. Avgjørelsen er ikke tatt.

### Rettighetene til frilansernes bilder
141 av kandidatene i bakgårdssøket ligger under `/Freelancere` (Kristine
Elvemo, Henrik Eriksen) og 185 under Kevin Fauske. Uavklart om de kan
brukes i portalen.

## Må gjøres før lansering

### Fjern feilmeldingen
Betaverktøyet «Meld feil» skal ut: `src/lib/rapport.ts`, `Feilmelding` i
`portal.tsx`, `/rapport` i `worker/src/index.ts`, KV-navnerommet RAPPORTER,
og `scripts/rapporter.ts`.

### Slå på mellomtjeneren for originalfiler
`ORIGINAL_PROXY` er tom i `.env.local`, så mellomtjeneren i `worker/` er
koblet opp, men slått av. Det betyr at delingsnøkkelen til Immich-albumet
ligger i klartekst i den publiserte datafila, for 1541 lenker — nøyaktig det
mellomtjeneren ble bygget for å hindre. Nedlasting må testes før og etter.

## Vekt og opprydding

- `public/data/bygg.json` er 1,3 MB. Kartlaget lastes ned av hver megler.
- `public/thumbs` er 513 MB i git, 5044 filer. 117 flere enn indeksen har
  bilder, altså foreldreløse miniatyrer.
- Fire filer er borte fra Dropbox og svarer 409:
  `Oslo/Ullern/uteomrade09, 10, 11, 14.jpg`.

## Åpne spørsmål om data

- **Englandsgården** står i `bakgard-navn.json` med fjorten adresser i Agathe
  Grøndahls gate, Per Kvibergs gate, Vogts gate og Åsengata — ingen i
  Sandakerveien, og «Sandakerveien 5» finnes ikke i adresseregisteret.
  Stemmer adressene? Det ligger 173 bilder fra juli 2026 i Dropbox på
  Agathe Grøndahls gate 2B, men kvartalet har ingen teiger før det har
  bilder i portalen.
- **Håndbakt:** to bilder heter fortsatt «Håndbakt», tjue meter fra det som
  nå heter Factory Tøyen, pluss fire i Dropbox-mappa `Oslo/Gamle Oslo/
  Håndbakt` uten posisjon. Er de også Factory, eller den ekte Håndbakt?
- **392 Immich-bilder uten GPS.** Stedsnavnet deres er filnavnet, så det
  finnes verken koordinat eller beskrivelse å slå opp. Må løses i Immich.

## Materiale som venter

`npm run bakgard-kandidater` finner 2252 adresser i Dropbox med bilder i
sesong som portalen ikke har. 790 har bekreftet gårdsrom; de øvrige 1462
trenger `npm run teiger` for kvartalet sitt før bindingen blir presis.
Rekkefølgen er alltid: bilder inn, så teiger, så binding.
