import type { NextConfig } from "next";

// Der Screenshot-Dienst startet Chromium auf dem Server; das Paket muss unverändert eingebunden und mit seinen Binärdateien ausgeliefert werden.
const config: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: { "/api/cron/screenshots": ["./node_modules/@sparticuz/chromium/bin/**"] },
};

export default config;
