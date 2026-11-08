// TinyFish Agent API (https://docs.tinyfish.ai): ein Browser-Agent löst ein Ziel auf einer Seite und liefert strukturierte Daten.
// Braucht TINYFISH_API_KEY. Ein Tageslimit (TINYFISH_DAILY_LIMIT, Standard 150 Läufe) schützt vor ungewollten Kosten.
import { sleep } from "../lib.mjs";

const BASE = "https://agent.tinyfish.ai/v1";
let day = "", used = 0;

export const tinyfishEnabled = () => Boolean(process.env.TINYFISH_API_KEY);

export function parseAgentResult(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  const s = String(raw);
  const block = s.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] || s.match(/[\[{][\s\S]*[\]}]/)?.[0] || s;
  try { return JSON.parse(block); } catch { return { text: s.slice(0, 2000) }; }
}

export async function tinyfishRun({ url, goal, maxSteps = 25, maxSeconds = 120 }) {
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) { day = today; used = 0; }
  if (used >= Number(process.env.TINYFISH_DAILY_LIMIT || 150)) throw new Error("TinyFish-Tageslimit erreicht");
  used++;
  const headers = { "X-API-Key": process.env.TINYFISH_API_KEY, "content-type": "application/json" };
  const start = await fetch(`${BASE}/automation/run-async`, { method: "POST", headers, body: JSON.stringify({ url, goal, agent_config: { max_steps: maxSteps, max_duration_seconds: maxSeconds } }), signal: AbortSignal.timeout(20000) });
  const q = await start.json().catch(() => ({}));
  const id = q.run_id ?? q.id;
  if (!start.ok || !id) throw new Error(q.error?.message || q.error || `TinyFish HTTP ${start.status}`);
  const until = Date.now() + (maxSeconds + 30) * 1000;
  while (Date.now() < until) {
    await sleep(3000);
    const r = await fetch(`${BASE}/runs/${id}`, { headers: { "X-API-Key": headers["X-API-Key"] }, signal: AbortSignal.timeout(15000) });
    const run = await r.json().catch(() => ({}));
    if (run.status === "COMPLETED") return parseAgentResult(run.result ?? run.output ?? run.result_json);
    if (run.status === "FAILED" || run.status === "CANCELLED") throw new Error(`TinyFish ${run.status}: ${run.error?.message || run.error || ""}`.trim());
  }
  throw new Error("TinyFish Zeitüberschreitung");
}
