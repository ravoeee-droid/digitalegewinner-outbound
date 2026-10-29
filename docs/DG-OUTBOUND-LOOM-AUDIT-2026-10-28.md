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


## 12. Vierter Prüfstand – zusätzlicher Live-Video-Test und Fehlerbehandlung

- **Neuer reproduzierter Fehler vor der Änderung:** Auf `https://app.digitalegewinner.de/v/demo?segment=pv` wurde nach Play `NotSupportedError: The element has no supported sources (code=4, ready=0, network=3)` angezeigt. Der Videoplayer spielte im Testbrowser keine drei Sekunden ab. Die Seite und der Kalender-CTA funktionierten.
- **Speicher-/Codec-Diagnose:** `/api/t/media/demo?segment=pv&diagnose=1` lieferte `ok=true`, HTTP 206, 1.024 Byte, `Content-Range: bytes 0-1023/10403079`, `video/mp4`. Der Codec-Test fand `moov` früh in der Datei und `avc1` (H.264) im ersten 64-KB-Bereich. Das belegt den erfolgreichen Byte-Range-Zugriff und ein kompatibles Videoformat-Indiz, aber **keine erfolgreiche Wiedergabe**.
- **Neue Video-Resilienz-Korrektur:** `app/v/[id]/page.tsx` verwendet nun die bestehende autorisierte, Range-fähige interne Media-Route statt des im Browser fehlgeschlagenen direkten Private-Blob-Presign-Links. `NativeLoomPlayer.tsx` schaltet bei nativen Player-Fehlern auf die vorhandene YouTube-Facecam zurück und behält deren 3-Sekunden-Tracking. Commits `8d238b81ea947ff621eb141ce8e2159df86dbb16` und `1a76a56b936fae2515e9644ed104a35a62f2a612`. Der finale Vercel-Build `dpl_5uQuTGpGZ9acYg3jZYw221GVq88V` war READY.
- **Live-Nachtest nach Deployment:** Native Wiedergabe über mindestens drei Sekunden **weiterhin nicht bestätigt**. Die YouTube-Fallback-Oberfläche wurde sichtbar; YouTube verlangte im automatisierten Browser jedoch eine Anti-Bot-Bestätigung, wodurch auch dort keine erfolgreiche Wiedergabe belegt wurde. Das ist ein realer Abnahmeblocker, aber kein sicherer Beweis, dass der Player bei normalen Nutzern immer versagt. Kalender-CTA und eingebettete Buchungsstrecke waren weiterhin sichtbar. Kein Termin gebucht.
- **Priorität P0:** MP4-Abspielbarkeit auf einem normalen Chrome-/Safari-Gerät mit Netzwerkprotokoll und korrekter Range-/Codec-Diagnose nachweisen; falls die interne Media-Route tatsächlich nicht abspielbar ist, die Ursache beheben, bevor weitere Outreach-Chargen freigegeben werden. Die bisherige Codekorrektur ist eine Fallback-Verbesserung, **kein nachgewiesener vollständiger Fix**.


## 13. Fünfter Prüfstand (29.10.2026, ca. 03:26–03:45 Asia/Bangkok)

