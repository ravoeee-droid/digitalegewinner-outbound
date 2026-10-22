// Kopiert die komplette Datenbank (Erweiterungen, Tabellen, Daten, Indizes, Sequenzen) von der bisherigen auf die Datenbank in NEW_DATABASE_URL.
// Die Quelle wird nur gelesen. Das Ziel wird bei jedem Lauf komplett neu aufgebaut.
import { Pool } from "pg";

const BATCH = 500;
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const hostOf = (value?: string) => { try { return new URL(value || "").host.replace(/-pooler/, ""); } catch { return ""; } };

export function migrationConfig() {
  const source = process.env.POSTGRES_URL || process.env.DATABASE_URL || "";
  const target = process.env.NEW_DATABASE_URL || "";
  if (process.env.DB_CUTOVER === "1") throw new Error("Umstellung ist bereits aktiv, Kopieren gesperrt.");
  if (!source) throw new Error("Keine Quell-Datenbank konfiguriert.");
  if (!target) throw new Error("NEW_DATABASE_URL fehlt.");
  const sourceHosts = [process.env.POSTGRES_URL, process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED, process.env.POSTGRES_URL_NON_POOLING].map(hostOf).filter(Boolean);
  if (sourceHosts.includes(hostOf(target))) throw new Error("NEW_DATABASE_URL zeigt auf die Quell-Datenbank. Abbruch.");
  return { source, target };
}

const pool = (url: string, max: number) => new Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max, connectionTimeoutMillis: 10_000 });

export async function copyDatabase() {
  const startedAt = Date.now();
  const { source, target } = migrationConfig();
  const from = pool(source, 2);
  const to = pool(target, 1);
  const q = async <T = Record<string, unknown>>(sql: string, values: unknown[] = []) => (await from.query(sql, values)).rows as T[];
  try {
    const tables = (await q<{ t: string }>("select tablename t from pg_tables where schemaname='public' order by tablename")).map((row) => row.t);
    await to.query("drop schema public cascade; create schema public;");
    for (const ext of await q<{ n: string }>("select extname n from pg_extension where extname<>'plpgsql'")) await to.query(`create extension if not exists ${quote(ext.n)}`).catch(() => undefined);
    const problems: string[] = [];
    const indexSql: string[] = [];
    for (const table of tables) {
      const rel = `public.${quote(table)}`;
      const cols = await q<{ name: string; type: string; notnull: boolean; def: string | null; generated: string }>(
        `select a.attname name, format_type(a.atttypid,a.atttypmod) type, a.attnotnull notnull, pg_get_expr(d.adbin,d.adrelid) def, a.attgenerated generated
           from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
          where a.attrelid=$1::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`, [rel]);
      const cons = await q<{ def: string }>("select pg_get_constraintdef(oid) def from pg_constraint where conrelid=$1::regclass and contype in ('p','u','c')", [rel]);
      const seqs = await q<{ seq: string }>("select s.relname seq from pg_class s join pg_depend d on d.objid=s.oid and d.deptype in ('a','i') where s.relkind='S' and d.refobjid=$1::regclass", [rel]);
      const idx = await q<{ def: string }>("select indexdef def from pg_indexes where schemaname='public' and tablename=$1 and indexname not in (select conname from pg_constraint where conrelid=$2::regclass)", [table, rel]);
      try {
        for (const s of seqs) await to.query(`create sequence if not exists ${quote(s.seq)}`);
        const lines = cols.map((c) => `${quote(c.name)} ${c.type}${c.def && !c.generated ? ` default ${c.def.replace(/nextval\('public\./g, "nextval('")}` : ""}${c.notnull ? " not null" : ""}`);
        await to.query(`create table ${quote(table)} (${[...lines, ...cons.map((x) => x.def)].join(", ")})`);
        indexSql.push(...idx.map((i) => i.def));
      } catch (error) { problems.push(`Schema ${table}: ${error instanceof Error ? error.message : error}`); }
    }
    const counts: Record<string, [number, number]> = {};
    for (const table of tables) {
      try {
        const total = Number((await q<{ n: string }>(`select count(*)::text n from ${quote(table)}`))[0]?.n || 0);
        let copied = 0;
        while (copied < total) {
          const rows = await q<{ j: unknown }>(`select row_to_json(t) j from (select * from ${quote(table)} order by ctid offset $1 limit ${BATCH}) t`, [copied]);
          if (!rows.length) break;
          await to.query(`insert into ${quote(table)} select * from json_populate_recordset(null::${quote(table)}, $1::json)`, [JSON.stringify(rows.map((r) => r.j))]);
          copied += rows.length;
        }
        const targetCount = Number((await to.query(`select count(*)::text n from ${quote(table)}`)).rows[0].n);
        counts[table] = [total, targetCount];
        if (targetCount !== total) problems.push(`Daten ${table}: Quelle ${total}, Ziel ${targetCount}`);
      } catch (error) { problems.push(`Daten ${table}: ${error instanceof Error ? error.message : error}`); }
    }
    for (const sql of indexSql) await to.query(sql).catch((error) => problems.push(`Index: ${error instanceof Error ? error.message : error}`));
    for (const s of await q<{ seq: string; value: string | null }>("select sequencename seq, last_value::text value from pg_sequences where schemaname='public'")) {
      if (s.value) await to.query("select setval($1::regclass,$2::bigint)", [`public.${quote(s.seq)}`, s.value]).catch(() => undefined);
    }
    const rows = Object.values(counts).reduce((sum, [n]) => sum + n, 0);
    return { ok: problems.length === 0, tables: tables.length, rows, problems, seconds: Math.round((Date.now() - startedAt) / 1000) };
  } finally {
    await from.end().catch(() => undefined);
    await to.end().catch(() => undefined);
  }
}
