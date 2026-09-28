"use client";

function normalizeEmbedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const isGoogleAppointmentSchedule =
      url.hostname === "calendar.google.com" &&
      url.pathname.startsWith("/calendar/appointments/schedules/");
    if (isGoogleAppointmentSchedule && !url.searchParams.has("gv")) {
      url.searchParams.set("gv", "true");
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export default function CalendarEmbed({
  leadId,
  href,
  label = "Termin auswählen",
}: {
  leadId: string;
  href: string;
  label?: string;
}) {
  const embedSrc = normalizeEmbedUrl(href);

  function track() {
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId, type: "cta_click" }),
      keepalive: true,
    }).catch(() => undefined);
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div
        style={{
          border: "1px solid #223244",
          borderRadius: 18,
          overflow: "hidden",
          background: "#05080d",
          boxShadow: "0 20px 60px rgba(0,0,0,.25)",
        }}
      >
        <iframe
          src={embedSrc}
          title="Termin buchen"
          loading="lazy"
          style={{
            width: "100%",
            minHeight: 620,
            border: 0,
            display: "block",
            background: "#fff",
          }}
        />
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={track}
        style={{
          justifySelf: "start",
          fontSize: 12,
          color: "#68e9aa",
          textDecoration: "underline",
        }}
      >
        Lädt der Kalender nicht? {label} in neuem Tab öffnen
      </a>
    </div>
  );
}