- **Tagescharge direkt in Neon nach `campaign_id`, `status` und deutschem `scheduled_at`-Kalendertag verifiziert:** 28.10.2026, Pflege 150 `sent`, PV 149 `sent` und 1 `failed`; keine offenen `queued`/ `sending`-Nachrichten. `sent` bleibt ausschließlich SMTP-Annahme, nicht bestätigte Zustellung.
- **Compliance unverändert:** `outbound_contact_permissions` enthält 0 Zeilen. Keine Freigaben, Limits, Retries, Massensends oder Empfängeränderungen vorgenommen.
- **Termine:** Seit 28.10. 0 `appointment`-/`booking_confirmed`-Events. Der primäre Google-Kalender zeigte im Fenster 28.10.–12.11. einen generischen Termin am 28.10. ohne DG-/Lead-Zuordnung; der gemeinsame Kalender keine Termine. Der generische Termin wird ausdrücklich **nicht** als Outbound-Buchung gezählt. 0 eindeutige qualifizierte Buchungen nachweisbar.
- **Bounce-Klassifikation:** 33 den Loom-Chargen zugeordnete Bounce-Events, aber **kein einziges** davon enthält `reason`, `diagnosticCode` oder `smtpCode` in `er_events.meta`. Die Ursachen (harte Adresse, temporär, Policy) sind aus diesen Daten nicht beweisbar. 20 ältere Player-Error-Events mit Wert 408 von 8 Leads; weiterhin nicht als 20 menschliche Fehler interpretieren.
- **Neuer echter öffentlicher Browser-Test vor Fix:** Auf `https://app.digitalegewinner.de/v/demo?segment=pv` wurde der Play-Button betätigt; Pause erschien kurz, nach fünf Sekunden war keine fortlaufende Wiedergabe nachweisbar. Kalender-CTA und interaktive eingebettete Terminauswahl waren sichtbar. Kein Termin erzeugt.
- **Media-Diagnose:** Öffentlicher Codec-Endpunkt meldet für das PV-MP4 `HTTP 206`, `moov` im ersten 64-KB-Block und `avc1=true`; Vercel-Runtime-Log zeigte `206 bytes 0-524287/10403079` für einen realen Media-Abruf. Das belegt Range-/Metadatenzugriff, **nicht** erfolgreiche Video-Dekodierung. Media-Route lief bei diesem Aufruf in `sfo1`; separate Region-/Latenzmessung ist vor einer Region-Umstellung nötig.
- **Abgesicherte UX-Korrektur:** Der Native-MP4-Fallback startet die YouTube-Facecam nun mit der bereits erfolgten Play-Absicht (`autoStart`), statt einen zweiten Startklick vorauszusetzen. Wenn die eingebettete YouTube-Wiedergabe nicht läuft, erscheint nach dem Start ein sichtbarer direkter YouTube-Link als Rettungsweg. Commits `0751235b443065ee777e234feae1259ab7a30135` und `1d0fcad42744d86fb447bfc9ddc1b675ea5d20af`; finale Vercel-Production-Version `dpl_BWaUnR61yDSGrtBfcAUmeKdWxjEf` mit erfolgreichem Build und Status `READY`.
- **Live-Nachtest nach Fix:** Der Rettungslink `Video startet nicht? Direkt auf YouTube ansehen.` wurde nach einem einzigen Play-Klick sichtbar und verweist auf das echte PV-Video. Die YouTube-Einbettung wurde in der automatisierten Browserumgebung von einer `Sign in to confirm you're not a bot`-Abfrage blockiert. **Drei Sekunden reale Videowiedergabe wurden erneut NICHT nachgewiesen.** Das ist ein offener P0-Conversion-Blocker; eine normale Nutzerumgebung kann anders reagieren.
- **Nächste Schritte:** Native MP4 auf Chrome/Safari/Android mit Browser-Netzwerk- und Media-Diagnose reproduzierbar zum Laufen bringen; Provider-gebundene, deduplizierte Terminbestätigung implementieren; DSN-Ursachen aus Original-Bounces prüfen; Kontaktfreigaben dokumentieren; danach erst rechtmäßige A/B-Tests mit eindeutigen Buchungen als Primärziel. Automatisierung bleibt offen, da die einmalige Optimierung nicht vollständig abgenommen ist.


## 14. Sechster Prüfstand (29.10.2026, ca. 03:43–03:50 Asia/Bangkok)

