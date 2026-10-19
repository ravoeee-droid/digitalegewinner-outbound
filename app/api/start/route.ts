import { after } from "next/server";
import { ensureSalesOsSchema } from "@/lib/sales-os";
import { buildDailyOutboundPlan } from "@/lib/outbound-engine";
import { ensureAppointmentGoalQueue } from "@/lib/outbound-appointment-goal";
import { seedCallLeadsIfEmpty } from "@/lib/seed-call-leads";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Ein Klick „Jetzt starten": Leads einspielen, Tagesplan bauen und die Mail-Warteschlange füllen.
// Der Zugriff ist über die Anmeldung im proxy.ts geschützt.
export async function POST(request: Request) {
  try {
    await ensureSalesOsSchema();
    const seed = await seedCallLeadsIfEmpty();
    await buildDailyOutboundPlan();
    const goal = await ensureAppointmentGoalQueue("default") as { ok?: boolean; skipped?: boolean; reason?: string; queuedLeads?: number; queuedMessages?: number };

    // Mail-Warteschlange kommt aus der Lead-Suche (Stellenanzeigen). Ist sie leer, wird die Suche jetzt gestartet und läuft im Hintergrund weiter.
    let searchStarted = false;
    const secret = process.env.CRON_SECRET;
    if (!goal.queuedMessages && !goal.skipped && secret) {
      searchStarted = true;
      const targets = ["/api/cron/ba-leads", "/api/cron/pflege-source"].map((path) => new URL(path, request.url));
      after(async () => { await Promise.all(targets.map((target) => fetch(target, { method: "POST", headers: { authorization: `Bearer ${secret}` } }).catch(() => null))); });
    }

    let message = "";
    if (goal.skipped && goal.reason === "no_active_mailboxes") message = "Es ist kein Postfach aktiv. Bitte unter Postfächer ein Postfach verbinden.";
    else if (goal.skipped) message = "Der automatische Versand ist in den Einstellungen ausgeschaltet.";
    else if (!goal.queuedMessages && searchStarted) message = "Die Mail-Warteschlange ist noch leer. Die Lead-Suche wurde gerade gestartet und braucht einige Minuten. Danach füllt sich die Warteschlange automatisch (stündlich) und der Versand beginnt Mo–Fr ab 8:30 Uhr.";
    else if (!goal.queuedMessages) message = `${seed.leads} Leads vorhanden, aber keine neuen Mails eingeplant. Entweder fehlen Leads mit E-Mail-Adresse oder alles ist schon eingeplant.`;
    else message = `${goal.queuedLeads || 0} Leads eingeplant, ${goal.queuedMessages} Mails in der Warteschlange. Der Versand läuft Mo–Fr 8:30–17:30 Uhr automatisch.`;

    return Response.json({ ok: Boolean(goal.queuedMessages) || searchStarted, message, leads: seed.leads, seeded: seed.seeded, queuedLeads: goal.queuedLeads || 0, queuedMessages: goal.queuedMessages || 0 });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "Start fehlgeschlagen." }, { status: 503 });
  }
}
