let token = "";
export function setTrackToken(value: string) { token = value; }

// Sendet ein Ereignis an die Auswertung; läuft auch beim Schließen der Seite (sendBeacon).
export function track(event: string, value = 0) {
  if (!token || token === "demo") return;
  try {
    const body = JSON.stringify({ t: token, e: event, v: value });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/t/video", new Blob([body], { type: "application/json" }));
    else fetch("/api/t/video", { method: "POST", body, keepalive: true }).catch(() => null);
  } catch { /* Tracking darf die Seite nie stören */ }
}