- **Erneut aus Neon nach `scheduled_at` am 28.10. und `campaign_id` verifiziert:** Pflege 150 `sent`; PV 149 `sent`, 1 `failed`; 0 wartend. SMTP-Annahme ist keine bestätigte Inbox-Zustellung. Keine neue E-Mail ausgelöst.
- **Kontaktberechtigung:** `outbound_contact_permissions` weiterhin 0 Einträge. Die Versand-Compliance-Sperre bleibt bestehen; keine Freigaben, Retries oder Limitänderungen.
- **Funnel je Loom-Charge (eindeutige Leads):** Pflege: 150 SMTP angenommen / 39 Linkklicks (Mensch nicht verifiziert) / 32 `video_view` ohne Bot-Markierung / 2 bestätigte 3-s-Starts / 3 bei >=25 % / 3 bei >=50 % / 1 bei 100 % / 1 Kalenderaktion / 0 Buchungsevents. PV: 149 / 18 / 19 / 4 / 3 / 2 / 1 / 0 / 0. Stufen sind wegen älterer Player-Event-Semantik nicht streng monoton. 0 nachweisbare qualifizierte eindeutige Buchungen. Die Google-Calendar-Suche nach `Digitale Gewinner` vom 28.10.–30.11. fand keine passenden Ereignisse, ist aber kein vollständiger Provider-Abgleich.
- **Neuer externer öffentlicher Browser-Test VOR der Änderung:** Nach Klick auf den PV-Play-Button 10+ Sekunden lang keine bewegten Bilder/kein fortlaufender Timecode. Der YouTube-iframe hatte die Klasse `ytp-embed-error`; die Ursache kann an der automatisierten Browserumgebung liegen. Der Google-Kalender-CTA öffnete eine interaktive Terminwahl; kein Termin wurde erstellt.
- **Neue abgesicherte UX-Korrektur:** In `app/v/[id]/VideoBubble.tsx` erscheint nach acht Sekunden ohne gemeldete Wiedergabe oder nach YouTube-Playerfehler eine gut sichtbare Hilfemeldung mit direktem Link zum echten YouTube-Video und Hinweis auf den weiterhin erreichbaren Kalender. Erfolgreiche Wiedergabe blendet die Hilfe aus; keine falschen 3-s- oder Buchungsereignisse werden erzeugt. Commit `d2aeace67a870c0ed09960192e98b60fac0cb095`, Vercel-Production `dpl_FwgG6ix9d6qdJ7FqbntVRDxVACS6` mit Build **READY**.
- **Live-Nachtest NACH Deployment:** Nach einem Play-Klick und >12 Sekunden ohne Wiedergabe erschien die neue sichtbare Hilfemeldung `Video lädt nicht?` mit dem korrekten YouTube-Link `https://www.youtube.com/watch?v=O7z2F7TWOiU`. Kalender-CTA blieb sichtbar. YouTube meldete `ytp-embed-error` und später Anti-Bot-Abfrage. **Das ist nur eine getestete Rettungs-UX, keine Reparatur des eigentlichen Video-Playback-Problems.** Eine echte 3-s-Wiedergabe und eine Provider-bestätigte Testbuchung bleiben nicht nachgewiesen.
- **Neon-Kostenbefund:** `describe_project` meldet `suspend_timeout_seconds=0`, Autoscaling 0,25–8 CU und Projektregion `aws-eu-central-1`. Vor einer Änderung der Autosuspend-/Compute-Einstellungen müssen Kosten, kalte Starts und Auswirkungen auf Tracking und Cron-Worker geprüft werden. Keine Projektkonfiguration verändert.
- **Offene P0:** Native MP4-Wiedergabe in echten Browsern (inklusive Mobilgeräten) nachweislich reparieren; Google-Calendar-Buchungsevent eindeutig, providerbestätigt und dedupliziert an Lead/Kampagne binden; Kontaktfreigaben und 33 Bounce-Ursachen verifizieren. Kein 4-Termine-Erfolg behauptet. Einmalige Optimierungsaufgabe bleibt offen.


## 15. Siebter Prüfstand (29.10.2026, ca. 05:29–05:40 Asia/Bangkok)

