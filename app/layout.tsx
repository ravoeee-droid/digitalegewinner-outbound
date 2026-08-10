import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EnergyRadar AI",
  description: "Lead Intelligence, Campaign Engine, Energy Intelligence und Sales CRM in einer Plattform.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
