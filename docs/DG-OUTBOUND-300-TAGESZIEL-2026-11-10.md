# DG Outbound – Diagnose und Umbau auf 300 Mails/Tag (10.11.2026)

Quelle: Vercel-Runtime-Logs (`[send]`, `[loom-campaigns]`, `[screenshots]`, `[ba-leads]`), GitHub-Actions-Logs, Code. Keine Datenbankabfrage aus dieser Session.

## Befund „läuft nicht“

| Beobachtung | Ursache |
|---|---|
| 09.11. und 10.11.: exakt 100 Mails um 08:00–08:05, danach jeder Lauf nur `limited` | Postfach-Tageslimit (Default 5, UI-Wert) × Postfächer = 100. Die ~500 wartenden PV-Mails wurden stündlich neu eingeplant. |
| `[loom-campaigns]` Pflege: `no_screenshot_ready_unsent_recipients`, readiness 94 Pflege + 107 PV Leads `needs_screenshot`, `[screenshots]` liefert `candidates: 0` | Screenshot endgültig fehlgeschlagen (4 Versuche) oder keine Website. Der Versandworker hat solche Loom-Mails dauerhaft unterdrückt. |
| `[ba-leads]` jeder zweite Lauf `timeout exceeded when trying to connect` | pg-Pool `connectionTimeoutMillis: 5000`, Neon-Pooler braucht nach Leerlauf länger. Nachschub nur ~30–40 Pflege und ~1–10 PV Leads/Tag. |
| GitHub-Workflow „Outbound heartbeat“ seit mindestens 07.11. rot, HTTP 401 | Repository-Secret `APP_CRON_SECRET` ist leer. Der Vercel-Cron (`*/15 6-16`) läuft unabhängig weiter. |
| 0 Termine bei 299 Mails (28.10.): 55 Klicks, 6 bestätigte Starts, 1 Kalenderaktion | Einstufige Kampagne ohne Nachfass, Mail ohne Nutzenaussage, einzige Handlung = Kalender auf der Videoseite. |

## Änderungen

1. **Send-Worker** (`app/api/cron/send/route.ts`)
   - `OUTBOUND_DAILY_EMAIL_TARGET` (Standard 300) wird auf die freigegebenen DG-Postfächer verteilt; deren Tageslimit ist mindestens dieser Anteil (10 Postfächer → 30/Tag), Obergrenze 100.
   - Pro Lauf wird nur so viel gesendet, dass das Limit bis 17:30 erreicht wird (2–8 je Postfach und Lauf) statt alles um 08:00.
   - Loom-Mails ohne Screenshot werden zurückgestellt (2 h), nicht mehr unterdrückt; ist der Screenshot endgültig nicht erzeugbar, geht die Mail ohne Website-Bild raus (`LOOM_REQUIRE_SCREENSHOT=strict` schaltet zurück). Früher deshalb unterdrückte Mails werden wieder eingereiht, alle anderen Prüfungen (Compliance, Sperrliste, Segment) laufen unverändert.
   - Log und Antwort enthalten die Bremsgründe (`limitReasons`), `sentToday` und Ziel. Telegram-Alarme: Warteschlange leer ab 11:00, Limits bremsen, Tagesziel verfehlt (jeweils einmal pro Tag).
2. **Loom-Kampagne** (`lib/loom-campaign-launch.ts`)
   - Neuer Erstkontakt: Betreff „Eine Idee für … bei {Firma}“, ein Satz Nutzen, Video, Antwort-Aufforderung („Ja“ → zwei Terminvorschläge, „Nein“ → Ende). Noch nicht versendete Erstkontakte werden auf diese Fassung gehoben.
   - Nachfass-Sequenz: F1 nach 3 Tagen, F2 nach weiteren 4 Tagen, gleiches Postfach, „Re:“-Thread. Nur ohne Antwort/Termin/Bounce/Abmeldung/Sperre, Compliance-Prüfung erneut. `LOOM_FOLLOWUPS=off` schaltet ab.
   - Die 150 neuen Betriebe je Segment zählen nur Erstkontakte; Nachfassmails kommen obendrauf, gedeckelt durch die Kampagnenlimits (150 je Kampagne).
3. **Datenbank** (`lib/db.ts`): Verbindungs-Timeout 5 s → 15 s.

## Was noch manuell zu tun ist

- GitHub-Secret `APP_CRON_SECRET` auf den Wert von `CRON_SECRET` setzen (oder den Workflow löschen).
- Postfach-Tageslimits in „Domains & Mail“ auf 30 setzen, damit UI und Worker dasselbe zeigen.
- Deliverability beobachten: 30/Tag pro Postfach bei 11 % Bounce (28.10.) ist riskant; Bounce-Quote im Tagesbericht und Telegram prüfen, bei > 5 % Ziel senken.
- Nachschub: ~50 neue erlaubte Leads/Tag reichen für 300/Tag nur mit Sequenz (3 Mails je Lead). Dauerhaft braucht es ~100 neue Leads/Tag (ba-leads nach dem Timeout-Fix beobachten).
