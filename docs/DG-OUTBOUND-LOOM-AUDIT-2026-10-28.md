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


## 9. Zweiter Prüfstand (28.10.2026, 23:40 Asia/Bangkok)

- Live-Neon-Abfrage bestätigt unverändert: `pflege-loom-150-v1` 150 `sent`, 0 `failed`; `pv-loom-150-v1` 149 `sent`, 1 `failed`. Insgesamt **299 SMTP-angenommen, 1 fehlgeschlagen, 0 wartend**. `sent` bedeutet keine nachgewiesene Inbox-Zustellung.
- `outbound_contact_permissions` weiterhin **0** Datensätze. Compliance-Blockade für künftige Kontakte bleibt bestehen; keine Kontakte freigegeben und kein Versand gestartet.
- Seit 15:00 UTC in `er_events`: 5 `video_play_confirmed`-Ereignisse von 3 eindeutigen Leads und 9 `video_progress`-Ereignisse von 3 Leads; keine `appointment`-Events in dieser jüngeren Teilmenge. Über den gesamten heutigen Zeitraum wurde 1 `video_calendar_focus` registriert; dies ist keine Buchung.
- Über den heutigen Zeitraum: 35 `bounce`-Events insgesamt, davon im früheren Kampagnenabgleich 33 eindeutig den beiden Loom-Chargen zugeordnet. Nicht pauschal alle 35 als heutige Kampagnen-Bounces zählen. 20 `video_player_error`-Events, alle mit Wert 408, von 8 Leads. Ursache weiter offen.
- **Neue technische Verbesserung:** Im Video-Tracking-Endpunkt wird die Datenbankabfrage nach dem Versandalter nur noch bei passiven Events ohne bekannten Bot-User-Agent ausgeführt. Aktive Ereignisse (Play, 3-Sekunden-Bestätigung, Progress, Kalender) behalten dieselbe Scanner-/Event-Semantik, benötigen aber diese Abfrage nicht mehr. Commit `b4155fc321a52c613cc2a4312392430cd0274f77`. Vercel-Build erfolgreich, Production-Deployment `dpl_HHxYkqMppwmHybGxtiv3yzMzoyKu` **READY**. Tatsächliche Einsparung bei Neon-Compute noch nicht quantitativ gemessen.
- Live-HTTP-Prüfung aus dieser Ausführungsumgebung war wegen DNS-/Netzwerkauflösung nicht möglich. Die frühere öffentliche Browser-Smoke-Prüfung deckte weder echte mobile Wiedergabe noch eine abgeschlossene Buchung ab; diese offenen End-to-End-Tests sind weiterhin **nicht bestanden bzw. nicht nachgewiesen**.
- Keine Änderung an SMTP-Limits, Kontaktfreigaben, aktiven Kampagnen oder Empfängerstatus. **4 eindeutige qualifizierte Buchungen sind nicht nachgewiesen.** Optimierungsaufgabe bleibt wegen Compliance-Nachweisen, Bounce-Analyse, Player-Fehlern und Buchungsbestätigung offen.


## 10. Dritter Prüfstand (29.10.2026, ca. 01:22 Asia/Bangkok)

