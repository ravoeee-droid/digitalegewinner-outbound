# DG Outbound – kontrollierter Kohorten-Audit (29.10.2026, ca. 06:13 UTC)

## Ziel und Abnahmekriterium
4 eindeutig qualifizierte, providerbestätigte Termine pro Werktag aus 300 **rechtmäßig** versendeten Pflege/PV-Mails = Zielquote 1,33 %, keine Garantie. Ein Klick, Kalenderfokus oder eine E-Mail-Öffnung ist **keine** Buchung.

## Charge 28.10.2026 – Neon public.er_outbox, scheduled_at in UTC-Tagesfenster
| Kampagne | sent mit sent_at und provider_message_id | failed | queued | stopped/suppressed innerhalb Loom-Kampagne |
|---|---:|---:|---:|---:|
| pflege-loom-150-v1 | 150 | 0 | 0 | 0 |
| pv-loom-150-v1 | 149 | 1 | 0 | 0 |
| Summe | 299 | 1 | 0 | 0 |

Ein PV-Fehler: SMTP 501 5.1.3 Bad recipient address syntax. 300 verschiedene Empfänger in dieser Charge. **SMTP accepted bedeutet nicht zugestellt oder rechtlich freigegeben.** Die 34 Bounce-Leads (16 Pflege, 18 PV) sind separat zu erfassen und dürfen nicht als erfolgreiche Zustellung gewertet werden. Andere Kampagnen am selben Tag (u.a. pflege-starter-v2, pv-starter-v1 und US-PV) gehören ausdrücklich nicht zur 300er-Loom-Charge; deren gestoppte/unterdrückte Einträge dürfen nicht hineingerechnet werden.

## Kohortentrichter, eindeutige Leads, 28.–29.10.2026, Test-Exclusions und als Bot markierte Events ausgeschlossen
| Stufe | Pflege | PV | Gesamt |
|---|---:|---:|---:|
| SMTP accepted | 150 | 149 | 299 |
| E-Mail-Linkklick, **menschlich nicht verifiziert** | 39 | 18 | 57 |
| Videoseitenbesuch | 29 | 12 | 41 |
| Video mindestens 3 s bestätigt | 2 | 4 | 6 |
| Video-Progress >=25 % (historische Messung nicht belastbar) | 3 | 3 | 6 |
| Video-Progress >=50 % (historische Messung nicht belastbar) | 3 | 2 | 5 |
| Kalender geöffnet/fokussiert | 1 | 0 | 1 |
| Providerbestätigte, eindeutig zugeordnete qualifizierte Buchungen | 0 | 0 | 0 |

**Messfehler:** Pflege meldet 3 Leads mit >=25/50%-Progress, aber nur 2 Leads mit bestätigten 3 Sekunden. Der native Player nutzte currentTime/duration und markierte bei onEnded automatisch 100%; Seek konnte Fortschritt ohne tatsächliche Wiedergabe vortäuschen. PR #147 behebt das durch Vereinigung tatsächlich abgespielter Zeitintervalle, bestätigte 3 Sekunden als Voraussetzung, Seek-Reset und reale watch-Dauer. Der Fix ist **noch nicht produktiv**; die alten Messwerte bleiben unzuverlässig.

