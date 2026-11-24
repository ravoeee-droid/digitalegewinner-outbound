// Zusätzliche Versanddomain(s) neben der Hauptdomain, mit automatischem Aufwärmen.
//   OUTBOUND_EXTRA_SEND_DOMAINS     z. B. "gewinner-digital.de" (mehrere mit Komma)
//   OUTBOUND_EXTRA_START_DATE       Startdatum des Aufwärmens, z. B. "2026-11-25". Ohne Datum bleibt es bei 5 Mails je Postfach.
//   OUTBOUND_EXTRA_PER_MAILBOX_MAX  Obergrenze je Postfach nach dem Aufwärmen (Standard 30)
// Aufwärmplan je Postfach und Tag: Woche 1 = 5, Woche 2 = 10, Woche 3 = 20, danach bis zur Obergrenze.
// Ohne gesetzte Domain ändert sich nichts.
export function extraSendDomains(): Set<string> {
  return new Set(
    String(process.env.OUTBOUND_EXTRA_SEND_DOMAINS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean),
  );
}
export function isExtraMailbox(email: string | undefined | null): boolean {
  const domain = String(email || "").toLowerCase().split("@")[1] || "";
  return Boolean(domain) && extraSendDomains().has(domain);
}
export function extraPerMailboxMax(): number {
  const value = Number(process.env.OUTBOUND_EXTRA_PER_MAILBOX_MAX);
  return Math.min(100, Math.max(1, Number.isFinite(value) && value > 0 ? Math.floor(value) : 30));
}
export function extraPerMailboxLimit(now = new Date()): number {
  const max = extraPerMailboxMax();
  const start = Date.parse(`${String(process.env.OUTBOUND_EXTRA_START_DATE || "").trim()}T00:00:00Z`);
  if (!Number.isFinite(start)) return Math.min(max, 5);
  const days = Math.floor((now.getTime() - start) / 86_400_000);
  const ramp = days < 7 ? 5 : days < 14 ? 10 : days < 21 ? 20 : 30;
  return Math.max(1, Math.min(max, ramp));
}
