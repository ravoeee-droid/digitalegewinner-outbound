import type { Metadata } from "next";
import "./globals.css";
import "./launch.css";
import "./launch-overrides.css";
import "./wcag.css";
import "./wcag-login.css";
import AppFrame from "./ui/AppFrame";

export const metadata: Metadata = {
  title: "Pflege Recruiting OS · Digitale Gewinner",
  description: "Pflege Lead Intelligence, CloudTalk Call Sessions, Kampagnen, High-End Studio V3, Inbox und Sales Pipeline in einem System.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