- **Geplanter 28.10.-Versand erneut direkt nach `campaign_id`, `status` und `scheduled_at` (Europe/Berlin) geprüft:** Pflege 150 `sent`, PV 149 `sent` und 1 `failed`; 0 `queued`, `sending` oder `stopped` in dieser Tagescharge. 299 SMTP-angenommen, nicht 299 nachweislich im Posteingang. Keine neue E-Mail ausgelöst.
- **Datenqualität:** 0 doppelt vorkommende Empfängeradressen innerhalb der beiden Loom-Kampagnen und 0 Adressen, die zugleich in Pflege und PV stehen (Abgleich mit `lower(recipient)`). Das beseitigt nicht den bereits belegten Platzhalterkontakt und sagt nichts über Dubletten mit anderen Kampagnen aus.
- **Compliance:** `outbound_contact_permissions` enthält weiterhin 0 Zeilen. Die harte Versand-Sperre bleibt unverändert; keine Freigaben, Retries oder Limitänderungen.
- **Tracking- und Buchungsstand:** Für Loom-Kampagnen seit 28.10. UTC 156 `email_click`-Ereignisse von 57 Leads (Mensch nicht sicher verifiziert), 195 `video_view`-Ereignisse von 55 Leads, 8 `video_play_confirmed`-Ereignisse von 6 Leads, 17 `video_progress`-Ereignisse von 6 Leads, 1 `video_calendar_focus`, 20 `video_player_error`-Ereignisse von 8 Leads und 33 `bounce`-Ereignisse von 33 Leads. Keine `appointment`-/`booking_confirmed`-Events. Der primäre Google-Kalender zeigt einen generischen, nicht eindeutig zuordenbaren Termin vom 28.10.; **0 verifizierte eindeutige qualifizierte Outbound-Buchungen**.
- **Neue abgesicherte UX-Maßnahme:** Der native Loom-Player erhält einen 12-Sekunden-Stall-Watchdog. Er startet bei Play-/Waiting-/Stalled-Ereignissen, prüft ob die Wiedergabe mindestens 0,5 Sekunden weitergelaufen ist, und schaltet bei ausbleibendem Fortschritt auf den bereits vorhandenen YouTube-Rettungsweg. Er erzeugt dabei **keinen falschen 3-Sekunden-Start**; der Fehler wird separat protokolliert. Beim Pausieren, Beenden, Fehler und beim Unmount wird der Timer beendet. Commit `a289666e4887b6ddbbfc0a8e9d1a8cbfd5e16a9a`, Vercel-Production-Deployment `dpl_FqRpUpyuf28e3j3qxGimmbRwjeuS` mit Status `READY` (Build erfolgreich).
- **Öffentlicher Browser-Nachtest auf `/v/demo?segment=pv`:** Nach einem Play-Klick konnten über 15 Sekunden keine fortlaufenden Videoframes bzw. kein Timecode nachgewiesen werden. Die Browserautomation beobachtete kurz eine YouTube-Anti-Bot-Abfrage; sie konnte den Rettungslink nicht sicher identifizieren. Der Kalenderbereich war sichtbar, ein Termin wurde nicht gebucht. Dieser Test **bestätigt nicht**, dass der neue Stall-Watchdog in der konkreten Browserumgebung erfolgreich auslöste; insbesondere ist die Beobachtung zur Fallback-Anzeige nicht eindeutig. Ein normaler Desktop-/iOS-/Android-Test mit Netzwerk- und Media-Logs bleibt P0.
- **Abnahme offen:** Native Wiedergabe und belastbare mobile End-to-End-Prüfung, providerbestätigte und deduplizierte Buchungszuordnung, Bounce-DSN-Ursachen und dokumentierte Kontaktberechtigungen. Keine automatische A/B-Aktivierung oder weiterer Versand. Die Optimierung ist nicht vollständig abgeschlossen; der einmalige Task bleibt bis zur belastbaren Abnahme aktiv.

- **Nachtrag zum Stall-Watchdog:** Der `stalled`-Handler wird nur noch nach einem vom Nutzer initiierten Play-Versuch scharfgeschaltet, damit ein bloßes Medien-Preload-Ereignis keine falsche Fallback-Umschaltung auslöst. Commit `69ed9a90878931c9616a0949dacf65f3da0d2cdd`. Kein neuer Versand; erneute Wiedergabeabnahme auf realen Geräten bleibt erforderlich.


## 16. Kohorten-Korrektur: Ereignisse VOR dem Versand ausschließen (29.10.2026, 05:34+ Asia/Bangkok)

