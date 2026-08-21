"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: String(form.get("password") || "") }),
    });
    const json = await response.json() as { error?: string };
    if (response.ok) router.push("/");
    else setError(json.error || "Login fehlgeschlagen");
    setLoading(false);
  }

  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20, color: "#121316" }}>
    <form onSubmit={submit} style={{ width: "min(460px,100%)", border: "1px solid rgba(255,255,255,.9)", borderRadius: 28, padding: 34, background: "linear-gradient(145deg,rgba(255,255,255,.86),rgba(255,255,255,.62))", boxShadow: "0 30px 100px rgba(27,31,38,.14),inset 0 1px 0 #fff", backdropFilter: "blur(34px) saturate(180%)" }}>
      <div style={{ width: 50, height: 50, borderRadius: 16, display: "grid", placeItems: "center", background: "linear-gradient(145deg,#2e3034,#101113)", color: "#fff", fontWeight: 900, boxShadow: "inset 0 1px 0 rgba(255,255,255,.2),0 10px 28px rgba(18,19,23,.17)" }}>DG</div>
      <div style={{ fontSize: 9, letterSpacing: ".16em", color: "#96742f", fontWeight: 850, marginTop: 25 }}>DIGITALE GEWINNER · PFLEGE RECRUITING OS</div>
      <h1 style={{ fontSize: 35, letterSpacing: "-.055em", fontWeight: 650, margin: "10px 0 8px" }}>Willkommen zurück.</h1>
      <p style={{ color: "#767a82", lineHeight: 1.65, fontSize: 12, margin: "0 0 25px" }}>Akquise, CRM, Kampagnen, Studio und CloudTalk in einem geschützten Workspace.</p>
      <label style={{ display: "grid", gap: 8, color: "#858990", fontSize: 9, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 750 }}>Admin-Passwort
        <input name="password" type="password" autoFocus required style={{ border: "1px solid rgba(78,83,91,.1)", background: "rgba(255,255,255,.62)", color: "#18191c", borderRadius: 12, padding: "14px 15px", boxShadow: "inset 0 1px 0 #fff" }} />
      </label>
      {error && <p style={{ color: "#b4433d", fontSize: 10 }}>{error}</p>}
      <button disabled={loading} style={{ width: "100%", marginTop: 18, border: "1px solid rgba(20,21,24,.92)", borderRadius: 12, padding: 14, fontWeight: 850, background: "linear-gradient(155deg,#303236,#121316)", color: "#fff", cursor: "pointer", boxShadow: "inset 0 1px 0 rgba(255,255,255,.14),0 10px 26px rgba(17,18,20,.17)" }}>{loading ? "Prüfe…" : "Outbound OS öffnen"}</button>
      <div style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 18, color: "#93979e", fontSize: 9 }}><i style={{ width: 7, height: 7, borderRadius: 99, background: "#34c759", boxShadow: "0 0 12px rgba(52,199,89,.45)" }} /> Geschützter Production Workspace</div>
    </form>
  </main>;
}
