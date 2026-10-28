# DG Outbound – Tagesabschluss und Optimierungs-Audit (28.10.2026)

Stand: 28.10.2026, Abend (Europe/Berlin). Quelle: Live-Abfragen in Neon `winter-dream-79461922`, GitHub-Codeprüfung, Vercel-Deployments. Keine Massensends und keine breit angelegten Datenbankänderungen ausgeführt.

## 1. Abschluss der 300 geplanten Loom-Nachrichten

| Kampagne | Geplant am 28.10. | SMTP angenommen (`sent`) | SMTP fehlgeschlagen (`failed`) | Wartend | Compliance-gestoppt |
|---|---:|---:|---:|---:|---:|
| Pflege `pflege-loom-150-v1` | 150 | 150 | 0 | 0 | 0 |
| PV `pv-loom-150-v1` | 150 | 149 | 1 | 0 | 0 |
| **Gesamt** | **300** | **299** | **1** | **0** | **0** |

- Tatsächlicher Versand: 28.10.2026, ca. 07:00–15:55 UTC. `sent` bedeutet SMTP-Providerannahme, nicht Inbox-Zustellung.
- Ein PV-Empfänger war als `info@heat.de%20` kodiert. SMTP antwortete nach drei Versuchen `501 5.1.3 Bad recipient address syntax`. Kein Erfolg, kein automatischer erneuter Versand.
- **33 nachträgliche Bounce-Ereignisse** mit exakter Übereinstimmung zur Empfängeradresse und Kampagnen-Outbox: 16 Pflege, 17 PV. Das sind 33/299 = **11,0 %** der vom SMTP-Provider angenommenen Nachrichten. DSN-Klassifikation und Zustellgründe müssen vor Skalierung manuell stichprobenartig überprüft werden. Maximal 266 der 299 sind bislang nicht als Bounce erfasst; auch diese sind nicht als sicher zugestellt bestätigt.
- Die 300 Datensätze haben 300 verschiedene Lead-IDs und 300 verschiedene normalisierte Empfängeradressen.

## 2. Gemessene Funnel-Kohorte (erste Tagesauswertung)

| Stufe, eindeutige Leads | Pflege | PV | Gesamt |
|---|---:|---:|---:|
| SMTP angenommen | 150 | 149 | 299 |
| Linkklick erfasst (Mensch nicht sicher nachgewiesen) | 38 | 17 | 55 |
| Videoseite ohne Bot-Markierung | 30 | 18 | 48 |
| Videowiedergabe >= 3 s bestätigt | 1 | 3 | 4 |
| 25 %-Meilenstein | 2 | 2 | 4 |
| 50 %-Meilenstein | 2 | 2 | 4 |
| 100 %-Meilenstein | 0 | 1 | 1 |
| Kalender-iframe fokussiert | 1 | 0 | 1 |
| **Bestätigte eindeutige qualifizierte Buchungen** | **0 nachweisbar** | **0 nachweisbar** | **0 nachweisbar** |

Wichtig: Die Funnelstufen sind derzeit nicht strikt monoton, weil ältere YouTube-/MP4-Player unterschiedliche Events emittierten. 25 % und 50 % dürfen daher nicht als Teilmenge der bislang vier 3-Sekunden-Starts interpretiert werden. Ein Klick, eine Kalenderfokussierung oder ein Öffnungspixel ist **keine** bestätigte Buchung. Die Buchungsbestätigung der externen Google-Kalender-Einbettung ist noch nicht durch eine verlässliche, eindeutige Provider-Event-Integration abgesichert. In `er_events` wurden für den 28.10. keine `appointment`-Events gefunden. Der verbundene Google-Kalender zeigte keinen eindeutig DG-Outbound zuordenbaren Buchungstermin.

**Zielwert:** 4 eindeutige, tatsächlich bestätigte und qualifizierte Termine pro Werktag. Bei 300 rechtmäßig versendeten E-Mails wäre das 1,33 %; kein bereits erreichtes Ergebnis und keine Garantie. Wegen verzögerter Buchungen auch 7-/14-/30-Tage-Kohorten verfolgen.

## 3. Kritischer Compliance-Befund

Die Tabelle `outbound_contact_permissions` enthielt **0 Datensätze**. Für keinen der 299 SMTP-angenommenen Leads ist damit eine dokumentierte, verifizierte E-Mail-Berechtigung in diesem System nachweisbar. Im Send-Worker war die Prüfung für die beiden Loom-Kampagnen ausdrücklich umgangen, obwohl die Kampagnenvorbereitung eine Berechtigungsprüfung vorsieht. Die pauschale Freigabe einer Charge ersetzt keine individuelle Rechtsgrundlage.

