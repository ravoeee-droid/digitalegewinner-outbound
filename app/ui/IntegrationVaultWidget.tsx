"use client";

import { FormEvent, useState } from "react";

type Item = { key: string; configured: boolean; updatedAt?: string };
const fields = [
  ["experiential_api_key", "Experiential Labs API Key · DG Core Primary", "password"],
  ["groq_api_key", "Groq API Key · DG Core Fallback", "password"],
  ["openai_api_key", "OpenAI API Key · optional", "password"],
  ["google_maps_api_key", "Google Maps + Solar API Key", "password"],
  ["email_verifier_api_key", "E-Mail Verifier API Key (optional)", "password"],
  ["google_client_id", "Google OAuth Client ID", "text"],
  ["google_client_secret", "Google OAuth Client Secret", "password"],
  ["microsoft_client_id", "Microsoft OAuth Client ID", "text"],
  ["microsoft_client_secret", "Microsoft OAuth Client Secret", "password"],
  ["video_renderer_url", "Loom / Video Renderer API URL", "text"],
  ["video_renderer_secret", "Loom / Video Renderer Secret", "password"],
  ["mailbox_credentials_json", "Mailbox Credentials JSON (optional fallback)", "password"],
] as const;

export default function IntegrationVaultWidget() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/integrations", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { items?: Item[] };
      setItems(data.items || []);
    } catch {}
  }

  async function save(event: FormEvent<HTMLFormElement>, key: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = String(data.get("value") || "");
    const response = await fetch("/api/integrations", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const result = await response.json() as { error?: string };
    setMessage(response.ok ? "Verschlüsselt gespeichert. DG Core kann den Provider jetzt verwenden." : (result.error || "Fehler"));
    if (response.ok) {
      form.reset();
      await load();
    }
  }

  function connect(provider: "google" | "microsoft") {
    const mailboxId = window.prompt("Credential-ID für dieses Postfach (z. B. mb-raphael):");
    if (!mailboxId) return;
    const name = window.prompt("Absendername (optional):") || "";
    location.href = `/api/oauth/${provider}/start?mailboxId=${encodeURIComponent(mailboxId)}&name=${encodeURIComponent(name)}`;
  }

  const configured = new Set(items.map((item) => item.key));
  const googleReady = configured.has("google_client_id") && configured.has("google_client_secret");
  const microsoftReady = configured.has("microsoft_client_id") && configured.has("microsoft_client_secret");
  const agentReady = configured.has("experiential_api_key") || configured.has("groq_api_key");

  return <>
    <button
      onClick={() => { setOpen(true); void load(); }}
      style={{ position: "fixed", right: 24, bottom: 24, zIndex: 80, border: "1px solid #315e49", background: "rgba(7,20,17,.92)", color: "#74edb4", padding: "11px 14px", borderRadius: 13, fontWeight: 850, cursor: "pointer", boxShadow: "0 18px 45px rgba(0,0,0,.35)", backdropFilter: "blur(16px)" }}
    >{agentReady ? "● DG Core verbunden" : "⚙ API-Tresor"}</button>
    {open && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(3,6,10,.82)", backdropFilter: "blur(10px)", display: "grid", placeItems: "center", padding: 20 }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width: "min(820px,100%)", maxHeight: "88vh", overflow: "auto", background: "#071115", border: "1px solid #24463b", borderRadius: 24, padding: 24, color: "#eefcf7", fontFamily: "Inter,system-ui", boxShadow: "0 35px 120px rgba(0,0,0,.55)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 10, color: "#61e9a8", fontWeight: 850, letterSpacing: ".15em" }}>ENCRYPTED INTEGRATION VAULT</div>
            <h2 style={{ margin: "7px 0", fontSize: 28 }}>DG Core & Integrationen</h2>
            <p style={{ margin: 0, color: "#78938a", fontSize: 13, lineHeight: 1.55 }}>Secrets werden serverseitig AES-verschlüsselt gespeichert und nie wieder im Klartext ausgegeben.</p>
          </div>
          <button onClick={() => setOpen(false)} style={{ border: 0, background: "#13211f", color: "#fff", width: 36, height: 36, borderRadius: 10, cursor: "pointer" }}>×</button>
        </div>
        {message && <div style={{ marginTop: 16, padding: 10, borderRadius: 10, background: "#10251c", color: "#69e8ad", fontSize: 12 }}>{message}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
          <button disabled={!googleReady} onClick={() => connect("google")} style={{ border: "1px solid #30483f", borderRadius: 12, padding: 13, background: "#101c1a", color: googleReady ? "#fff" : "#596e67", fontWeight: 850, cursor: googleReady ? "pointer" : "not-allowed" }}>Google-Mailbox verbinden</button>
          <button disabled={!microsoftReady} onClick={() => connect("microsoft")} style={{ border: "1px solid #30483f", borderRadius: 12, padding: 13, background: "#101c1a", color: microsoftReady ? "#fff" : "#596e67", fontWeight: 850, cursor: microsoftReady ? "pointer" : "not-allowed" }}>Microsoft-Mailbox verbinden</button>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
          {fields.map(([key, label, type]) => <form key={key} onSubmit={(event) => void save(event, key)} style={{ border: "1px solid #1b332c", borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: "minmax(190px,.9fr) minmax(220px,1.5fr) auto", gap: 10, alignItems: "center" }}>
            <div><strong style={{ fontSize: 12 }}>{label}</strong><small style={{ display: "block", marginTop: 4, color: configured.has(key) ? "#61e9a8" : "#60766f", fontSize: 10 }}>{configured.has(key) ? "✓ sicher gespeichert" : "nicht hinterlegt"}</small></div>
            <input name="value" type={type} autoComplete="off" placeholder={configured.has(key) ? "Neuen Wert zum Ersetzen eingeben" : "Wert eintragen"} style={{ minWidth: 0, border: "1px solid #27463d", background: "#050c0b", color: "#fff", borderRadius: 10, padding: "11px 12px" }} />
            <button style={{ border: 0, borderRadius: 10, padding: "11px 14px", background: "#5de9a7", color: "#062117", fontWeight: 900, cursor: "pointer" }}>Speichern</button>
          </form>)}
        </div>
      </div>
    </div>}
  </>;
}
