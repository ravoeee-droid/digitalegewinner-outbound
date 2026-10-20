// Die kostenlose Test-Datenbank (neon.new) wird gelöscht, wenn sie nicht übernommen wird.
// Ablaufzeit und Übernahme-Link stehen in den Umgebungsvariablen DB_EXPIRES_AT und DB_CLAIM_URL (nur gesetzt, solange nötig).
export function dbExpiry() {
  const at = Date.parse(process.env.DB_EXPIRES_AT || "");
  const claimUrl = (process.env.DB_CLAIM_URL || "").trim();
  if (!Number.isFinite(at) || !/^https:\/\//.test(claimUrl)) return null;
  const hoursLeft = Math.round((at - Date.now()) / 3600000);
  if (hoursLeft < -1) return null;
  return { at: new Date(at).toISOString(), claimUrl, hoursLeft: Math.max(0, hoursLeft) };
}
