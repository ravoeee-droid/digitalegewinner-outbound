# Pflege Recruiting OS · Launch Release · 2026-08-21

Finaler Produktionsstand für die eigene Pflege-Akquise.

## Operativer Flow

Pflege Radar → Research & Import → Priority Queue → CloudTalk Call Session → Call Outcome → Audit / Video / Follow-up → Termin → Pipeline → No-Show Rescue.

## Launch-Schutz

- Das normalisierte `sales_*` CRM ist die operative Source of Truth.
- Die aktive Ansicht ist auf Pflege-Leads begrenzt.
- `phone_ready=false` wird nicht in der Call Queue angeboten.
- Bereits abgearbeitete Leads werden am selben Tag nicht erneut als Cold-Call-Next-Action angeboten; Rückrufe bleiben verfügbar.
- Termin-, Angebots-, Gewonnen- und Verloren-Stages werden aus der Cold-Call-Queue genommen.
- E-Mail-Kampagnen starten nur mit aktiver Mailbox.
- Legacy-State dient nur noch als Kompatibilitätsschicht für bestehende APIs.

## UI

Eine einheitliche Premium-Oberfläche für Cockpit, Call Session, Pflege Radar, Kampagnen, Inbox, Video, Pipeline, Analytics, Setup und Login. Die alten Floating-Widgets sind nicht mehr Teil des Produktions-Layouts.

## Verifikation

Der Release wird über GitHub CI mit TypeScript, ESLint, Next Production Build sowie npm Security Audits geprüft und zusätzlich durch Vercel gebaut.