**Wichtiger analytischer Fehler in älteren Auswertungen identifiziert:** Ein Join nur über `lead_id` und `campaign_id` ordnet auch Videoereignisse vor dem tatsächlichen `sent_at` der Versandkohorte zu. Insbesondere waren zwei Pflege-Leads mit 100-%-Videoereignissen **vor** dem SMTP-Versand erfasst (27.10. 14:16 UTC bei Versand 28.10. 14:50 UTC; 28.10. 05:46 UTC bei Versand 28.10. 07:00 UTC). Diese Ereignisse dürfen nicht als Reaktion auf die Loom-E-Mail vom 28.10. gewertet werden. Es ist nicht nachgewiesen, ob es Tests oder anderweitig geteilte Links waren.

**Korrigierte Kohorte, nur `status='sent'` und `er_events.created_at >= er_outbox.sent_at`, eindeutige Leads, 29.10. ca. 05:34 Thailand:**

| Stufe | Pflege | PV | Gesamt |
|---|---:|---:|---:|
| SMTP angenommen | 150 | 149 | 299 |
| Linkklick-Event (menschlich nicht verifiziert) | 39 | 18 | 57 |
| Videoseite, `meta.bot=false` (nicht zwingend Mensch) | 31 | 19 | 50 |
| Bestätigter 3-s-Start | 2 | 4 | 6 |
| 25 % Video | 2 | 3 | 5 |
| 50 % Video | 2 | 2 | 4 |
| 100 % Video | **0** | **1** | **1** |
| Kalenderinteraktion (kein Buchungsnachweis) | 1 | 0 | 1 |
| Providerbestätigte qualifizierte Buchung | 0 nachweisbar | 0 nachweisbar | 0 nachweisbar |

Die Stufen sind keine garantiert monotone Journey, da einzelne Player-/Trackingversionen unterschiedlich emittieren und Bot-Heuristiken unvollständig sind. Die zwei früher als Pflege-100-%-Erfolge gezählten Leads waren **keine nachgewiesenen Reaktionen auf die heutige Mail**. Der echte PV-100-%-Event vom 28.10. 15:55 UTC liegt nach dem PV-Versand 13:20 UTC.

**Ab sofort als Pflichtfilter für Kohortenberichte:** `e.created_at >= o.sent_at AND o.status='sent'` sowie segmentierte Kampagnen und getrennte `bot`-/Preview-/Test-Betrachtung. Alte Gesamt-Event-Zahlen dürfen nicht als echte Post-Send-Conversions ausgegeben werden. Keine vorhandenen Rohereignisse gelöscht oder umgeschrieben.

**Kalender-Providerprüfung:** Im verbundenen Primärkalender `digitalegewinner@gmail.com` vom 28.10. bis 30.11. wurde ein generischer Termin am 28.10. 10:00 Uhr Europe/Berlin mit `mpp-recruit@web.de` gefunden. Diese Adresse gehört **nicht** zu den 300 Loom-Outbox-Empfängern; der Termin ist keine verifizierte Buchung dieser Kampagne. Ein vollständiger Booking-Provider-Webhook fehlt weiterhin. Kein neues Kalenderevent erzeugt.

**Compliance und Versand:** Erneut 150 Pflege `sent`, 149 PV `sent`, 1 PV `failed`, 0 ausstehend; `outbound_contact_permissions` weiterhin 0 Datensätze. Keine Sendungen, Freigaben oder Limiterhöhungen. Der eine fehlgeschlagene Versand wird nicht als Erfolg gezählt.


## 29.10.2026 – 05:50 Uhr Asia/Bangkok: Re-Enrollment- und Segment-Race-Fix

