import { createHash } from "node:crypto";

/**
 * Filnavnet til en miniatyr.
 *
 * Dropbox-id-er skiller på store og små bokstaver — «…QPHg» og «…QPhg» er
 * to forskjellige bilder. Filsystemet på macOS gjør ikke det, så de to ble
 * én fil på disk. 52 av 4927 bilder kolliderte slik: build-thumbs spurte
 * filsystemet om fila fantes og hoppet over, mens prepare-static leste
 * katalogen og lette etter et eksakt navn — og fant det ikke. 34 bilder
 * falt ut av portalen, og de som ble igjen viste nabobildets miniatyr.
 *
 * Navnene som kolliderer får derfor en kort sjekksum av hele id-en bak
 * seg. Bare de: å legge den på alle ville døpt om 4900 filer som allerede
 * ligger i git uten at det løser noe mer.
 */
export function lagThumbnavn(alleIder: Iterable<string>): (id: string) => string {
  const grunn = (id: string) => id.replace(/^id:/, "").replace(/[^A-Za-z0-9_-]/g, "");

  // Hvilke navn er like når man ser bort fra store og små bokstaver?
  const antall = new Map<string, number>();
  for (const id of alleIder) {
    const k = grunn(id).toLowerCase();
    antall.set(k, (antall.get(k) ?? 0) + 1);
  }

  return (id: string) => {
    const g = grunn(id);
    if ((antall.get(g.toLowerCase()) ?? 0) > 1) {
      const sum = createHash("sha1").update(id).digest("hex").slice(0, 8);
      return `${g}-${sum}.webp`;
    }
    return `${g}.webp`;
  };
}
