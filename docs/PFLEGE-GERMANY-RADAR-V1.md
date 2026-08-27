# Pflege Deutschland Radar V1

## Ziel

Systematische Erfassung und Bearbeitung des deutschen Marktes für ambulante Pflegedienste: Discovery → CRM → Enrichment → Call-ready → kontaktiert.

## Discovery

- 16 Bundesländer mit territorialen Suchsektoren
- Google Places als Premium-Quelle, wenn verbunden
- OpenStreetMap/Nominatim/Overpass als automatischer Fallback
- Deduplizierung nach Source-ID, Website sowie Name + Stadt
- Persistenter Fortschritt in `sales_territory_scans`

## Enrichment

- öffentliche Kontaktdaten
- Karriere-/Job-/Teamseiten
- ATS- und Recruiting-Kanäle
- Tracking- und Marketing-Technologien
- Website-Audit mit SEO, Conversion, Trust, Technik und Content
- Meta- und Google-Ads-Intelligence mit `active`, `likely`, `none`, `unknown`

## UI

Der Deutschland Lead Radar ist Bestandteil der bestehenden Pflege-V2-Oberfläche. Er zeigt pro Bundesland Discovery-Fortschritt, CRM-Bestand, Enrichment, Call-ready-Leads, Werbe-Signale und Kontaktierungsquote.

## Betriebsregel

Neue Discovery-Leads starten im Status `Research`. Erst nach vollständigem Enrichment und vorhandener Telefonnummer werden sie als call-ready behandelt.