- Live-`er_outbox`-Prüfung (28.10. UTC, beide Loom-Kampagnen): Pflege 150 `sent`, PV 149 `sent` + 1 `failed`; keine `queued`/`sending` in der 300er-Charge. `sent` = SMTP-Annahme, keine garantierte Zustellung. 33 eindeutige Bounce-Leads.
- Funnel: Pflege 39 eindeutige Leads mit `email_click`, 32 nicht als Bot markierte `video_view`, 2 bestätigte 3-s-Starts, 3 mit 25 %, 3 mit 50 %, 1 Kalenderaktion; PV 18 Klick-Leads, 19 nicht als Bot markierte Views, 4 Starts, 3 mit 25 %, 2 mit 50 %, 0 Kalenderaktionen. Die Stufen sind nicht strikt verschachtelt; Bot-Flag ≠ bestätigter Mensch. `appointment` 0 in `er_events` für diese Kohorten. Google-Calendar-Suche nach `Digitale Gewinner` bzw. `15` im angegebenen Zeitraum lieferte keine zuordenbaren Termine; dies ist kein Vollständigkeitsbeweis für alle Kalender.
- Neuer P0-Befund im alten `appointment-goal`-Worker: 3285 `experiment_assignment`-Events am 28.10. bei nur 315 Leads; darunter 507 PV-Events mit Pflege-Experimentbezeichnung allein für Variante B. Über die gesamte Historie 2017 Pflege-Zuweisungen bei 466 Leads und 2118 PV-Zuweisungen bei 600 Leads. Die Starter-Kampagnen enthielten 5321 bzw. 5511 `suppressed`-Outbox-Einträge. Ursache: bisheriges `NOT EXISTS` ignorierte `suppressed`/`failed` und erlaubte erneutes Enrollen bereits bearbeiteter Leads. Dies verursacht wiederholte Queue-/Event-Writes und kann Deduplizierung verzerren. Keine Produktionsdaten bereinigt oder gelöscht.
- Korrektur in `lib/outbound-appointment-goal.ts`: `NOT EXISTS` berücksichtigt jetzt **alle** früheren Outbox-Zustände derselben Kampagne und Lead-ID, um erneute Aufnahme unterdrückter/fehlgeschlagener Kontakte zu verhindern. PV-Zuweisungen bekommen nun eine PV-spezifische Experimentkennung. Außerdem wurde der modulglobale mutable `ACTIVE_DEF` entfernt; Pflege/PV-Textauswahl verwendet nun die explizit übergebene Kampagnendefinition, damit gleichzeitige Requests die Segmente nicht vertauschen. Commits `95fe495c` und `d47a5088`; letzteres Deployment `dpl_GdubdMevoyBHg8KzpfFKYJMAkEYK` Vercel `READY`. Es wurde kein Versand gestartet, kein Limit erhöht und keine Berechtigung freigegeben. Bestehende fehlerhafte historische Events bleiben für spätere Audit-/Kohortenbereinigung markiert.
- Nicht-destruktiver öffentlicher Browser-Live-Test der PV-Demo: Seite und Termin-CTA laden; Kalender zeigt buchbare Zeitfenster. Nach Videostart erscheint YouTube-Anti-Bot-Abfrage/Embed-Fehler, **keine** nachgewiesene 3-s-Wiedergabe. Responsive Eindruck allein ersetzt keinen echten mobilen Test. Es wurde keine Testbuchung ausgelöst. Diese offenen P0-Punkte verhindern die Abnahme.
- `outbound_contact_permissions` enthält weiterhin 0 Datensätze; neue Kontakte dürfen ohne dokumentierte Berechtigung nicht versendet werden. Weitere Prüfungen: providerbestätigte Buchung, echter Mobil-/MP4-Test, Bounce-DSN, historische Zuordnungen und tatsächliche Neon-/Vercel-Kosten nach dem Fix. Die Automationsaufgabe bleibt bis zur vollständigen Abnahme aktiv.


## 29.10.2026 – Erneuter Versand-, Conversion- und Playback-Check (Automationsprüfung)

