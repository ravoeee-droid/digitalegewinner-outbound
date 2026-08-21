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

  return <main className="login-launch login-a11y" aria-labelledby="login-title">
    <form onSubmit={submit} aria-busy={loading}>
      <div className="login-mark" aria-hidden="true">DG</div>
      <span className="launch-kicker">DIGITALE GEWINNER · PFLEGE RECRUITING OS</span>
      <h1 id="login-title">Willkommen zurück.</h1>
      <p>Dein Workspace für Pflege-Akquise: Lead Intelligence, CloudTalk Calls, Kampagnen, High-End Studio V3, Inbox und Pipeline.</p>
      <label htmlFor="admin-password">Admin-Passwort
        <input id="admin-password" name="password" type="password" autoComplete="current-password" autoFocus required aria-invalid={Boolean(error)} aria-describedby={error ? "login-error" : undefined} />
      </label>
      {error && <p id="login-error" className="login-error" role="alert" aria-live="assertive">{error}</p>}
      <button disabled={loading} className="launch-primary">{loading ? "Prüfe…" : "Pflege Recruiting OS öffnen"}</button>
      <div className="login-foot" aria-label="Systemstatus"><span>Digitale Gewinner · Production</span><span><span aria-hidden="true">●</span> geschützt & live</span></div>
    </form>
  </main>;
}