## Produktions- und Infrastrukturprüfung
- GitHub PR #144 (MP4 Range) und #146 (direkter MP4-Fallback) sind gemerged; Vercel Produktion READY, Commit d83e334a5f3eabde4662b7d70c055739bbbeccb5.
- Produktionslogs 29.10. 04:49 UTC: PV Range `bytes=0-` -> HTTP 206, `bytes 0-10403078/10403079`, 10.403.079 Byte. **Kein Beweis für echte Safari/Chrome-Videowiedergabe**.
- Öffentliche PV-/Pflege-Demoseiten liefern den Google-Kalender-CTA und das eingebettete Termin-iframe; das Lesen der öffentlichen Google-Booking-Seite ergab `empty_content`, keine End-to-End-Buchungsbestätigung.
- Primärer Google Calendar `digitalegewinner@gmail.com`: im Fenster 28.10.–06.11. ein generischer einstündiger Termin, keine nachweisbare 15-Minuten-Loom-Buchung. Es fehlt ein eindeutiger Lead-/Provider-Buchungsschlüssel.
- Vercel-Preview für PR #147 ist READY (Deployment dpl_Fs97JDTx7sneorVZjtjKRykwJMoC), aber der öffentliche Preview-Abruf scheitert an SSO `login_required`. **Nicht mergen ohne Preview-Livecheck bzw. kontrollierte Freigabe**.
- **Produktiv umgesetzt, nicht destruktiv:** Zwei Indizes `CREATE INDEX CONCURRENTLY`: `er_outbox_workspace_lead_status_sent_idx` (368 kB) und `er_events_workspace_lead_created_idx` (856 kB). Beide `indisvalid=true`, `indisready=true`. Repräsentatives `EXPLAIN` Outbox-Lead-/Status-/Sent-Lookup: Plan-Kosten **1856,50 -> 8,33** (Index-Only Scan statt Bitmap über alle gesendeten); er_events-Lead-Timeline **487,14 -> 15,51** (Index Scan statt Seq Scan + Sort). Das sind **geschätzte Plan-Kosten**, keine gemessene Latenz- oder Euro-Ersparnis. Produktions-Smoketest der PV-/Pflege-Demoseiten nach den Index-Änderungen erfolgreich, CTA/iframe vorhanden. Kein Versand, keine Änderung von Datensätzen.
- Neon: ca. 180 MB Datenbank; 14.083 Outbox-Zeilen, 11.271 er_events, 2.692 sales_leads, 0 outbound_events. Projekt meldet 19.299 Compute-Sekunden im Abrechnungsfenster; `suspend_timeout_seconds=0` (Kostenrisiko; Änderung nur nach Betriebsprüfung).
- Vercel-Logs: SSL-Mode-Deprecation-Warnungen als `error` geloggt, wiederkehrende leere/undarstellbare Screenshot-Quellen; keine pauschale Ursache für fehlende Buchungen nachgewiesen.
- Neon `outbound_contact_permissions`, `outbound_approvals`, `outbound_permission_reviews`: jeweils 0 Einträge. **Rechtmäßigkeit der bereits gesendeten 299 nicht belegt; keine weiteren Sendungen ohne Einzelprüfung/Freigabe.**
- Segment-Stichprobe der Charge: Pflege-Branchen (Pflege/Ambulante/Intensiv-/Stationäre Pflege), PV-Branchen (Photovoltaik/Photovoltaik-Elektro); 300 verschiedene Empfänger. Kein offensichtlicher Kampagnenmix in diesen Branchen. Vollständige Ansprechpartner-/Anredeprüfung steht aus.

## Priorisierte Maßnahmen und A/B-Hypothesen (noch nicht als Erfolge zählen)
1. PR #147: Preview mit SSO-berechtigtem Testgerät oder sicherem zeitlich begrenztem Preview-Zugang prüfen; Video seek/replay/25/50/100 und echten Mobile-Play testen. Nach Freigabe Merge + Produktions-Smoke-Test.
2. Echte 15-Minuten-Buchung als Test mit sauber markiertem Testlead end-to-end prüfen (Google-Buchungsbestätigung + Kalenderereignis + idempotente CRM-Zuordnung). Ohne providerbestätigte Identität kein `booking_confirmed` und keine 4-Termine-Erfolgsmeldung.
3. Video-Fehler auf realem Safari und Chrome erfassen: `play_intent`, `player_error`, `play_confirmed` mit Sitzung, Player, Gerät; echte Wiedergabe darf nicht aus HTTP 206 abgeleitet werden.
4. Separater kontrollierter Test nur auf rechtlich freigegebenen Kontakten: A = aktueller Einstieg; B = in den ersten 5 Sekunden konkreter Schmerz + Nutzen und eine einzige Buchungs-CTA. Randomisierung auf Lead-Ebene, gleiche Sendefenster und Segmente, **Primärmetrik eindeutig gebuchter qualifizierter Termin pro gesendeter rechtmäßiger Mail**, sekundär 3-s-Starts. Keine automatischen Mehrsendungen.
5. Bots, Sicherheits-Scanner, eigene Tests, Auto-Replies, Bounces und Sperren dauerhaft aus Human-Conversion-Funnel ausschließen; deduplizierte Empfänger-/Sitzungs-IDs; Replays nur als Engagement, nie als neue Leads.
6. Datenbankabfragen und Indizes anhand `EXPLAIN` und realen Lastprofilen prüfen; `er_events` hat derzeit nur PK und Claim-Index. Keine großflächigen Updates oder pauschalen Limitänderungen.
7. Screenshot-Fehler pro Domain mit Backoff, Deadline, Cache und sicherem neutralem Fallback behandeln; Anreden vor Versand anhand Kontaktquelle/Ansprechpartner validieren, Unbekanntes neutral adressieren.
8. Follow-ups ausschließlich bei rechtlich geprüftem Kontaktstatus und sauberem Suppression-/Reply-Gate. Keine automatisierte Freigabe.

## Status
Die 300er-Charge ist terminal abgearbeitet (299 SMTP accepted, 1 failed, 0 queued). **Die Gesamtoptimierung ist nicht abgeschlossen; 0 bestätigte qualifizierte Buchungen.** Diese Aufgabe darf noch nicht als erledigt deaktiviert werden.
