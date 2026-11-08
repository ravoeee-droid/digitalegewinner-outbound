# Cockpit auf Oracle Cloud (Always Free)

Nur für **DG-MAIN**. `app.env` enthält ausschließlich die DG-Variablen (Supabase `dessavbytgxyygeohjrn`), nie die einer anderen Instanz.

1. VM anlegen (Ubuntu 22.04/24.04, Ampere A1 ARM reicht). In der Oracle-Security-List Ingress für TCP 80 und 443 öffnen, ebenso `sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT` und `--dport 443` (Oracle-Ubuntu-Images blocken standardmäßig).
2. Docker installieren: `curl -fsSL https://get.docker.com | sh`
3. DNS: A-Record `cockpit.<deine-domain>` auf die öffentliche IP der VM.
4. Repo klonen, dann `cd deploy/oracle`.
5. `app.env` anlegen: alle Produktions-Variablen aus dem Vercel-Projekt `digitalegewinner-outbound` (z. B. `DATABASE_URL`, Admin-Auth-Secrets, `CLOUDTALK_*`).
6. `echo "DOMAIN=cockpit.<deine-domain>" > .env`
7. `docker compose up -d --build` (erster Build auf ARM dauert einige Minuten).
8. `https://cockpit.<deine-domain>/call` öffnen. Caddy holt das HTTPS-Zertifikat automatisch.

Update: `git pull && docker compose up -d --build`.

Tipp für Tempo: Server-Region nahe Frankfurt wählen (Supabase-Pooler ist `eu-central-1`), dann sind die Datenbank-Roundtrips minimal.

## Anreicherungs-Worker (läuft dauerhaft mit)

`docker compose up -d --build` startet neben App und Caddy auch `worker`. Er arbeitet rund um die Uhr:

- **Website:** Startseite plus Impressum/Kontakt/Karriere/Team (robots.txt wird beachtet, 1 Anfrage/s je Host): E-Mails, Telefon, Ansprechpartner, Social-Links, Tech-Stack, Tracking, Mobil/HTTPS, Stellen-Signale.
- **Meta Ad Library:** offizielle API, braucht `META_ACCESS_TOKEN`.
- **Google Ads:** per TinyFish-Browser-Agent (`TINYFISH_API_KEY`, Vorrang) oder SerpAPI (`SERPAPI_KEY`).
- **Social:** öffentliche Open-Graph-Daten der auf der Website verlinkten Profile, oder dein Scraping-Anbieter (`SOCIAL_SCRAPER_URL`). Kein Login-Scraping.
- **Lernen (stündlich):** wertet aus, welche Signale zu Termin, Pain, Entwurf oder Info-Mail führen (`lead_learning_signals`) und schreibt einen begrenzten Bonus nach `sales_companies.metadata.learned_boost`. Das Queue-Ranking bleibt unverändert, bis wir den Bonus bewusst anschließen.
- Ergebnisse stehen in `lead_enrichment` (je Firma und Quelle); leere Telefon- und Kontaktfelder werden ergänzt, Vorhandenes nie überschrieben.
- Logs: `docker compose logs -f worker`.

## Schnellstart mit einem Befehl

Auf der frischen VM: `GH_TOKEN=<token> DOMAIN=cockpit.deine-domain.de bash deploy/oracle/bootstrap.sh`. Beim ersten Lauf legt das Skript `app.env` an; Werte eintragen und das Skript erneut starten.
