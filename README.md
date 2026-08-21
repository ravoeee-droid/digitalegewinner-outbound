# Pflege Recruiting Outbound OS

Eine eigenständige Branchenversion des High-End-Outbound-Systems für die Akquise von **ambulanten Pflegediensten und Pflegeanbietern**.

Die Installation verbindet Lead Discovery, öffentliches Kontakt-Enrichment, Website- und Recruiting-Analyse, personalisierte Microsites/Fake-Loom-Videos, Multi-Mailbox-Sequenzen, Reply-Sync, CRM/Pipeline und No-Show-Recovery.

## Pflege-spezifischer Kernflow

1. **Pflege Lead Finder** sucht Pflegedienste und Pflegeanbieter über Google Places.
2. **Contact Enrichment** liest ausschließlich öffentlich sichtbare geschäftliche Kontaktdaten der Unternehmenswebsite aus.
3. **Website Radar** prüft SEO, Conversion, Vertrauen, Technik und Content.
4. **Pflege Recruiting Intelligence** bewertet den sichtbaren Bewerber-Einstieg zusätzlich auf:
   - Karriere-/Job-Einstieg
   - Bewerbungs-CTA
   - Arbeitgeberpositionierung und Benefits
   - Mitarbeiter-/Arbeitgeber-Proof
   - reibungsarme Schnellbewerbung
   - Mobile Readiness
   - Social-Media-Verknüpfung
   - Vertrauenssignale
5. Daraus entstehen **Recruiting-Reife**, **Recruiting Opportunity Score**, konkrete Recruiting-Gaps, Talking Points und ein empfohlenes Angebot.
6. **Fake Loom Studio** kann Analyse, Website und Microsite in einen personalisierten Video-Workflow geben.
7. **Campaign Engine** erstellt Pflege-spezifische Sequenzen und kann KI-Varianten generieren.
8. **Outbound Worker** verschickt über mehrere eigene Mailboxen mit Tageslimits, Suppressions und Stop-on-Reply.
9. **Reply Sync + Inbox** synchronisieren Antworten.
10. **Pipeline + No-Show Rescue** verfolgen Termine bis zum Abschluss.

## Wichtig beim Teilen

Dieses Repository enthält **keine produktiven Zugangsdaten**. Die Datei `.env.example` enthält ausschließlich Platzhalter.

Jede neue Installation benötigt eigene Infrastruktur und eigene Zugangsdaten. Dadurch kann diese Version als ZIP weitergegeben oder in ein separates Repository kopiert werden, ohne Datenbank, Leads, Mailboxen oder API-Zugänge der ursprünglichen Installation mitzuteilen.

## Schnellstart

```bash
npm install
cp .env.example .env.local
npm run dev
```

Danach mindestens folgende Werte setzen:

- `DATABASE_URL`
- `ADMIN_PASSWORD`
- `APP_ENCRYPTION_KEY`
- `NEXT_PUBLIC_APP_URL`
- `CRON_SECRET`
- `WEBHOOK_SECRET`

Für den Pflege-Lead-Finder:

- `GOOGLE_MAPS_API_KEY`

Für KI-Kampagnen optional:

- `OPENAI_API_KEY`

Für den echten Versand:

- mindestens eine eigene Google-/Microsoft-/SMTP-Mailbox
- passende OAuth- oder SMTP-Credentials

Für Fake Loom optional:

- `VIDEO_RENDERER_URL`
- `VIDEO_RENDERER_SECRET`

## Datenbank

Die vorhandenen SQL-Migrationen unter `supabase/migrations` auf einer **neuen, leeren Postgres-/Supabase-Datenbank** ausführen. Nicht die Datenbank der ursprünglichen Installation teilen.

## Erste Inbetriebnahme

1. Neue Postgres-/Supabase-Datenbank erstellen.
2. Migrationen ausführen.
3. `.env.example` als Vorlage verwenden und eigene Secrets setzen.
4. Anwendung deployen, z. B. über Vercel.
5. Unter **Setup / API Vault** eigene Google-Places-, OpenAI- und Mailbox-Verbindungen einrichten.
6. Im **Pflege Lead Finder** mit einer Suchanfrage wie `Pflegedienst Stuttgart` testen.
7. Einen Lead importieren und den Recruiting Opportunity Score prüfen.
8. Eine eigene Mailbox verbinden.
9. Zuerst mit einem eigenen Testlead die gesamte Journey testen:

`Pflege Lead Finder → Recruiting Analyse → Microsite/Fake Loom → Kampagne → Testmail → Reply → Stop-on-Reply → Termin → Pipeline`

Erst danach echte Versandlimits schrittweise erhöhen.

## Scoring verstehen

- **Recruiting-Reife 0–100:** Wie gut der sichtbare digitale Bewerber-Einstieg bereits aufgebaut ist.
- **Recruiting Opportunity 0–100:** Wie groß der aktuell erkennbare Optimierungshebel ist. Ein hoher Opportunity Score bedeutet nicht automatisch Kaufbereitschaft, sondern einen starken sichtbaren Ansatzpunkt für ein qualifiziertes Gespräch.
- **Intent Score:** Reaktionen innerhalb des Outbound-Systems, etwa Microsite-Views oder CTA-Interaktionen.

## Empfohlene Angebotslogik

Bei hoher Opportunity:

**Karriere-Landingpage + Employer Branding + Schnellbewerbungs-Funnel + Social Recruiting**

Bei mittlerer Opportunity:

**Employer-Branding-Optimierung + Bewerber-Funnel + Social Recruiting**

Bei bereits starker Recruiting-Basis:

**Recruiting-Conversion-Audit + gezielte Social-Recruiting-Kampagne**

## Sicherheit

- Admin-Routen sind sessiongeschützt.
- Secrets werden serverseitig gespeichert bzw. verschlüsselt.
- Reale Secrets gehören nie in GitHub oder in eine ZIP-Datei.
- Website-Audit und Kontakt-Enrichment arbeiten mit öffentlich erreichbaren Unternehmensseiten.
- Suppression bei Bounce/Unsubscribe wird serverseitig berücksichtigt.
- Replies und Termine stoppen reguläre Folgeschritte.
- Versandlimits werden serverseitig erzwungen.

## Branch

Diese Pflege-Version lebt separat auf:

`feature/pflege-outbound-system`

Die ursprüngliche `main`-Version bleibt unverändert.
