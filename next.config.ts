import type { NextConfig } from "next";

/**
 * Siden publiseres som statiske filer på GitHub Pages. Det betyr ingen
 * server: søk, adresseforslag og forsidebilde kjører i nettleseren, og
 * Dropbox brukes bare av synkroniseringsskriptene lokalt.
 *
 * Pages serverer prosjektsider fra /<repo>/, så basePath settes fra
 * miljøvariabel under bygging og er tom lokalt.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  images: { unoptimized: true },
  // Pages leter etter <mappe>/index.html når URL-en ikke har filendelse.
  trailingSlash: true,
};

export default nextConfig;
