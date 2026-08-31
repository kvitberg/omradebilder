import fs from "node:fs/promises";
import path from "node:path";
import Portal from "@/components/portal";

/**
 * Tallene i footeren leses fra den publiserte indeksen ved bygging. Siden
 * eksporteres statisk, så det finnes ingen forespørsel å lese dem på — de
 * oppdateres neste gang `npm run build` kjører.
 */
async function readPublished(): Promise<{ count: number; updatedAt: string | null }> {
  try {
    const raw = await fs.readFile(
      path.join(process.cwd(), "public", "data", "index.json"),
      "utf-8"
    );
    const data = JSON.parse(raw) as { generatedAt: string | null; photos: unknown[] };
    return { count: data.photos.length, updatedAt: data.generatedAt };
  } catch {
    return { count: 0, updatedAt: null };
  }
}

export default async function Home() {
  const { count, updatedAt } = await readPublished();
  return <Portal photoCount={count} updatedAt={updatedAt} />;
}
