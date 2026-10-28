let token = "";
let variant: "A" | "B" = "A";
export function setTrackVariant(value: "A" | "B") { variant = value; }
export function setTrackToken(value: string) { token = value; }

// Sendet ein Ereignis an die Auswertung; läuft auch beim Schließen der Seite (sendBeacon).
export function track(event: string, value = 0) {
  if (!token || token === "demo" || new URLSearchParams(window.location.search).get("preview") === "1") return;
  try {
    // Stable within one browser tab, different for separate sessions.
    // Client time is diagnostic only; the server timestamp remains authoritative.
    let sid = "";
    try {
      sid = sessionStorage.getItem("dg-video-session:" + token) || "";
      if (!sid) { sid = crypto.randomUUID(); sessionStorage.setItem("dg-video-session:" + token, sid); }
    } catch { /* private mode: tracking works without session id */ }
    const body = JSON.stringify({ t: token, e: event, v: value, a: variant, sid, ts: Date.now() });
    // sendBeacon may return false when the browser queue is full: fall back to fetch.
    const queued = navigator.sendBeacon?.("/api/t/video", new Blob([body], { type: "application/json" })) ?? false;
    if (!queued) fetch("/api/t/video", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => null);
  } catch { /* Tracking darf die Seite nie stören */ }
}
