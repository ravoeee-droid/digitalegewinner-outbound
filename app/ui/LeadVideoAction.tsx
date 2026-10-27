"use client";

import { useEffect, useState } from "react";
import styles from "./LeadVideoAction.module.css";

type Info = { ready: boolean; websiteAvailable: boolean; pageUrl: string; previewUrl: string; screenshotUrl: string };

export default function LeadVideoAction({ leadId, blocked = false }: { leadId: string; blocked?: boolean }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [imageRevision, setImageRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setInfo(null);
    setError("");
    setNotice("");
    fetch("/api/leads/" + encodeURIComponent(leadId) + "/video", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Videostatus nicht verfügbar.");
        if (active) setInfo(json as Info);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "Videostatus nicht verfügbar."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [leadId]);

  async function generate() {
    if (busy || blocked) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/leads/" + encodeURIComponent(leadId) + "/video", { method: "POST" });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Erstellung fehlgeschlagen.");
      setInfo(json as Info);
      setImageRevision(Date.now());
      setNotice("Fertig! Die personalisierte Videoseite ist bereit.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erstellung fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!info?.ready || blocked) return;
    try {
      await navigator.clipboard.writeText(new URL(info.pageUrl, window.location.origin).toString());
      setNotice("Persönlichen Link kopiert – bereit zum manuellen Versenden.");
      setError("");
    } catch {
      setError("Kopieren nicht möglich. Öffne die Vorschau und kopiere die Adresse ohne ?preview=1.");
    }
  }

  return (
    <section className={styles.card} aria-label="Personalisierte Video-Seite">
      <div className={styles.header}>
        <strong>🎬 Personalisierte Video-Seite</strong>
        {info?.ready && <span className={styles.ready}>Bereit</span>}
      </div>
      <p>Website des Betriebs als Hintergrund + dein aktuelles Talking-Head-Video. Ein persönlicher Link pro Lead.</p>
      {loading && <p className={styles.subtle}>Prüfe den Website-Screenshot …</p>}
      {info?.ready && (
        <div className={styles.thumb}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={info.screenshotUrl + "?v=" + imageRevision} alt="Vorschau des Website-Screenshots" loading="lazy" />
        </div>
      )}
      <div className={styles.buttons}>
        <button type="button" className={styles.primary} disabled={loading || busy || !info?.websiteAvailable || blocked} onClick={() => void generate()}>
          {busy ? "Erstelle Screenshot …" : info?.ready ? "Screenshot aktualisieren" : "Personalisierte Seite erstellen"}
        </button>
        {info?.ready && (
          <>
            <a href={info.previewUrl} target="_blank" rel="noopener noreferrer" className={styles.secondary}>Vorschau öffnen</a>
            <button type="button" className={styles.secondary} onClick={() => void copyLink()} disabled={blocked}>Link kopieren</button>
          </>
        )}
      </div>
      {info && !info.websiteAvailable && <p className={styles.warning}>Keine gültige Firmenwebsite vorhanden. Website im Lead ergänzen.</p>}
      {blocked && <p className={styles.warning}>Kontakt gesperrt – keinen Link versenden.</p>}
      {error && <p className={styles.warning} role="alert">{error}</p>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {info?.ready && <p className={styles.subtle}>Deine eigene Vorschau wird nicht als Kundenbesuch gezählt. Der kopierte Link enthält kein Vorschau-Kennzeichen.</p>}
    </section>
  );
}
