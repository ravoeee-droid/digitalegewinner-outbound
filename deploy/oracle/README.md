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
