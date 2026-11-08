import { query } from "@/lib/db";
import { leadSegmentSql } from "@/lib/lead-segment";
import { CALL_MIN_JOB_AGE_DAYS } from "@/lib/outbound-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Trichter der Call-Auswahl: zeigt, bei welchem Filter die Leads herausfallen. Nur lesend, geschützt durch den Admin-Login.
export async function GET() {
  try {
    const pub = `coalesce(nullif(c.metadata->>'jobPublishedAt',''),nullif(left(split_part(coalesce(l.notes,''),' · seit ',2),10),''))`;
    const [row] = await query<Record<string, number>>(`
      with base as (
        select coalesce(c.metadata->'daily_qualification'->>'tier','(ohne Stufe)') tier, l.stage, l.owner, l.do_not_contact, coalesce(ct.phone,c.phone,'')<>'' has_phone, ${leadSegmentSql("c")}='pflege' is_pflege,
          (lower(coalesce(c.metadata->>'jobRole',''))='pflegefachkraft' or lower(coalesce(c.metadata->>'jobAdUrl','')) like '%/pflegefachkraft/%' or lower(coalesce(c.metadata->>'jobTitle','')) like '%pflegefach%'
            or lower(coalesce(l.notes,'')) like '%pflegefach%' or lower(coalesce(l.notes,'')) like '%altenpfleger%' or lower(coalesce(l.notes,'')) like '%examiniert%') role_ok,
          (case when ${pub} ~ '^\\d{2}\\.\\d{2}\\.\\d{4}$' then to_date(${pub},'DD.MM.YYYY') end) pub_date,
          not (lower(c.name) ~ 'caritas|arbeiterwohlfahrt|johanniter|diakonie|deutsches rotes kreuz|malteser|lebenshilfe|stiftung|ggmbh| e\\.v\\.?|verein|zeitarbeit|personalvermittlung|personaldienst|staffing') name_ok,
          ((coalesce(c.metadata->>'jobWorkload','')='' or lower(c.metadata->>'jobWorkload') like '%vollzeit%') and lower(coalesce(c.metadata->>'jobWorkload','')) !~ 'nur teilzeit|minijob|geringfügig') workload_ok
        from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace left join sales_contacts ct on ct.id=l.contact_id
        where l.workspace='default' and l.status='active'
      )
      select
        count(*)::int aktive_leads,
        count(*) filter (where is_pflege)::int pflege,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false))::int ohne_dnc,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert'))::int status_passt,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert') and has_phone)::int mit_nummer,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert') and has_phone and coalesce(nullif(owner,''),'Raphael') in ('Raphael','Mattias'))::int mit_besitzer,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert') and has_phone and coalesce(nullif(owner,''),'Raphael') in ('Raphael','Mattias') and role_ok)::int pflegefachkraft,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert') and has_phone and coalesce(nullif(owner,''),'Raphael') in ('Raphael','Mattias') and role_ok and pub_date is not null)::int mit_datum,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert') and has_phone and coalesce(nullif(owner,''),'Raphael') in ('Raphael','Mattias') and role_ok and (pub_date is null or pub_date <= current_date - ${CALL_MIN_JOB_AGE_DAYS}))::int alt_genug_oder_ohne_datum,
        count(*) filter (where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert') and has_phone and coalesce(nullif(owner,''),'Raphael') in ('Raphael','Mattias') and role_ok and (pub_date is null or pub_date <= current_date - ${CALL_MIN_JOB_AGE_DAYS}) and name_ok and workload_ok)::int am_ende_uebrig
      from base`);
    const tiers = await query<{ tier: string; n: number }>(`
      with base as (
        select coalesce(c.metadata->'daily_qualification'->>'tier','(ohne Stufe)') tier, l.stage, l.owner, l.do_not_contact, coalesce(ct.phone,c.phone,'')<>'' has_phone, ${leadSegmentSql("c")}='pflege' is_pflege,
          (lower(coalesce(c.metadata->>'jobRole',''))='pflegefachkraft' or lower(coalesce(c.metadata->>'jobAdUrl','')) like '%/pflegefachkraft/%' or lower(coalesce(c.metadata->>'jobTitle','')) like '%pflegefach%'
            or lower(coalesce(l.notes,'')) like '%pflegefach%' or lower(coalesce(l.notes,'')) like '%altenpfleger%' or lower(coalesce(l.notes,'')) like '%examiniert%') role_ok,
          (case when ${pub} ~ '^\\d{2}\\.\\d{2}\\.\\d{4}$' then to_date(${pub},'DD.MM.YYYY') end) pub_date,
          not (lower(c.name) ~ 'caritas|arbeiterwohlfahrt|johanniter|diakonie|deutsches rotes kreuz|malteser|lebenshilfe|stiftung|ggmbh| e\\.v\\.?|verein|zeitarbeit|personalvermittlung|personaldienst|staffing') name_ok,
          ((coalesce(c.metadata->>'jobWorkload','')='' or lower(c.metadata->>'jobWorkload') like '%vollzeit%') and lower(coalesce(c.metadata->>'jobWorkload','')) !~ 'nur teilzeit|minijob|geringfügig') workload_ok
        from sales_leads l join sales_companies c on c.id=l.company_id and c.workspace=l.workspace left join sales_contacts ct on ct.id=l.contact_id
        where l.workspace='default' and l.status='active'
      )
      select tier, count(*)::int n from base
      where is_pflege and not coalesce(do_not_contact,false) and stage in ('Neu','Research','Bereit','Kontaktiert') and has_phone and coalesce(nullif(owner,''),'Raphael') in ('Raphael','Mattias') and role_ok
        and (pub_date is null or pub_date <= current_date - ${CALL_MIN_JOB_AGE_DAYS}) and name_ok and workload_ok
      group by 1 order by 2 desc`);
    const owners = await query(`select coalesce(owner,'') owner, count(*)::int n from sales_leads where workspace='default' and status='active' group by 1 order by 2 desc limit 6`);
    return Response.json({ hinweis: "Von oben nach unten: jede Zeile ist eine weitere Bedingung. Wo die Zahl stark fällt, liegt der Engpass.", trichter: row, besitzerVerteilung: owners, stufenDerUebrigenLeads: tiers, mindestAlterTage: CALL_MIN_JOB_AGE_DAYS });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Diagnose fehlgeschlagen." }, { status: 500 });
  }
}