- Erneute Live-Abfrage von `er_outbox` nach beiden Kampagnen: Pflege 150 `sent`, PV 149 `sent` und 1 `failed`; 0 wartend. Versendete Zeitspanne 28.10. 07:00–15:55 UTC. `sent` ist nur SMTP-Annahme, keine bestätigte Inbox-Zustellung. 33 der insgesamt 35 Bounce-Ereignisse vom 28.10. sind den beiden Loom-Kampagnen eindeutig zugeordnet.
- `outbound_contact_permissions`: weiterhin 0 Einträge; die finale Compliance-Sperre darf nicht aufgehoben werden. Keine zusätzlichen Mails, Freigaben, Retries oder Limitänderungen durchgeführt.
- Seit 28.10. 00:00 UTC: 8 `video_play_confirmed`-Ereignisse von 6 Leads; 22 `video_progress`-Ereignisse von 7 Leads (alle Kampagnen), 1 `video_calendar_focus`, keine `appointment`-Events. Events sind keine bestätigten Buchungen. Nach Kampagnen-Lead-ID-Join: 33 Bounce-Ereignisse, 8 Play-Bestätigungen von 6 Leads, 17 Progress-Ereignisse von 6 Leads. Unterschiedliche Eventdefinitionen älterer Player-Implementierungen beachten.
- **Neue Fehleranalyse:** 20 Player-Error-Ereignisse (Code 408) von 8 Leads traten zwischen 51 und 377 Sekunden nach dem jeweiligen SMTP-Send auf. Bei 6 der 8 Leads wurde keinerlei `video_play_intent` protokolliert, bei 2 Leads schon. Mehrere dieser frühen Seitenbesuche wurden als `bot=true` markiert. Daher dürfen die 20 Events **nicht** als 20 nachgewiesene menschliche Wiedergabefehler interpretiert werden. Echte Playerprobleme bleiben möglich; ohne Browser-/Netzwerkdiagnose ist die Ursache nicht geklärt.
- **Neue abgesicherte Codekorrektur:** `app/v/[id]/track.ts` verwendet die `sessionStorage`-Sitzungs-ID jetzt pro signiertem Lead-Token statt einer globalen ID pro Browser-Tab. Beim Wechsel zwischen Lead-Links werden Sitzungen dadurch nicht versehentlich zusammengeführt. Falls `navigator.sendBeacon` die Aufnahme ablehnt (Rückgabewert `false`), fällt Tracking auf `fetch(..., keepalive:true)` zurück. Commit `decd1775a1365e297b9c297b501b946d8c55ebe8`; Vercel-Production-Deployment `dpl_CmMUF1rWWBYSfCFB6fdWBzsPtcg8` wurde als `READY` geprüft. Keine Änderungen am Versandpfad.
- **Neuer öffentlicher Desktop-Smoke-Test (1280 × 980):** `https://app.digitalegewinner.de/v/demo?segment=pv` lädt; Play-Button nimmt Klick an; direkter Kalender-CTA und eingebettete Google-Kalender-Datum-/Zeitauswahl sind sichtbar und interaktiv. Der Test konnte **keine sichtbare Video-Wiedergabe über mindestens 3 Sekunden** bestätigen; nach dem Klick befand sich die Ansicht am Kalenderanker. Ein tatsächlicher Playerdefekt ist damit weder bewiesen noch ausgeschlossen. Es wurde kein Termin gebucht. Mobile, Provider-Buchungsbestätigung und der neue Session-Key unter realer Nutzung bleiben ungetestet.
- **Abnahme weiterhin offen:** 0 nachweisbar bestätigte qualifizierte Buchungen; 0 dokumentierte Kontaktfreigaben; 33 kampagnenbezogene Bounce-Ereignisse; Player- und Mobile-End-to-End-Test sowie eindeutige Booking-Integration fehlen. Die Optimierungsaufgabe bleibt aktiv, ohne rechtlich ungeprüften Versand zu reaktivieren.


## 11. Vierter Prüfstand (29.10.2026, ca. 02:09–02:20 Asia/Bangkok)

