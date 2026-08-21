import type { Metadata } from "next";
import "./globals.css";
import "./launch.css";

export const metadata: Metadata = {
  title: "Pflege Recruiting OS · Digitale Gewinner",
  description: "Pflege Lead Intelligence, CloudTalk Call Sessions, Kampagnen, Video, Inbox und Sales Pipeline in einem System.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