**Korrektur:** Der finale Versandworker erzwingt jetzt für alle E-Mail-Sendungen die dokumentierte Prüfung und stoppt ohne Freigabe (fail closed). Das kann künftige Sendungen blockieren, bis rechtskonforme Nachweise vorliegen. Keine Berechtigungen wurden erfunden oder automatisch eingetragen. Die heutige, bereits abgeschlossene Charge wurde nicht rückwirkend verändert.

## 4. Umgesetzte Code-Verbesserungen

1. Finale Compliance-Sperre für jeden tatsächlichen E-Mail-Versand; keine Loom-Ausnahme mehr. Ungültige/URL-kodierte Empfänger werden vor SMTP unterdrückt, statt wiederholt fehlzuschlagen.
2. Buchungszuordnung gehärtet: Keine Buchung allein aus `calendar_focus` oder einem beliebigen Betreff ableiten; nur passende vertrauenswürdige Terminbenachrichtigung und exakter Lead-E-Mail-Treffer. Nicht eindeutig zuordenbare Buchungen bleiben ungeklärt statt als Erfolg zu zählen.
3. Native MP4-Player meldet Wiedergabefehler und den 100-%-Meilenstein auch beim `ended`-Event; 3-Sekunden-Start bleibt erhalten.
4. YouTube-Fallback meldet 3 Sekunden durchgehenden PLAYING-Zustand und Player-Fehler, sofern vom eingebetteten Player gemeldet.
5. Direktlink zum Google-Buchungskalender als Fallback unter der Einbettung, besonders für Mobilgeräte/iframe-Probleme. `calendar_open` wird separat von `booking_click` und `appointment` erfasst.
6. Telegram meldet keine passiven Videoseiten-Öffnungen; Website-Interesse wird erst bei mindestens 10 Sekunden gemeldeter Verweildauer oder konkreter Aktion benachrichtigt. Passive Ereignisse kurz nach Versand werden vorsichtiger als mögliche Scanner behandelt.
7. Tracking-Endpunkt vermeidet unnötige Firmen-Datenbankabfragen für nicht meldepflichtige Scroll-/Dwell-/View-Ereignisse.
8. E-Mail-Linkklicks erhalten künftig ein separates `botSuspected`-Merkmal (bekannter Scanner-User-Agent oder extrem früher Klick); **nicht** als sichere Menschenerkennung interpretieren.

## 5. Technische Bestandsaufnahme und offene Prüfungen

- **Neon:** Datenbank ca. 171 MB. `lead_screenshots` ca. 89 MB Gesamtgröße; 1.395 erfolgreiche Screenshots mit im Mittel ca. 62 KB Bilddaten. `er_outbox` ca. 13 MB, `er_events` ca. 2,7 MB. Kein akuter Speicherengpass belegt; Query-Kosten/Compute-Auslastung konnten mangels `pg_stat_statements` nicht auf einzelne Abfragen heruntergebrochen werden. Insbesondere `er_events` hat derzeit keinen dedizierten Index auf `(workspace, lead_id, type, created_at)`; Indexstrategie später separat und ohne ungeplanten breiten Produktions-Write prüfen.
- **Vercel:** Build-/Deploy-Status und Runtime-Logs geprüft. Warnungen zu künftig geänderter PostgreSQL-SSL-Interpretation (`sslmode`) sichtbar. Konkrete Function-Limits, Requestdauer und Verbrauch sind damit noch nicht abschließend gemessen. Es wurden keine Limits erhöht.
- **MP4/Screenshots:** Native Blob-MP4 mit signierten URLs und Range-Fallback ist implementiert; Screenshot-Kompression (JPEG) vorhanden. Am 28.10. wurden für 8 eindeutige Leads insgesamt 20 `video_player_error`-Events (Code 408) beobachtet. Ursachen/Codec/Netzwerk/Browser sind nicht eindeutig belegt. Browser-End-to-End-Tests auf echten Mobilgeräten und tatsächliche externe Kalenderbestätigung stehen aus.
- **Segmentierung:** Die 300 Kampagnenadressen waren intern eindeutig, einfache Namens-Gegenprüfungen ergaben keine offensichtlichen Pflege/PV-Vertauschungen. 79 Unternehmen stammen aus `manual-source` und brauchen weiterhin manuelle Branchenprüfung. Kein blindes Umklassifizieren.
- **Anreden:** 107/150 Pflege- und 113/150 PV-Mails nutzten die neutrale Anrede `Guten Tag,`; die übrigen nutzten erkannte Namen. Die neutrale Anrede ist besser als eine falsche Anrede, liefert aber wenig Relevanz. Keine automatisierte Anrede auf Basis unbestätigter Namen.
- **Replies/Bounces:** Reply-Worker enthält Auto-Reply-Filter, Bounce-Suppression und Opt-out-Erkennung; ein Auto-Reply wurde separat registriert. SMTP-Claim verwendet `FOR UPDATE SKIP LOCKED`; eine `sending`-Recovery nach 15 Minuten bleibt als mögliches Replay-Risiko, falls SMTP angenommen wurde, aber die Statusaktualisierung scheiterte. Provider-idempotente Zustellung ist noch nicht nachgewiesen.
- **A/B:** Für beide Loom-Kampagnen `experiment_id = null` und `campaign_version_id = null`, jeweils nur Variante V. Noch **kein** valider randomisierter A/B-Test. Die mögliche Video-Kohortenzuweisung in der Videoseite ist nicht dasselbe wie ein vollständiges E-Mail-Experiment.

