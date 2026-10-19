import { query } from "@/lib/db";
import { V3_SCHEMA_STATEMENTS } from "@/lib/v3-schema";

// Legt die Tabellen des Outbound OS V3 an (Compliance, Experimente, Konversationen, Attribution ...).
// Zwei Durchläufe, damit Tabellen mit Verweisen auf spätere Tabellen noch angelegt werden. Einzelne Fehler werden übersprungen.
export async function applyV3Schema() {
  let pending = V3_SCHEMA_STATEMENTS;
  for (let pass = 0; pass < 3 && pending.length; pass += 1) {
    const failed: string[] = [];
    for (const statement of pending) {
      try { await query(statement); } catch { failed.push(statement); }
    }
    if (failed.length === pending.length) break;
    pending = failed;
  }
  return { open: pending.length };
}
