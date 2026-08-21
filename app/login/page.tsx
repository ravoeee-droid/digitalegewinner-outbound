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

  return <main className="login-launch">
    <form onSubmit={submit}>
      <div className="login-mark">DG</div>
      <span className="launch-kicker">DIGITALE GEWINNER · PFLEGE RECRUITING OS</span>
      <h1>Willkommen zurück.</h1>
      <p>Dein fokussierter Workspace für Pflege-Akquise: Lead Intelligence, CloudTalk Calls, Kampagnen, Video, Inbox und Pipeline.</p>
      <label>Admin-Passwort<input name="password" type="password" autoFocus required /></label>
      {error && <p className="login-error">{error}</p>}
      <button disabled={loading} className="launch-primary">{loading ? "Prüfe…" : "Pflege Recruiting OS öffnen"}</button>
      <div className="login-foot"><span>Digitale Gewinner · Production</span><span>● geschützt & live</span></div>
    </form>
  </main>;
}
