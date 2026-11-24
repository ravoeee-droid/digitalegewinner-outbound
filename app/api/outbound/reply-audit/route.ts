import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Nur lesender Prüfbericht: Sind eingegangene Antworten dem richtigen Lead zugeordnet, und ging nach einer Antwort noch Post raus?
// Geschützt durch den Admin-Login der App (/api/outbound/* ist für andere Rollen gesperrt).
type Ok<T> = { ok: true; v: T } | { ok: false; label: string; error: string };
async function safe<T>(label: string, run: () => Promise<T>): Promise<Ok<T>> {
  try { return { ok: true, v: await run() }; } catch (e) { return { ok: false, label, error: e instanceof Error ? e.message : "Fehler" }; }
}
const FREEMAIL = /^(gmail\.com|googlemail\.com|gmx\.(de|net|at|ch)|web\.de|t-online\.de|outlook\.(com|de)|hotmail\.(com|de)|yahoo\.(com|de)|icloud\.com|me\.com|freenet\.de|arcor\.de|1und1\.de|online\.de|posteo\.de|mail\.de)$/i;
const host = (value: string) => String(value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
const dom = (email: string) => String(email || "").toLowerCase().split("@")[1] || "";
const short = (value: string, n = 38) => (value.length > n ? value.slice(0, n - 1) + "…" : value);
const day = (value: unknown) => new Date(value as string).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export async function GET() {
  const lines: string[] = [];
  const fail = (r: { label: string; error: string }) => lines.push(`  [nicht abrufbar: ${r.label} – ${r.error}]`);

  const classes = await safe("Einordnung", () => query<{ c: string; n: number }>(
    `select coalesce(meta->>'replyClass','?') c, count(*)::int n from er_events
     where workspace='default' and type='reply_classified' and created_at>now()-interval '45 days' group by 1 order by 2 desc`));
  lines.push("ANTWORTEN (letzte 45 Tage) NACH EINORDNUNG");
  if (!classes.ok) fail(classes); else if (!classes.v.length) lines.push("  keine"); else for (const r of classes.v) lines.push(`  ${r.c.padEnd(28)} ${r.n}`);

  const replies = await safe("Antworten", () => query<{
    created_at: string; lead_id: string; frm: string | null; subj: string | null; var: string | null; company: string | null;
    contact_email: string | null; domain: string | null; website: string | null; sent_to: string | null; cls: string | null;
  }>(
    `select e.created_at, e.lead_id, lower(e.meta->>'from') frm, e.meta->>'subject' subj, e.meta->>'variant' var,
            co.name company, lower(ct.email) contact_email, co.domain, co.website,
            (select string_agg(distinct lower(o.recipient),', ') from er_outbox o where o.workspace='default' and o.lead_id=e.lead_id::text and o.status='sent') sent_to,
            (select x.meta->>'replyClass' from er_events x where x.workspace='default' and x.type='reply_classified' and x.lead_id=e.lead_id order by x.created_at desc limit 1) cls
     from er_events e
     left join sales_leads l on l.id::text=e.lead_id::text and l.workspace=e.workspace
     left join sales_contacts ct on ct.id=l.contact_id
     left join sales_companies co on co.id=l.company_id
     where e.workspace='default' and e.type='reply' and e.created_at>now()-interval '45 days'
     order by e.created_at desc limit 500`));
  lines.push("", "ZUORDNUNG DER ANTWORTEN");
  if (!replies.ok) fail(replies);
  else {
    const flagged: string[] = [];
    let other = 0, domainDiff = 0, noLead = 0;
    for (const r of replies.v) {
      const from = r.frm || "";
      const sentTo = (r.sent_to || "").split(", ").filter(Boolean);
      const flags: string[] = [];
      if (!r.company) { flags.push("kein Lead gefunden"); noLead++; }
      else {
        if (sentTo.length && !sentTo.includes(from)) { flags.push("Antwort von anderer Adresse als angeschrieben"); other++; }
        const wanted = host(r.domain || r.website || "");
        const fromDomain = dom(from);
        if (wanted && fromDomain && !FREEMAIL.test(fromDomain) && !fromDomain.endsWith(wanted) && !wanted.endsWith(fromDomain)) { flags.push(`Domain weicht ab (${fromDomain} statt ${wanted})`); domainDiff++; }
      }
      if (flags.length) flagged.push(`  ${day(r.created_at)}  ${short(from, 34).padEnd(34)} → ${short(r.company || "?", 30).padEnd(30)} [${r.cls || "?"}]  ${flags.join("; ")}${sentTo.length ? `  (gesendet an: ${short(sentTo.join(", "), 60)})` : ""}`);
    }
    lines.push(`  Antworten gesamt: ${replies.v.length} · auffällig: ${flagged.length} (andere Adresse: ${other}, abweichende Domain: ${domainDiff}, kein Lead: ${noLead})`);
    lines.push(...(flagged.length ? flagged.slice(0, 60) : ["  keine auffälligen Zuordnungen gefunden"]));
  }

  const after = await safe("Versand nach Antwort", () => query<{
    company: string | null; email: string | null; first_reply: string; n: number; last_sent: string; v: string; cls: string | null;
  }>(
    `with rep as (select lead_id, min(created_at) first_reply from er_events where workspace='default' and type='reply' and lead_id is not null group by lead_id)
     select co.name company, lower(ct.email) email, rep.first_reply, count(o.id)::int n, max(o.sent_at) last_sent,
            string_agg(distinct coalesce(o.variant,'?'),',') v,
            (select x.meta->>'replyClass' from er_events x where x.workspace='default' and x.type='reply_classified' and x.lead_id=rep.lead_id order by x.created_at desc limit 1) cls
     from rep
     join er_outbox o on o.workspace='default' and o.lead_id=rep.lead_id::text and o.status='sent' and o.sent_at>rep.first_reply+interval '10 minutes'
     left join sales_leads l on l.id::text=rep.lead_id::text and l.workspace='default'
     left join sales_contacts ct on ct.id=l.contact_id
     left join sales_companies co on co.id=l.company_id
     group by co.name, ct.email, rep.first_reply, rep.lead_id
     order by max(o.sent_at) desc limit 60`));
  lines.push("", "MAILS, DIE NACH EINER ANTWORT NOCH AN DENSELBEN LEAD GINGEN (sollte leer sein)");
  if (!after.ok) fail(after); else if (!after.v.length) lines.push("  keine"); else for (const r of after.v) lines.push(`  ${short(r.company || "?", 32).padEnd(32)} ${short(r.email || "", 32).padEnd(32)} Antwort ${day(r.first_reply)} [${r.cls || "?"}] · danach ${r.n} Mail(s), zuletzt ${day(r.last_sent)}, Stufe ${r.v}`);

  const viaOther = await safe("Andere Leads", () => query<{ email: string; company: string | null; first_reply: string; n: number; last_sent: string; cls: string | null }>(
    `with rep as (select e.lead_id, min(e.created_at) first_reply from er_events e where e.workspace='default' and e.type='reply' and e.lead_id is not null group by e.lead_id)
     select lower(ct.email) email, co.name company, rep.first_reply, count(o.id)::int n, max(o.sent_at) last_sent,
            (select x.meta->>'replyClass' from er_events x where x.workspace='default' and x.type='reply_classified' and x.lead_id=rep.lead_id order by x.created_at desc limit 1) cls
     from rep
     join sales_leads l on l.id::text=rep.lead_id::text and l.workspace='default'
     join sales_contacts ct on ct.id=l.contact_id
     left join sales_companies co on co.id=l.company_id
     join er_outbox o on o.workspace='default' and o.status='sent' and lower(o.recipient)=lower(ct.email) and o.lead_id<>rep.lead_id::text and o.sent_at>rep.first_reply+interval '10 minutes'
     where coalesce(ct.email,'')<>''
     group by ct.email, co.name, rep.first_reply, rep.lead_id
     order by max(o.sent_at) desc limit 40`));
  lines.push("", "MAILS AN DIESELBE ADRESSE ÜBER EINEN ANDEREN LEAD NACH EINER ANTWORT (sollte leer sein)");
  if (!viaOther.ok) fail(viaOther); else if (!viaOther.v.length) lines.push("  keine"); else for (const r of viaOther.v) lines.push(`  ${short(r.email, 34).padEnd(34)} ${short(r.company || "?", 28).padEnd(28)} Antwort ${day(r.first_reply)} [${r.cls || "?"}] · danach ${r.n} Mail(s) über anderen Lead, zuletzt ${day(r.last_sent)}`);

  const noSupp = await safe("Absagen ohne Sperre", () => query<{ email: string; company: string | null; at: string; cls: string }>(
    `select distinct on (ct.email) lower(ct.email) email, co.name company, x.created_at at, x.meta->>'replyClass' cls
     from er_events x
     join sales_leads l on l.id::text=x.lead_id::text and l.workspace='default'
     join sales_contacts ct on ct.id=l.contact_id
     left join sales_companies co on co.id=l.company_id
     where x.workspace='default' and x.type='reply_classified' and x.meta->>'replyClass' in ('not_interested','unsubscribe','legal_complaint')
       and not exists(select 1 from er_suppressions s where s.workspace='default' and lower(s.email)=lower(ct.email))
       and coalesce(ct.email,'')<>''
     order by ct.email, x.created_at desc limit 60`));
  lines.push("", "ABSAGEN, DEREN ADRESSE NICHT GESPERRT IST (bei Neu-Eingängen sperrt das System jetzt automatisch)");
  if (!noSupp.ok) fail(noSupp); else if (!noSupp.v.length) lines.push("  keine"); else for (const r of noSupp.v) lines.push(`  ${short(r.email, 36).padEnd(36)} ${short(r.company || "?", 30).padEnd(30)} ${day(r.at)} [${r.cls}]`);

  const shared = await safe("Geteilte Adressen", () => query<{ email: string; n: number; names: string }>(
    `select lower(ct.email) email, count(distinct l.id)::int n, string_agg(distinct co.name,' | ') names
     from sales_leads l join sales_contacts ct on ct.id=l.contact_id left join sales_companies co on co.id=l.company_id
     where l.workspace='default' and coalesce(ct.email,'')<>''
       and lower(ct.email) in (select distinct lower(meta->>'from') from er_events where workspace='default' and type='reply')
     group by lower(ct.email) having count(distinct l.id)>1 order by 2 desc limit 30`));
  lines.push("", "ADRESSEN, DIE BEI MEHREREN LEADS STEHEN UND ANTWORTEN GESCHICKT HABEN");
  if (!shared.ok) fail(shared); else if (!shared.v.length) lines.push("  keine"); else for (const r of shared.v) lines.push(`  ${short(r.email, 34).padEnd(34)} ${r.n} Leads: ${short(r.names || "", 90)}`);

  const bounces = await safe("Rückläufer", () => query<{ created_at: string; em: string | null; company: string | null; was_sent: boolean }>(
    `select e.created_at, lower(e.meta->>'email') em, co.name company,
            exists(select 1 from er_outbox o where o.workspace='default' and o.status='sent' and lower(o.recipient)=lower(e.meta->>'email')) was_sent
     from er_events e
     left join sales_leads l on l.id::text=e.lead_id::text and l.workspace=e.workspace
     left join sales_companies co on co.id=l.company_id
     where e.workspace='default' and e.type='bounce' and e.created_at>now()-interval '45 days' order by e.created_at desc limit 400`));
  lines.push("", "RÜCKLÄUFER (BOUNCES)");
  if (!bounces.ok) fail(bounces);
  else {
    const odd = bounces.v.filter((b) => !b.was_sent);
    lines.push(`  gesamt: ${bounces.v.length} · davon an eine Adresse, an die wir nie gesendet haben (Zuordnung falsch): ${odd.length}`);
    for (const b of odd.slice(0, 40)) lines.push(`  ${day(b.created_at)}  ${short(b.em || "?", 40).padEnd(40)} ${short(b.company || "kein Lead", 30)}`);
  }

  lines.push("", "HINWEIS: Antworten, die von einer unbekannten Adresse kommen, werden vom System nicht gespeichert und erscheinen hier nicht. Prüfe sie im Postfach.");
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
