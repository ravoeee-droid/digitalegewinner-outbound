import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { followUp, pvFollowUp } from "@/lib/outreach-copy";

export const dynamic = "force-dynamic";

// Ersetzt den Text noch nicht gesendeter Folgemails ("Re: ...") durch die aktuellen Folgetexte. Anrede und Stellentitel bleiben erhalten.
// Login über den Admin-Cookie. Ohne ?run=1 nur Vorschau.
type Row = { id: string; subject: string; body: string };

function rebuild(row: Row) {
  const subject = row.subject.replace(/^Re:\s*/, "");
  const greeting = row.body.split("\n\n")[0] || "Guten Tag,";
  const step = /letzte Nachricht/.test(row.body) ? 2 : 1;
  let copy: { subject: string; body: string } | null = null;
  if (/^Kurzes Video zur Kundengewinnung/.test(subject)) copy = pvFollowUp({ contact: "", video: true }, step);
  else if (/^Kurze Frage zur Kundengewinnung/.test(subject)) copy = pvFollowUp({ contact: "", video: false }, step);
  else if (/^Kurzes Video zur Mitarbeitergewinnung/.test(subject)) copy = followUp({ company: "", contact: "", title: "", video: true }, step);
  else if (/^Mitarbeitergewinnung in der Pflege/.test(subject)) copy = followUp({ company: "", contact: "", title: "", general: true }, step);
  else if (/^Ihre offene Stelle: /.test(subject)) copy = followUp({ company: "", contact: "", title: subject.replace(/^Ihre offene Stelle: /, "") }, step);
  if (!copy) return null;
  const [, ...rest] = copy.body.split("\n\n");
  return { subject: copy.subject, body: [greeting, ...rest].join("\n\n") };
}

export async function GET(request: Request) {
  const run = new URL(request.url).searchParams.get("run") === "1";
  try {
    const rows = await query<Row>("select id::text id, subject, body from er_outbox where workspace='default' and status='queued' and subject like 'Re: %'");
    const updates = rows.map((row) => ({ row, next: rebuild(row) })).filter((entry): entry is { row: Row; next: { subject: string; body: string } } => Boolean(entry.next));
    if (!run) return NextResponse.json({ gefunden: rows.length, umschreibbar: updates.length, beispiel: updates[0]?.next || null });
    let changed = 0;
    for (const { row, next } of updates) {
      const result = await query("update er_outbox set subject=$2, body=$3 where id::text=$1 and status='queued' returning id", [row.id, next.subject, next.body]);
      changed += result.length;
    }
    return NextResponse.json({ gefunden: rows.length, umgeschrieben: changed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fehler" }, { status: 500 });
  }
}
