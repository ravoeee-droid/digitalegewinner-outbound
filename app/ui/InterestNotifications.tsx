"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Interest = {
  id: string;
  leadId: string;
  company: string;
  category: string;
  at: string;
  segment: "pflege" | "pv" | "other";
};

const STORAGE_KEY = "dg-inbound-interest-seen-v1";
const titleFor = (category: string) => category === "meeting_intent"
  ? "📞 Rückruf / Termin gewünscht"
  : category === "needs_information" ? "✉️ Informationen angefragt"
  : "🔥 Neuer Interessent";

export default function InterestNotifications() {
  const [items, setItems] = useState<Interest[]>([]);
  const [seen, setSeen] = useState<string[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      const values = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
      setSeen(Array.isArray(values) ? values.filter((id):id is string => typeof id === "string").slice(-300) : []);
    } catch { setSeen([]); }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications/interests", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load interested replies");
      const data = await response.json() as { items?: Interest[] };
      setItems(data.items || []);
      setError(false);
    } catch { setError(true); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const pending = useMemo(() => items.filter(item => seen !== null && !seen.includes(item.id)), [items, seen]);
  const active = pending[0];
  function dismiss(id: string) {
    setSeen(previous => {
      const next = [...new Set([...(previous || []), id])].slice(-300);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  if (!active || error) return null;

  return (
    <aside aria-live="polite" aria-label="Neuer Interessent" style={{
      position:"fixed", zIndex:1000, top:18, right:18,
      width:"min(390px, calc(100vw - 36px))",
      border:"1px solid rgba(94,234,160,.55)", borderRadius:16,
      background:"#102019", color:"#f0fff5",
      boxShadow:"0 18px 60px rgba(0,0,0,.55)", padding:18
    }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
        <div>
          <strong style={{color:"#71f5a4",fontSize:14}}>{titleFor(active.category)}</strong>
          <p style={{fontSize:16,fontWeight:800,margin:"8px 0 3px"}}>{active.company}</p>
          <p style={{fontSize:12,opacity:.75,margin:0}}>
            Eingegangene Antwort · {new Intl.DateTimeFormat("de-DE",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Berlin"}).format(new Date(active.at))} (DE)
          </p>
        </div>
        <button type="button" onClick={()=>dismiss(active.id)} aria-label="Benachrichtigung schließen"
          style={{border:"1px solid rgba(255,255,255,.2)",borderRadius:9,color:"#e8f7ed",background:"transparent",padding:"5px 9px",cursor:"pointer"}}>×</button>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:12,marginTop:15}}>
        <Link href={`/crm?segment=${active.segment}&lead=${encodeURIComponent(active.leadId)}`}
          onClick={()=>dismiss(active.id)}
          style={{display:"inline-flex",justifyContent:"center",padding:"10px 14px",borderRadius:10,background:"#34c759",color:"#06140b",fontWeight:800,textDecoration:"none",fontSize:13}}>
          Interessent öffnen
        </Link>
        <span style={{fontSize:12,opacity:.7}}>{pending.length} offen</span>
      </div>
    </aside>
  );
}