## 6. Priorisierter weiterer Plan (ohne ungeprüfte Aussendung)

1. **P0:** E-Mail-Berechtigungsnachweise und Bounce-Ursachen je Lead/Provider prüfen. Keine automatisierte Wiederaufnahme ohne dokumentierte Freigabe. Invalides PV-E-Mail-Ziel nicht blind korrigieren oder neu anschreiben.
2. **P0:** Verifizierte Terminbestätigung über autorisierte Google-Calendar-Events oder vertrauenswürdigen Booking-Webhook inklusive deduplizierter Event-ID und eindeutigem Lead-Matching. Qualifikation und wahrgenommene Termine separat erfassen.
3. **P1:** Browser-End-to-End-Test (iPhone/Android/Desktop) für Video, 3-Sekunden-Start, Player-Error, 25/50/100 %, iframe, direkten Kalenderlink und bestätigte Testbuchung ohne echten Vertriebskontakt.
4. **P1:** Analyse der 20 Player-Fehler (Code 408), MP4-Faststart, CDN-Range, Timeout und Video-Größe; vor Änderungen reproduzierbare Fehlerfälle erstellen.
5. **P1:** Menschliche Klicks konservativ aus Bot-Merkmalen plus aktiver Videonutzung bewerten; Scanner nicht in Conversion-KPIs mischen. Separate Pflege/PV-Kohorten.
6. **P1:** Relevantere Hooks: Pflege anhand nachgewiesener offener Stelle und mobilem Bewerbungsweg; PV anhand belegter regionaler Leadportal-Abhängigkeit oder Conversion-Lücke. Keine erfundenen Schwachstellen. Kurze, individuelle 30–60-s-Einstiege gegen längeres Video testen.
7. **P2:** Kontrollierter A/B-Test erst nach Compliance-Freigabe: pro Segment randomisierte, unveränderliche Kohorten; primär qualifizierte Buchungen pro rechtmäßig zugestelltem/versendetem Kontakt über 14–30 Tage, sekundär Antworten und echte 3-Sekunden-Starts. Kein automatisches „Gewinner“-Ausrollen bei kleinen Stichproben.
8. **P2:** Follow-up nur bei zulässiger Kontaktaufnahme, menschliche Antworten bevorzugt, eindeutige Sperrlogik und keine mehrfachen Sends. Keine Sendelimiterhöhungen.
9. **P2:** Neon-Index-/Retention-Plan, Runtime-Kosten- und Vercel-Region-Audit, Sender-Reputation, SPF/DKIM/DMARC und DSN-Auswertung.

## 7. Abnahme

**Noch nicht abgeschlossen:** Die 300er-Charge ist abgearbeitet (299 SMTP angenommen, 1 fehlgeschlagen), aber das vollständige Optimierungs-Abnahmekriterium ist nicht erreicht: 0 verifizierte Termine, 0 dokumentierte Kontaktberechtigungen, 33 Bounce-Ereignisse, offene Player-/Mobile-/Booking-End-to-End-Tests. Die einmalige Optimierungsaufgabe darf deshalb noch nicht als vollständig erledigt deaktiviert werden.

## 8. Öffentlicher Browser-Smoke-Test

Am 28.10.2026 wurde die öffentliche PV-Demoseite in einem echten Browser geprüft: Seite lädt; großer Video-Play-Button vorhanden; Google-Calendar-Einbettung zeigt interaktive Datum-/Zeit-Auswahl; keine sichtbare Fehlermeldung. **Nicht bestätigt:** tatsächliche 3-Sekunden-Wiedergabe, mobile Viewport-Darstellung, vollständige Terminbuchung. Der zunächst unter dem 670-px-Kalender platzierte Fallback-Link war im Screenshot nicht sichtbar; deshalb wurde der direkte Kalender-CTA **über** die Einbettung verschoben. Diese neue Position benötigt noch einen erneuten visuellen Test. Es wurde keine Testbuchung erzeugt.
