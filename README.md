# Digitale Gewinner Outbound OS

Ein integriertes B2B-Outbound-System für Lead Discovery, öffentliche Kontaktanreicherung, Website-Analyse, personalisierte Microsites, Fake-Loom-Videojobs, Multi-Mailbox-Sequenzen, Reply-Sync, Intent Scoring, CRM/Pipeline und No-Show-Recovery.

**Production release:** 2.0.0 · Vercel deployment trigger 2026-08-12

## Kernflow

1. **Lead Finder** sucht Unternehmen über Google Places.
2. **Contact Enrichment** liest ausschließlich öffentlich sichtbare geschäftliche Kontaktdaten der Unternehmenswebsite aus.
3. **Website Radar** bewertet SEO, Conversion, Vertrauen, Technik und Content und erzeugt priorisierte Vertriebs-Talking-Points.
4. **Fake Loom Studio** sendet Website, Analyse, Talking Points und Microsite-URL an den konfigurierten Video Renderer.
5. **Personalisierte Microsite** unter `/a/[id]` zeigt Analyse, Video und Kalender-CTA; Views und CTA-Klicks erhöhen den Intent Score.
6. **Campaign Engine** erstellt Sequenzen mit A/B/C-Varianten und segmentiert nach Branche, Ort, Website Score und Intent Score.
7. **Outbound Worker** verschickt atomar über mehrere Mailboxen, respektiert Mailbox-/Kampagnenlimits, Suppressions und Stop-on-Reply.
8. **Reply Sync** synchronisiert Gmail und Microsoft und stoppt Folgeschritte automatisch.
9. **Pipeline + No-Show Rescue** verfolgt Termine und kann verpasste Termine mit einer kontrollierten 2-Stufen-Sequenz zurückholen.

## Pflicht-Konfiguration für Livebetrieb

Die vollständige Vorlage steht in `.env.example`.

Mindestens erforderlich:

- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `APP_ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `WEBHOOK_SECRET`

Für den vollständigen Acquisition-Flow zusätzlich:

- OpenAI API Key (Env oder verschlüsselter API-Tresor)
- Google Maps / Places API Key
- mindestens eine verbundene Mailbox
- Google/Microsoft OAuth App Credentials oder SMTP Credentials
- `VIDEO_RENDERER_URL` + `VIDEO_RENDERER_SECRET` für Fake Loom

Optional:

- E-Mail-Verifier API Key

## Mailbox-Verbindung

Google und Microsoft werden über den API-Tresor per OAuth verbunden. Nach erfolgreichem OAuth-Callback wird die Mailbox automatisch im Cockpit angelegt bzw. aktualisiert. Environment- und Vault-Credentials werden zusammengeführt; Vault-Werte überschreiben gleichnamige Fallback-Credentials.

Neue Sender starten bewusst mit niedrigem Tageslimit. Das UI-Ramp-up erhöht nur das erlaubte Versandlimit; es erzeugt keine künstlichen Warm-up-Interaktionen.

## Cron-Endpunkte

Die beiden produktiven Worker sind gegen `Authorization: Bearer <CRON_SECRET>` geschützt:

- `/api/cron/send` – Versandqueue
- `/api/cron/replies` – Gmail/Microsoft Reply Sync

Empfohlene Produktionsfrequenz:

- Send Worker: alle 5 Minuten
- Reply Sync: alle 10 Minuten

Die Cron-Schedules müssen im Hosting-Projekt aktiviert werden. Auf Vercel können sie über die Projekt-Cron-Konfiguration angelegt werden.

## Produktions-Readiness

`/api/system/health` prüft getrennt:

- `coreReady` – DB, Login, Encryption, Public URL, Cron/Webhook Secrets
- `outboundReady` – Core + aktive Mailbox + Credentials
- `leadFinderReady` – Google Places
- `aiReady` – OpenAI
- `videoReady` – Fake-Loom Renderer
- `ready` – alle Kern-Capabilities verfügbar

Das Cockpit zeigt diese Readiness ebenfalls im Bereich **Analytics** und **Setup**.

## Sicherheit und Versandlogik

- Admin-Routen sind sessiongeschützt.
- Secrets werden AES-256-GCM verschlüsselt in Postgres gespeichert.
- Website-Audit und Kontakt-Enrichment blockieren private/interne Zieladressen und validieren Redirects.
- Outbox-Jobs werden atomar mit `FOR UPDATE SKIP LOCKED` beansprucht.
- Hängende `sending`-Jobs werden automatisch zurückgesetzt.
- Suppression bei Bounce/Unsubscribe wird serverseitig erzwungen.
- Replies und Termine stoppen weitere reguläre Sequenzschritte.
- Doppelte Enrollment-Versuche für denselben Lead in derselben Kampagne werden verhindert.
- Tageslimits werden serverseitig für Mailboxen und Kampagnen erzwungen.

## Vor dem ersten echten Kunden-Outbound

Einmal vollständig mit einem eigenen Testlead durchlaufen:

`Lead finden → enrichen → Website Radar → Fake Loom → Microsite → Kampagne → echte Testmail → Reply → Stop-on-Reply → Termin → optional No-Show Rescue`

Erst danach Tageslimits schrittweise erhöhen.
