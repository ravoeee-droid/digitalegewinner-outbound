import type { Metadata } from "next";
import "./globals.css";
import "./launch.css";
import "./launch-overrides.css";
import "./wcag.css";
import "./wcag-login.css";
import GlobalNav from "./ui/GlobalNav";

export const metadata: Metadata = {
  title: "Pflege Recruiting OS · Digitale Gewinner",
  description: "Pflege Lead Intelligence, CloudTalk Call Sessions, Kampagnen, High-End Studio V3, Inbox und Sales Pipeline in einem System.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>
        <GlobalNav />
        {children}
      </body>
    </html>
  );
}
