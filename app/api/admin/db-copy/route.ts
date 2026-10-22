import { NextResponse } from "next/server";
import { Pool } from "pg";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Kopiert die gesamte Datenbank (Tabellen, Indizes, Daten) von DATABASE_URL/POSTGRES_URL auf die Datenbank in NEW_DATABASE_URL.
// Login über den Admin-Cookie. Ablauf: ?step=schema → danach ?step=data wiederholen, bis "fertig": true. Ohne step nur Übersicht.
// Das Ziel wird bei "schema" geleert und neu aufgebaut; die Quelle wird nur gelesen.
const BATCH = 500;
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

function targetPool() {
  const url = process.env.NEW_DATABASE_URL;
  if (!url) throw new Error("NEW_DATABASE_URL fehlt in Vercel.");
  // Schutz: nie die Quelle selbst überschreiben.
  const hostOf = (value?: string) => { try { return new URL(value || "").host; } catch { return ""; } };
  const sources = [process.env.DATABASE_URL, process.env.POSTGRES_URL, process.env.DATABASE_URL_UNPOOLED, process.env.POSTGRES_URL_NON_POOLING].map(hostOf).filter(Boolean);
  if (sources.includes(hostOf(url).replace(/-pooler/, "")) || sources.map((h) => h.replace(/-pooler/, "")).includes(hostOf(url).replace(/-pooler/, ""))) throw new Error("NEW_DATABASE_URL zeigt auf die Quell-Datenbank. Abbruch.");
  return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 8000 });
}

async function tables() {
  return (await query<{ t: string }>("select tablename t from pg_tables where schemaname='public' order by tablename")).map((row) => row.t);
}

async function ddl(table: string) {
  const cols = await query<{ name: string; type: string; notnull: boolean; def: string | null; generated: string }>(
    `select a.attname name, format_type(a.atttypid,a.atttypmod) type, a.attnotnull notnull, pg_get_expr(d.adbin,d.adrelid) def, a.attgenerated generated
       from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
      where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`,
    [`public.${quote(table)}`],
  );
  const lines = cols.map((c) => `${quote(c.name)} ${c.type}${c.def && !c.generated ? ` default ${c.def.replace(/nextval\('([^']+)'::regclass\)/g, (_m, seq) => `nextval('${String(seq).replace(/^public\./, "")}'::regclass)`)}` : ""}${c.notnull ? " not null" : ""}`);
  const pk = await query<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conrelid=$1::regclass and contype in ('p','u','c')", [`public.${quote(table)}`]);
  const seqs = await query<{ seq: string }>(
    "select s.relname seq from pg_class s join pg_depend d on d.objid=s.oid and d.deptype in ('a','i') join pg_class t on t.oid=d.refobjid where s.relkind='S' and t.oid=$1::regclass",
    [`public.${quote(table)}`],
  );
  const idx = await query<{ def: string }>("select indexdef def from pg_indexes where schemaname='public' and tablename=$1 and indexname not in (select conname from pg_constraint where conrelid=$2::regclass)", [table, `public.${quote(table)}`]);
  return { create: `create table ${quote(table)} (${[...lines, ...pk.map((p) => p.def)].join(", ")})`, seqs: seqs.map((s) => s.seq), idx: idx.map((i) => i.def) };
}

export async function GET(request: Request) {
  const step = new URL(request.url).searchParams.get("step") || "";
  const list = await tables();
  if (!step) {
    const counts = await Promise.all(list.map(async (t) => ({ tabelle: t, zeilen: Number((await query<{ n: string }>(`select count(*)::text n from ${quote(t)}`))[0]?.n || 0) })));
    return NextResponse.json({ hinweis: "?step=schema, danach ?step=data wiederholen", tabellen: counts });
  }
  const target = targetPool();
  try {
    if (step === "schema") {
      await target.query("drop schema public cascade; create schema public;");
      const failed: string[] = [];
      for (const table of list) {
        const info = await ddl(table);
        try {
          for (const seq of info.seqs) await target.query(`create sequence if not exists ${quote(seq)}`);
          await target.query(info.create);
        } catch (error) { failed.push(`${table}: ${error instanceof Error ? error.message : error}`); }
      }
      return NextResponse.json({ schema: failed.length ? "teilweise" : "ok", tabellen: list.length, fehler: failed, naechster_schritt: "?step=data" });
    }
    if (step === "data") {
      const startedAt = Date.now();
      const [{ n: doneCount }] = await target.query("select count(*)::int n from information_schema.tables where table_schema='public' and table_name='_copy_progress'").then((r) => r.rows);
      if (!doneCount) await target.query("create table _copy_progress(tbl text primary key, copied bigint not null default 0, done boolean not null default false)");
      const progress = new Map((await target.query("select tbl,copied,done from _copy_progress")).rows.map((r) => [r.tbl as string, { copied: Number(r.copied), done: Boolean(r.done) }]));
      for (const table of list) {
        const state = progress.get(table) || { copied: 0, done: false };
        if (state.done) continue;
        const total = Number((await query<{ n: string }>(`select count(*)::text n from ${quote(table)}`))[0]?.n || 0);
        while (state.copied < total) {
          if (Date.now() - startedAt > 240_000) return NextResponse.json({ fertig: false, hinweis: "Zeitlimit, ?step=data erneut aufrufen", aktuell: table, kopiert: state.copied, von: total });
          const rows = await query<{ j: unknown }>(`select row_to_json(t) j from (select * from ${quote(table)} order by ctid offset $1 limit ${BATCH}) t`, [state.copied]);
          if (!rows.length) break;
          await target.query(`insert into ${quote(table)} select * from json_populate_recordset(null::${quote(table)}, $1::json)`, [JSON.stringify(rows.map((r) => r.j))]);
          state.copied += rows.length;
          await target.query("insert into _copy_progress(tbl,copied) values($1,$2) on conflict(tbl) do update set copied=excluded.copied", [table, state.copied]);
        }
        await target.query("insert into _copy_progress(tbl,copied,done) values($1,$2,true) on conflict(tbl) do update set copied=excluded.copied, done=true", [table, state.copied]);
      }
      // Indizes und Sequenzstände erst nach dem Kopieren (schneller).
      const problems: string[] = [];
      for (const table of list) {
        const info = await ddl(table);
        for (const sql of info.idx) { try { await target.query(sql); } catch (error) { problems.push(`${table}: ${error instanceof Error ? error.message : error}`); } }
      }
      const seqs = await query<{ seq: string; value: string | null }>("select sequencename seq, last_value::text value from pg_sequences where schemaname='public'");
      for (const s of seqs) if (s.value) await target.query("select setval($1::regclass,$2::bigint)", [`public.${quote(s.seq)}`, s.value]).catch(() => undefined);
      await target.query("drop table if exists _copy_progress");
      return NextResponse.json({ fertig: true, tabellen: list.length, indexfehler: problems });
    }
    return NextResponse.json({ error: "Unbekannter step" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Fehler" }, { status: 500 });
  } finally {
    await target.end().catch(() => undefined);
  }
}
