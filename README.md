# Områdebilder

Skriv inn en adresse og få opp kafeer, restauranter, parker, fasader,
takterrasser og bakgårder du selv har tatt bilde av i nærheten. Bildene hentes
fra Dropbox og presenteres som et digitalt magasin: en forside med søkefeltet,
og deretter ett nummerert oppslag per kategori.

## Se designet med én gang

Du trenger ikke Dropbox for å se hvordan portalen ser ut:

```bash
npm install && npm run demo && npm run dev
```

`npm run demo` fyller `data/index.json` med et lite testdatasett rundt Bjørvika
i Oslo (søk f.eks. på «Dronning Eufemias gate 12»). Bildene vises som nøytrale
plassholdere fram til Dropbox er koblet til. `npm run sync` erstatter demo-data
med dine ekte bilder.

## Hvordan det fungerer

1. `npm run sync` går gjennom en mappe i Dropbox, finner alle bildefiler,
   og for hvert bilde:
   - leser GPS-posisjon fra EXIF-dataene hvis det finnes, ellers
   - geokoder stedet basert på mappenavnet (f.eks. mappen bildet ligger i)
   - gjetter kategori (cafe/restaurant/park/...) ut fra mappenavn, se
     [src/lib/categories.ts](src/lib/categories.ts)
   - resultatet lagres i `data/index.json`
2. Nettsiden leser `data/index.json` og viser bilder innenfor valgt radius,
   gruppert etter kategori — maks tre bilder per oppslag, så en kategori med
   mange treff spiller over på flere sider.
3. Selve bildevisningen (thumbnails) hentes direkte fra Dropbox via
   `/api/thumbnail`, så originalbildene ligger fortsatt bare i Dropbox.

### Adressesøk

