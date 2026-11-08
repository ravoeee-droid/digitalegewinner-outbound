import { query, log } from "./lib.mjs";

// Aus der Anreicherung abgeleitete Merkmale pro Firma.
export function signalsOf(web, meta, google, social) {
  const s = [];
  if (web) {
    if (!web.mobileReady) s.push("web:nicht_mobil"); if (!web.https) s.push("web:kein_https");
    if (web.mentionsJobs && !web.hasJobPostingSchema) s.push("web:jobs_ohne_schema");
    if (!web.hasContactForm) s.push("web:kein_kontaktformular");
    if (!web.tracking?.length) s.push("web:kein_tracking");
    if (web.copyrightYear && web.copyrightYear < new Date().getFullYear() - 2) s.push("web:veraltet");
    for (const t of web.tech || []) s.push(`tech:${t}`);
    if (web.people?.length) s.push("web:ansprechpartner_bekannt");
  }
  if (meta?.runsAds) s.push("ads:meta"); if (google?.runsAds) s.push("ads:google");
  if (social && Object.values(social).some((v) => v.followers)) s.push("social:aktiv");
  return s;
}

// Reine Funktion: Rate je Signal gegen die Basisrate; Lift wird mit wenigen Daten zur 1 hin geglättet.
export function computeLift(rows, minCalls = 15) {
  const total = rows.length, base = rows.filter((r) => r.positive).length / Math.max(1, total);
  const agg = new Map();
  for (const r of rows) for (const s of r.signals) { const a = agg.get(s) || { calls: 0, positives: 0 }; a.calls++; if (r.positive) a.positives++; agg.set(s, a); }
  return [...agg].filter(([, a]) => a.calls >= minCalls).map(([signal, a]) => {
    const rate = a.positives / a.calls, k = 20; // Glättung
    const smoothed = (a.positives + base * k) / (a.calls + k);
    return { signal, calls: a.calls, positives: a.positives, rate, lift: base > 0 ? smoothed / base : 1 };
  }).sort((x, y) => y.lift - x.lift);
}

export async function runLearning() {
  const rows = await query(`
    select a.company_id, a.meta->>'callOutcome' outcome,
      max(case when e.source='website' then e.data::text end) web, max(case when e.source='meta_ads' then e.data::text end) meta,
      max(case when e.source='google_ads' then e.data::text end) google, max(case when e.source='social' then e.data::text end) social
    from sales_activities a join lead_enrichment e on e.company_id=a.company_id and e.status='ok'
    where a.type='call.outcome' and a.meta->>'callOutcome' is not null group by a.id, a.company_id, a.meta->>'callOutcome'`);
  const data = rows.map((r) => ({ positive: ["appointment", "pain", "website_requested", "info_mail"].includes(r.outcome),
    signals: signalsOf(r.web && JSON.parse(r.web), r.meta && JSON.parse(r.meta), r.google && JSON.parse(r.google), r.social && JSON.parse(r.social)) }));
  const lifts = computeLift(data);
  for (const l of lifts) await query(`insert into lead_learning_signals(signal,calls,positives,rate,lift,updated_at) values($1,$2,$3,$4,$5,now())
    on conflict(signal) do update set calls=$2,positives=$3,rate=$4,lift=$5,updated_at=now()`, [l.signal, l.calls, l.positives, l.rate.toFixed(4), l.lift.toFixed(4)]);
  log(`Learning: ${data.length} Calls mit Anreicherung, ${lifts.length} Signale aktualisiert`);
  return lifts.length;
}

// Gelernter Bonus (-10..+10) je Firma; wird nur in metadata.learned_boost geschrieben, das Ranking der Queue bleibt unverändert.
export async function applyBoosts() {
  const sig = new Map((await query("select signal,lift from lead_learning_signals")).map((r) => [r.signal, Number(r.lift)]));
  if (!sig.size) return 0;
  const rows = await query(`select company_id,
    max(case when source='website' then data::text end) web, max(case when source='meta_ads' then data::text end) meta,
    max(case when source='google_ads' then data::text end) google, max(case when source='social' then data::text end) social
    from lead_enrichment where status='ok' group by company_id`);
  let n = 0;
  for (const r of rows) {
    const s = signalsOf(r.web && JSON.parse(r.web), r.meta && JSON.parse(r.meta), r.google && JSON.parse(r.google), r.social && JSON.parse(r.social)).filter((x) => sig.has(x));
    const boost = Math.max(-10, Math.min(10, Math.round(s.reduce((acc, x) => acc + Math.log(sig.get(x)) * 10, 0))));
    await query(`update sales_companies set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('learned_boost',$2::int,'learned_signals',$3::jsonb) where id=$1`, [r.company_id, boost, JSON.stringify(s)]);
    n++;
  }
  return n;
}