- **Versandabschluss nochmals direkt geprüft:** `er_outbox` enthält Pflege 150 `sent`; PV 149 `sent`, 1 `failed`; in den beiden Loom-Kampagnen keine `queued`, `sending` oder `stopped`. Die geplanten `scheduled_at`-Datensätze vom 28.10. stimmen damit überein. SMTP-Annahme ist keine bestätigte Inbox-Zustellung. Es wurde keine neue Mail ausgelöst.
- **Compliance:** `outbound_contact_permissions` enthält unverändert 0 Datensätze. Finale Sendesperre bleibt aktiv; keine Rechtsgrundlagen oder Empfängerfreigaben erzeugt.
- **Kohorte nach tatsächlicher Loom-Outbox, eindeutige Leads, seit 28.10. 00:00 UTC:** Pflege 150 sent / 39 Linkklick / 32 nicht als Bot markierte Videoseitenbesuche / 2 bestätigte 3-Sekunden-Starts / 3 mit >=25 % / 3 mit >=50 % / 1 mit 100 % / 1 Kalenderaktion / 16 Bounces. PV 149 sent / 18 Linkklick / 19 nicht als Bot markierte Videoseitenbesuche / 4 bestätigte 3-Sekunden-Starts / 3 mit >=25 % / 2 mit >=50 % / 1 mit 100 % / 0 Kalenderaktionen / 17 Bounces. **Gesamt: 6 bestätigte Starts, 2 vollständig abgespielte Videos, 1 Kalenderaktion, 0 nachweisbar gebuchte qualifizierte Termine.** Ereignisstufen sind wegen unterschiedlicher älterer Player-Versionen und Bot-Kennzeichnung nicht streng monoton.
- **Scanner-Befund:** Von 156 Linkklick-Events der beiden Loom-Kampagnen haben nur 3 das neuere Feld `botSuspected` (alle `false`). 74/156 Klicks erfolgten innerhalb von 90 Sekunden nach SMTP-Annahme (Pflege 52/117, PV 22/39). Diese können Scanner sein, aber auch echte Menschen; weder alle 156 Klicks noch die 3 neu klassifizierten Klicks dürfen als nachgewiesene menschliche Klicks bezeichnet werden. Die historischen Events enthalten nicht genug User-Agent-Daten für eine sichere rückwirkende Klassifikation.
- **Neuer konkreter Datenqualitätsfehler:** In der PV-Loom-Charge wurde die offensichtliche Platzhalteradresse `abc@xyz.com` als Kontakt von „Dufter PV-Systeme GmbH“ tatsächlich vom SMTP-Provider angenommen und später als Bounce erfasst. Dieser Datensatz zählt **nicht** als validierter echter Geschäftskontakt. Die 33 Bounces sind weiterhin eindeutig mit Kampagnen-Outbox und Empfängeradresse verknüpft, enthalten aber diesen Test-/Platzhalterfall.
- **Abgesicherte Sendepfad-Korrektur:** In `app/api/cron/send/route.ts` werden stale `sending`-Claims nach 15 Minuten künftig als `stopped` mit Hinweis auf unklare SMTP-Zustellung markiert, statt automatisch neu in die Warteschlange gelegt. Damit werden mögliche Doppelversendungen nach Crash zwischen Providerannahme und Statusspeicherung verhindert; Providerabgleich und manuelle Freigabe sind vor jedem Retry nötig. Außerdem werden eindeutig erkennbare Platzhalter-/Beispieladressen (einschließlich exakt `abc@xyz.com`) vor SMTP gesperrt. Die bereits abgeschlossene Charge wurde nicht geändert. Commit `1448d95513422e4083a5e1bb71c87fa77561855e`.
- **Buchungsabgleich:** Im Tracking keine `appointment`-Events seit 28.10. Der verbundene primäre Google-Kalender und der freigegebene Teamkalender enthalten bis 12.11. keine eindeutig der Loom-Charge zuordenbare Buchung. Ein anderer freigegebener Kalender enthält fremde Termine, die nicht als DG-Outbound-Buchungen gewertet werden. Keine Testbuchung erzeugt.
- **Weiterhin offen:** Reale iOS-/Android-Videowiedergabe, eindeutige Provider-Buchungsbestätigung, DSN-/Bounce-Ursachen, 20 Player-Error-Events, Kontaktfreigaben, Replay-Abgleich bereits unklarer Sendungen, systematische Query-/API-Kostenmessung und kontrollierter A/B-Test. Keine Sendelimiterhöhung und keine Massenänderungen. Das 4-Termine-Ziel ist nicht erreicht und nicht als erledigt zu melden.
