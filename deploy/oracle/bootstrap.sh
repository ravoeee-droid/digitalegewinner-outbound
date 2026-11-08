#!/usr/bin/env bash
# Einmal-Setup für eine frische Oracle-Ubuntu-VM (nur DG-MAIN).
# Aufruf:  GH_TOKEN=<GitHub-Token mit Repo-Lesezugriff> DOMAIN=cockpit.deine-domain.de bash bootstrap.sh
set -euo pipefail
: "${GH_TOKEN:?GH_TOKEN setzen}" "${DOMAIN:?DOMAIN setzen}"
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || { sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT; sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT; command -v netfilter-persistent >/dev/null && sudo netfilter-persistent save || true; }
[ -d dg ] || git clone --branch claude/awesome-bardeen-pq7oeb "https://x-access-token:${GH_TOKEN}@github.com/ravoeee-droid/digitalegewinner-outbound.git" dg
cd dg/deploy/oracle
[ -f app.env ] || { cp app.env.example app.env; echo "→ app.env angelegt: jetzt Werte eintragen (nano app.env), dann Skript erneut starten."; exit 0; }
echo "DOMAIN=${DOMAIN}" > .env
sudo docker compose up -d --build
echo "Fertig: https://${DOMAIN}/call · Logs: sudo docker compose logs -f worker"
