// Server-only D1 transport. Never import this module from a client component.
export type D1Value = string | number | null;
export type D1Statement = { sql: string; params?: D1Value[] };
type D1Result<T> = { success: boolean; results?: T[]; error?: string };
type D1Response<T> = { success: boolean; result?: D1Result<T>[]; errors?: Array<{ code?: number }> };

export function d1Configured() {
  return Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_D1_DATABASE_ID && process.env.CLOUDFLARE_D1_API_TOKEN);
}

export function d1Enabled() {
  return Boolean(process.env.CLOUDFLARE_D1_DATABASE_ID || process.env.CLOUDFLARE_D1_API_TOKEN);
}

export async function d1Batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<T[][]> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const database = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_D1_API_TOKEN;
  if (!account || !database || !token) throw new Error("Cloudflare-D1-Verbindung ist unvollständig.");
  if (!/^[a-f0-9]{32}$/.test(account) || !/^[a-f0-9-]{36}$/.test(database)) throw new Error("Ungültige Cloudflare-D1-Zielkennung.");
  if (!statements.length) return [];
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(statements.length === 1 ? statements[0] : { batch: statements }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  // Do not echo SQL, parameters, credentials or upstream error text into API responses.
  const data = await response.json().catch(() => null) as D1Response<T> | null;
  if (!response.ok || !data?.success || !data.result || data.result.length !== statements.length || data.result.some(item => !item.success)) {
    throw new Error(`Cloudflare-D1-Abfrage fehlgeschlagen (HTTP ${response.status}).`);
  }
  return data.result.map(item => item.results ?? []);
}

export async function d1Query<T = Record<string, unknown>>(sql: string, params: D1Value[] = []): Promise<T[]> {
  return (await d1Batch<T>([{ sql, params }]))[0];
}
