import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  // Lenken skal kunne deles, men ikke dukke opp i søkemotorer.
  robots: { index: false, follow: false },
  title: "Områdebilder",
  description:
    "Et fotografisk arkiv over nabolag — kafeer, restauranter, parker, fasader, takterrasser og bakgårder, søkbart på adresse.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="no" className={`${archivo.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-paper text-ink">{children}</body>
    </html>
  );
}
