import type { NextConfig } from "next";

// Der Screenshot-Dienst startet Chromium auf dem Server; das Paket muss unverändert eingebunden und mit seinen Binärdateien ausgeliefert werden.
const config: NextConfig = {
  // Self-Hosting (z. B. Oracle Cloud): NEXT_OUTPUT=standalone erzeugt ein schlankes Server-Bundle. Auf Vercel bleibt es ungesetzt.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: { "/api/cron/screenshots": ["./node_modules/@sparticuz/chromium/bin/**"] },
};

export default config;