- **Neon, nach Kampagne und Berlin-Tag `scheduled_at` verifiziert:** `pflege-loom-150-v1` 150 `sent`; `pv-loom-150-v1` 149 `sent` und 1 `failed`; keine weiteren Status in der Tagescharge. **299 SMTP-angenommen, 1 fehlgeschlagen, 0 wartend**; keine garantierte Inbox-Zustellung. Keine Sendungen oder Wiederholungen ausgelöst. `outbound_contact_permissions` bleibt bei **0**; keine Kontaktfreigaben oder Limiterhöhungen.
- **Korrekte Post-Send-Kohorte** (nur `o.status='sent'`, `e.created_at>=o.sent_at`): Pflege 39 Leads mit `email_click`, 31 `video_view` mit `meta.bot=false`, 2 `video_play_confirmed`, 2 mit 25 %, 2 mit 50 %, 1 `video_calendar_focus`; PV 18 Klick-Leads, 19 Views mit `bot=false`, 4 bestätigte Starts, 3 mit 25 %, 2 mit 50 %, 1 mit 100 %, 0 Kalenderaktionen. Die Klicks/Views sind nicht sicher menschlich. Insgesamt 33 Bounce-Leads (16 Pflege, 17 PV), 20 historische 408-Player-Fehler bei 8 Leads ohne verwertbare `source`-Diagnostik. 0 `appointment`- oder `booking_confirmed`-Events. Primärkalender für 28.10.–30.11. frisch geprüft: ein generischer, zuvor nicht zuordenbarer Termin am 28.10.; **0 verifizierte eindeutige qualifizierte Loom-Buchungen**. Eine vollständige Provider-Webhook-Zuordnung fehlt.
- **Neon-Kostenprüfung:** `er_outbox` ca. 13 MB inklusive Indexe, `er_events` ca. 2,7 MB; 5.217 Events in 24 h, darunter 3.285 historische `experiment_assignment`-Events von 315 Leads. Der zuvor deployte Re-Enrollment-Fix soll die Wiederholung verhindern, kann aber ohne neuen rechtmäßigen Queue-Durchlauf noch nicht als produktiv bewiesen gelten. Keine destruktiven DB-Operationen.
- **Neue abgesicherte Tracking-Korrektur:** `NativeLoomPlayer.tsx` bestätigt einen 3-Sekunden-Start nicht mehr allein bei `currentTime>=3`, sondern erst nach mindestens drei Sekunden akkumuliertem tatsächlichem Medienfortschritt ohne Seek/großen Sprung. Der 12-Sekunden-Stall-Watchdog erkennt jetzt auch fehlenden Fortschritt, wenn der Browser nach dem Play-Versuch unerwartet `paused=true` meldet; manuelles Pausieren löscht den Timer. Commit `377f490517792e5b5aed8b03bacf1653634c96bf`, Vercel-Build `READY`.
- **Telegram-Qualitätskorrektur:** `app/api/t/video/route.ts` meldet Video-Start jetzt erst nach `video_play_confirmed` (mindestens drei Sekunden) statt schon beim unbestätigten `video_play`. Die Rohereignisse bleiben erhalten. Commit `e48b73e6b325dfb2044cc271416b3d7604eeee78`, Vercel-Production `dpl_GiPCXuYGktganNBrD4xtxm2HT8Mj` **READY**. Keine Änderung an Versandworker, Kontakten oder Limits.
- **Öffentlicher, nicht-destruktiver Browser-Nachtest** auf `https://app.digitalegewinner.de/v/demo?segment=pv`: Videostart-Klick reagierte; tatsächliche bewegte Bilder/fortlaufende Wiedergabe für 3 Sekunden **nicht bestätigt**. YouTube-Fallback zeigte Anti-Bot-/Embed-Fehler; der Rettungslink zum richtigen PV-Video erschien. Kalender-CTA scrollte zur interaktiven Buchungsansicht, aber keine Buchung wurde erzeugt. Im Testbrowser zeigte der Kalender die Zeitzone Los Angeles; eine falsche Anzeige für echte deutsche Empfänger ist damit nicht bewiesen. [QA-Protokoll](https://agent.tinyfish.ai/runs/febd0340-a166-4c36-add0-f5e1fd2398da).
- **Offene Abnahme / Priorität:** P0 native MP4 auf realen Chrome-/Safari-/Android-Geräten inklusive Media-/Netzwerklogs reparieren und nachweislich 3 s abspielen; P0 providerbestätigte, deduplizierte Buchungszuordnung zu Lead/Kampagne; P0 Bounce-DSN-Ursachen und dokumentierte Kontaktberechtigung. Danach kontrollierte A/B-Tests für Branchen-Hooks, 30–60-s-Einstieg, einen klaren Termin-CTA und rechtlich zulässige Follow-ups. Primärziel 4 eindeutige qualifizierte Buchungen pro Werktag, **noch nicht erreicht**. Automationsaufgabe bleibt bis zur vollständigen Abnahme aktiv.
