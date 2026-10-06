# Oppgaver

Ting vi vet om og ikke har tatt ennå. Nyeste øverst i hver bolk.

## Venter på en avgjørelse

### Hvem har tatt bildet
Fotografen står ingen steder i dataene. Alle Immich-bildene har samme eier
(delingskontoen), og ingen har artist- eller copyright-felt. Dropbox-bildene
i portalen ligger alle under `/Felles/Områdebilder JPG`, uten navn i stien.

Kameramodellen er det eneste som skiller, og den er nå hentet inn i
`data/index.json` for alle Immich-bildene (`npm run kamera`):

| Modell | Bilder |
|---|---|
| Canon EOS R5 | 937 |
| Canon EOS R5m2 | 368 |
| Leica Q2 | 367 |
| Leica Q3 43 | 341 |
| DJI FC9313 | 40 |
| Canon EOS R | 29 |
| DJI FC8482 | 10 |
| Canon EOS 6D | 7 |
| Canon EOS R6m2 | 6 |
| DJI FC220 | 1 |

`data/fotografer.json` er klar til å oversette modell til navn, og
prepare-static publiserer `fotograf` så snart den er fylt ut. Kameraet
sendes ikke ut til nettleseren før det skjer — det er 1712 strenger uten
nytte. De 1719 Dropbox-bildene har ingen EXIF i denne veien og får ingen
fotograf uansett.

Tre veier: fyll ut modell-til-navn der det er entydig, tagg fotografen i
Immich slik kategoriene allerede tagges, eller la det ligge.


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
