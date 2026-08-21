import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pflege Recruiting Outbound OS",
  description: "Lead Intelligence, Recruiting-Radar, personalisierte Outreach-Kampagnen, Fake Loom, Inbox und Sales CRM für die Pflegebranche.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