Søkefeltet gir forslag mens du skriver, hentet fra Kartverkets åpne
adresse-API ([Geonorge](https://ws.geonorge.no/adresser/v1/)). Det krever ingen
API-nøkkel, dekker alle norske adresser, og returnerer koordinater direkte — så
et valgt forslag slipper å geokodes en gang til. For søk som ikke er en norsk
gateadresse faller portalen tilbake på OpenStreetMap Nominatim.

`data/index.json` committes til repoet slik at den hostede nettsiden har noe
å søke i uten å måtte snakke med Dropbox for hvert søk. Kjør `npm run sync`
og commit på nytt hver gang du legger til nye bilder i Dropbox.

## Oppsett

### 1. Installer avhengigheter

```bash
npm install
```

### 2. Opprett en Dropbox-app

1. Gå til <https://www.dropbox.com/developers/apps> → "Create app".
2. Velg **Scoped access**, deretter **Full Dropbox**.
   Ikke velg "App folder": bildene ligger under `Felles`, som er et
   team-område utenfor den personlige mappa.
3. Gå til fanen **Permissions** og huk av:
   - `account_info.read` — brukes til å finne team-navnerommet
   - `files.metadata.read` — mappestruktur og GPS-posisjon
   - `files.content.read` — thumbnails
4. Klikk **Submit** nederst på Permissions-fanen. Dette må gjøres *før* du
   lager et token, ellers mangler tokenet tilgangene og kallene feiler.
5. Kopier **App key** og **App secret** fra Settings-fanen inn i `.env.local`.

### 3. Sett opp miljøvariabler

```bash
cp .env.local.example .env.local
```

Fyll inn `DROPBOX_APP_KEY` og `DROPBOX_APP_SECRET` fra forrige steg, og
eventuelt `DROPBOX_ROOT_FOLDER` (f.eks. `/Områdebilder`).

Hent en refresh token (denne utløper ikke, i motsetning til en vanlig access
token):

```bash
npm run get-dropbox-token
```

Følg instruksjonene i terminalen og lim inn linjen den gir deg i `.env.local`.

### 4. Tilpass kategorier og mappestruktur

Åpne [src/lib/categories.ts](src/lib/categories.ts) og juster nøkkelordene
slik at de matcher dine egne mappenavn i Dropbox. Kategoriene som følger med er
kafé, restaurant, park, fasade, takterrasse og bakgård. Sync-scriptet leter
etter nøkkelordene i mappestien til hvert bilde, og rekkefølgen i fila avgjør
rekkefølgen på sidene i portalen.

For bilder uten GPS-data brukes navnet på mappen bildet ligger i (samt navnet
på foreldremapper) som søketekst mot geokodings-tjenesten. Legg gjerne inn en
by/sted i mappenavnet for bedre treff, f.eks. `Cafe/Kaffebrenneriet Oslo/`.

### 5. Bygg bildeindeksen

Test først på én bydel, så du ser at alt virker før du kjører hele arkivet:

```bash
npm run sync -- "/Oslo/Gamle Oslo"
```

Uten argument skannes hele `DROPBOX_ROOT_FOLDER`:

```bash
npm run sync
```

Selve bildene lastes aldri ned. GPS-posisjon hentes fra Dropbox' egne
bildemetadata, og bilder uten GPS geokodes ut fra mappestien
(«Botsparken, Gamle Oslo, Oslo, Norge»). Geokodingen mellomlagres per mappe,
og er rate-begrenset til ca. ett kall i sekundet uten Google-nøkkel.

### 6. Generer miniatyrer

```bash
npm run thumbs
```

Laster ned én miniatyr per bilde til `public/thumbs`, slik at nettsiden viser
bildene umiddelbart i stedet for å be Dropbox lage dem på nytt ved hvert
sidevisning. Uten dette tar hvert bilde 5–10 sekunder å vise.

Skriptet kan trygt avbrytes og startes på nytt — allerede nedlastede
miniatyrer hoppes over. Bruk `npm run thumbs -- --force` for å lage alle på
nytt.

Mappa er i `.gitignore`, siden den kan bli stor. Se «Hosting» under for hva
det betyr ved deploy.

### 7. Kjør lokalt

```bash
npm run dev
```

Åpne <http://localhost:3000> og søk på en adresse.

### 8. Deploy

Siden er publisert på GitHub Pages: <https://kvitberg.github.io/omradebilder/>

Deploy skjer ved å bygge lokalt og pushe resultatet til `gh-pages`-grenen:

```bash
NEXT_PUBLIC_BASE_PATH=/omradebilder npm run build
cd out && git init -b gh-pages && git add -A && git commit -m "Deploy" \
  && git push -f https://github.com/kvitberg/omradebilder.git gh-pages
```

Automatisk deploy ved push til main ligger klar i `docs-workflow/` — se
`docs-workflow/LES-MEG.md` for hva som mangler før den kan aktiveres.

Miniatyrene i `public/thumbs` committes til repoet, siden byggingen ikke har
Dropbox-tilgang. Nøklene i `.env.local` brukes bare av skriptene lokalt og
skal aldri til GitHub.

## Vedlikehold

Når du legger til nye bilder i Dropbox:

```bash
npm run sync
git add data/index.json
git commit -m "Oppdater bildeindeks"
git push
```

## Design

Portalen er bygget som et redaksjonelt magasin: kremhvit papirflate, hårfin
ramme, stor grotesk tittel og sidetall i footeren. Paletten ligger i
[src/app/globals.css](src/app/globals.css), og oppsettet i
[src/components/portal.tsx](src/components/portal.tsx).

Designet er bevisst låst til den lyse papirflaten uansett systemets mørk
modus — en kremhvit magasinside mister poenget sitt invertert.

## Mangler / ting å vurdere senere

- **Tilgangskontroll**: nettsiden er åpen for alle som har URL-en. Siden den
  viser dine egne bilder, kan det være verdt å legge til enkel
  passordbeskyttelse (f.eks. Vercel's "Password Protection"-funksjon, eller
  en enkel middleware) før du deler lenken bredt.
- **Bilder uten posisjon**: sync-scriptet logger hvor mange bilder som ikke
  fikk noen posisjon. Disse dukker ikke opp i søk — juster mappenavn eller
  legg til flere nøkkelord i `DEFAULT_GEOCODE_REGION`/mappestrukturen.
- **Adresse-lenking** (ikke bygget ennå): et bilde registrert på Rostockgata 86
  skal også dukke opp når noen søker på Rostockgata 88, dersom adressene deler
  tilgang til f.eks. samme takterrasse eller bakgård.
- **Egenskaper ut over kategori** (ikke bygget ennå): merking som
  «barnevennlig», «solrik» eller privat/offentlig tilgang for bakgårder.
