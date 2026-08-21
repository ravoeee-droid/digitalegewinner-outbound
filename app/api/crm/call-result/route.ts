import { query } from "@/lib/db";

export const runtime = "nodejs";

type Payload = {
  leadId?: string;
  event?: string;
  disposition?: string;
  note?: string;
  callbackAt?: string;
  durationSeconds?: number;
  phone?: string;
};

const stageByDisposition: Record<string, string> = {
  no_answer: "Kontaktiert",
  callback: "Kontaktiert",
  interested: "Engaged",
  appointment: "Termin",
  offer: "Angebot",
  not_interested: "Verloren",
  wrong_number: "Kontaktiert",
};

const labelByDisposition: Record<string, string> = {
  no_answer: "Nicht erreicht",
  callback: "Rückruf",
  interested: "Interesse",
  appointment: "Termin",
  offer: "Angebot senden",
  not_interested: "Kein Interesse",
  wrong_number: "Falsche Nummer",
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Payload;
    const leadId = String(body.leadId || "").trim();
    if (!leadId) return Response.json({ error: "leadId fehlt." }, { status: 400 });

    const rows = await query<{ id: string; workspace: string; company_id: string; notes: string }>(
      `select id,workspace,company_id,notes from sales_leads where id=$1 limit 1`,
      [leadId],
    );
    const lead = rows[0];
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    const durationSeconds = Math.max(0, Math.round(Number(body.durationSeconds || 0)));

    if (body.event) {
      const event = String(body.event).slice(0, 80);
      await query(
        `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
         values($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          lead.workspace,
          lead.id,
          lead.company_id,
          `call.${event}`,
          event === "dialing" ? "CloudTalk Anruf gestartet" : `CloudTalk Event: ${event}`,
          JSON.stringify({ provider: "cloudtalk", event, phone: String(body.phone || ""), durationSeconds }),
        ],
      );
      return Response.json({ ok: true, event });
    }

    const disposition = String(body.disposition || "").trim();
    if (!disposition || !stageByDisposition[disposition]) {
      return Response.json({ error: "Ungültiges Call-Ergebnis." }, { status: 400 });
    }

    const stage = stageByDisposition[disposition];
    const label = labelByDisposition[disposition];
    const note = String(body.note || "").trim().slice(0, 4000);
    const callbackAt = String(body.callbackAt || "").trim();
    const parts = [
      `[CloudTalk] ${label}`,
      durationSeconds ? `Dauer ${Math.floor(durationSeconds / 60)}:${String(durationSeconds % 60).padStart(2, "0")}` : "",
      callbackAt ? `Rückruf ${callbackAt}` : "",
      note,
    ].filter(Boolean);
    const appended = parts.join(" · ");

    await query(
      `update sales_leads
       set stage=$2,
           status=case when $3='not_interested' then 'inactive' else status end,
           notes=case when coalesce(notes,'')='' then $4 else notes || E'\\n' || $4 end,
           updated_at=now()
       where id=$1`,
      [lead.id, stage, disposition, appended],
    );

    await query(
      `insert into sales_activities(workspace,lead_id,company_id,type,summary,meta)
       values($1,$2,$3,'call.completed',$4,$5::jsonb)`,
      [
        lead.workspace,
        lead.id,
        lead.company_id,
        `CloudTalk · ${label}${durationSeconds ? ` · ${durationSeconds}s` : ""}`,
        JSON.stringify({ provider: "cloudtalk", disposition, label, durationSeconds, note, callbackAt, stage }),
      ],
    );

    return Response.json({ ok: true, stage, disposition });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Call-Ergebnis konnte nicht gespeichert werden." },
      { status: 503 },
    );
  }
}
