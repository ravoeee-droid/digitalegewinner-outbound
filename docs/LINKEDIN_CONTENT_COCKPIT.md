# LinkedIn Content Cockpit – DG Outbound (MVP)

**Status:** Feature-Branch, noch nicht live. Textbeiträge und Zeitplanung sind vorbereitet; der LinkedIn-OAuth-Test steht aus.

## Funktionen

- Admin-Oberfläche unter `/outbound/linkedin`
- Entwürfe, Terminplanung und Stornierung
- Eigenständige Postgres-Tabelle `dg_linkedin_posts`
- Offizielle LinkedIn-API (OAuth Authorization Code Flow + `w_member_social`)
- Authentifizierter Cron-Worker unter `/api/cron/linkedin`, prüft fällige Veröffentlichungen
- Access Token in bestehendem verschlüsseltem DG-Secret-Tresor
- Unklare Veröffentlichungen werden mit `uncertain` gekennzeichnet: **keine automatischen Doppelposts**

## Einmalige Einrichtung

1. Auf https://www.linkedin.com/developers/ eine LinkedIn-App erstellen.
2. Produkte **Sign In with LinkedIn using OpenID Connect** und **Share on LinkedIn** aktivieren.
3. OAuth Redirect URL hinterlegen: `https://DEINE-DG-OUTBOUND-DOMAIN/api/linkedin/oauth/callback`.
4. Ausschließlich im Vercel-Projekt `digitalegewinner-outbound` diese Umgebungsvariablen setzen:
   - `LINKEDIN_CLIENT_ID` und `LINKEDIN_CLIENT_SECRET`
   - `NEXT_PUBLIC_APP_URL` (bereits vorhandene DG-Domain ohne Schrägstrich am Ende)
   - bestehende `APP_ENCRYPTION_KEY`, `DATABASE_URL` bzw. `POSTGRES_URL` und `CRON_SECRET`
   - optional `LINKEDIN_API_VERSION` (Standard 202609; regelmäßig aktualisieren)
5. Als Admin `/outbound/linkedin` aufrufen, auf **LinkedIn verbinden** klicken und Zugriff erlauben.
6. Cron in `vercel.json` aktivieren (alle 5 Minuten) und einen **einzigen Testpost** planen.
7. Veröffentlichten Testbeitrag und gespeicherte Post-URN prüfen. Erst danach schrittweise Metricool ersetzen.

## Einschränkungen und Schutzmechanismen

- **Keine Zugangsdaten im Repository speichern.** Das GitHub-Repository ist öffentlich.
- Die Verbindung benötigt immer die ausdrückliche LinkedIn-OAuth-Freigabe des Kontoinhabers.
- Token laufen ab; erneute Verbindung vor Ablauf nötig. Ein automatischer Refresh ist noch nicht implementiert.
- Die Oberfläche ist in Version 1 auf Textbeiträge beschränkt. Medien, KI-Generierung, Freigaben und Beitragsstatistiken folgen gesondert.
- Leserichtung von fremden LinkedIn-Beiträgen/Kommentaren und eigene umfassende Analytics können zusätzliche, teils eingeschränkte API-Berechtigungen benötigen.
- Beiträge aus dem bestehenden Metricool-Plan (15.–21.10.: 56 Posts) werden **nicht importiert**, um Doppelpostings zu vermeiden.
- LinkedIn begrenzt API-Nutzung. Acht Beiträge täglich sind ein Test, keine zugesicherte Reichweite oder Veröffentlichungsgarantie.
- Der Worker markiert ungeklärte Netzwerk-/Serverfehler als `uncertain`; manuelle Kontrolle erforderlich, **kein automatisches Retry**.
- Ausfall von Datenbank, App oder Cron verhindert automatische Veröffentlichungen. Monitoring nach Live-Schaltung ergänzen.
