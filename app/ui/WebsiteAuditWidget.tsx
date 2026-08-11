"use client";

import { FormEvent, useMemo, useState } from "react";
import type { WebsiteAuditResult } from "@/lib/website-audit";

type Store = { leads?: Array<Record<string, unknown>>; campaigns?: unknown[]; mailboxes?: unknown[]; settings?: Record<string, unknown> };

function scoreTone(value: number) {
  if (value >= 80) return { color: "#63e8ad", border: "#285e49", bg: "#0e241a" };
  if (value >= 60) return { color: "#f0ce73", border: "#5c4b24", bg: "#241d0d" };
  return { color: "#ff8d92", border: "#663036", bg: "#2a1115" };
}

function normalizeWebsite(value: unknown) {
  return String(value || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

export default function WebsiteAuditWidget() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [audit, setAudit] = useState<WebsiteAuditResult | null>(null);
  const [url, setUrl] = useState("");
  const [company, setCompany] = useState("");

  const actionable = useMemo(() => audit?.findings.filter((finding) => finding.severity !== "strength") || [], [audit]);

  async function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("Website wird tiefgehend analysiert …");
    setAudit(null);
    try {
      const response = await fetch("/api/website/audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, company }),
      });
      const json = (await response.json()) as { audit?: WebsiteAuditResult; error?: string };
      if (!response.ok || !json.audit) throw new Error(json.error || "Analyse fehlgeschlagen.");
      setAudit(json.audit);
      if (!company) setCompany(json.audit.company);
      setMessage(`Analyse fertig · Gesamt-Score ${json.audit.scores.overall}/100`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Analyse fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!audit) return;
    setBusy(true);
    setMessage("PDF-Report wird gebaut …");
    try {
      const response = await fetch("/api/website/audit/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ audit }),
      });
      if (!response.ok) {
        const json = (await response.json()) as { error?: string };
        throw new Error(json.error || "PDF konnte nicht erstellt werden.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || "website-radar.pdf";
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setMessage("PDF-Report heruntergeladen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function saveToRadar() {
    if (!audit) return;
    setBusy(true);
    setMessage("Speichere Analyse im Lead Radar …");
    try {
      const stateResponse = await fetch("/api/state");
      const stateJson = (await stateResponse.json()) as { state?: Store };
      if (!stateResponse.ok) throw new Error("Radar-State konnte nicht geladen werden.");
      const state = stateJson.state || {};
      const leads = state.leads || [];
      const website = normalizeWebsite(audit.finalUrl);
      const companyKey = audit.company.toLowerCase().trim();
      const index = leads.findIndex((lead) => normalizeWebsite(lead.website) === website || String(lead.company || "").toLowerCase().trim() === companyKey);
      const auditNote = `Website Radar ${audit.scores.overall}/100 · Conversion ${audit.scores.conversion} · Trust ${audit.scores.trust} · SEO ${audit.scores.seo} · ${audit.sales.opportunitySummary}`;
      const payload = {
        websiteScore: audit.scores.overall,
        websiteAudit: audit,
        websiteAuditAt: audit.auditedAt,
      };
      let nextLeads: Array<Record<string, unknown>>;
      if (index >= 0) {
        nextLeads = leads.map((lead, leadIndex) => leadIndex === index ? {
          ...lead,
          ...payload,
          notes: [String(lead.notes || ""), auditNote].filter(Boolean).join(" · "),
        } : lead);
      } else {
        nextLeads = [{
          id: `lead-web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          company: audit.company,
          contact: "",
          email: "",
          phone: "",
          website: audit.finalUrl,
          city: "",
          industry: "",
          employees: 0,
          roofArea: 0,
          pvExisting: false,
          energyScore: 0,
          intentScore: 0,
          stage: "Neu",
          dealValue: 0,
          notes: auditNote,
          ...payload,
        }, ...leads];
      }
      const saveResponse = await fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...state, leads: nextLeads }),
      });
      if (!saveResponse.ok) throw new Error("Analyse konnte nicht im Radar gespeichert werden.");
      setMessage(index >= 0 ? "Bestehender Lead wurde mit Website-Radar angereichert." : "Neuer Lead wurde mit Website-Radar angelegt.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function copySales() {
    if (!audit) return;
    const text = [
      `OPENER\n${audit.sales.opener}`,
      `E-MAIL HOOK\n${audit.sales.emailHook}`,
      `LOOM\n${audit.sales.loomTalkingPoints.map((point, index) => `${index + 1}. ${point}`).join("\n")}`,
    ].join("\n\n");
    await navigator.clipboard.writeText(text);
    setMessage("Vertriebs-Text kopiert.");
  }

  const inputStyle = { border:"1px solid #29394b", background:"#080e15", color:"#fff", borderRadius:11, padding:"12px 13px", width:"100%" };

  return <>
    <button onClick={() => setOpen(true)} style={{ position:"fixed", right:520, bottom:24, zIndex:80, border:"1px solid #6b5226", background:"#251b0b", color:"#f5d681", padding:"12px 15px", borderRadius:13, fontWeight:900, cursor:"pointer", boxShadow:"0 18px 45px rgba(0,0,0,.35)" }}>◎ Website Radar</button>
    {open && <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, zIndex:120, background:"rgba(3,6,10,.82)", backdropFilter:"blur(9px)", display:"grid", placeItems:"center", padding:18 }}>
      <div onClick={(event) => event.stopPropagation()} style={{ width:"min(1180px,100%)", maxHeight:"92vh", overflow:"auto", background:"#0a1119", border:"1px solid #283546", borderRadius:24, padding:24, color:"#eef4ff", fontFamily:"Inter,system-ui", boxShadow:"0 30px 90px rgba(0,0,0,.45)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", gap:18, alignItems:"start" }}>
          <div>
            <div style={{ fontSize:10, color:"#f0ca67", fontWeight:900, letterSpacing:".16em" }}>WEBSITE INTELLIGENCE</div>
            <h2 style={{ fontSize:30, margin:"7px 0 5px" }}>High-End Website Radar</h2>
            <p style={{ margin:0, color:"#8290a5", maxWidth:760, lineHeight:1.55, fontSize:13 }}>SEO, Conversion, Vertrauen, Technik und Content in einem Audit. Danach bekommst du automatisch die stärksten Hebel, Cold-Mail-Hook und Fake-Loom-Talking-Points.</p>
          </div>
          <button onClick={() => setOpen(false)} style={{ border:0, background:"#182230", color:"#fff", width:38, height:38, borderRadius:11, cursor:"pointer", fontSize:20 }}>×</button>
        </div>

        <form onSubmit={run} style={{ display:"grid", gridTemplateColumns:"1.6fr 1fr auto", gap:10, marginTop:22 }}>
          <input value={url} onChange={(event) => setUrl(event.target.value)} required placeholder="https://unternehmen.de" style={inputStyle} />
          <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="Unternehmensname (optional)" style={inputStyle} />
          <button disabled={busy} style={{ border:0, borderRadius:11, padding:"0 18px", background:"#61e9a8", color:"#062117", fontWeight:900, cursor:busy?"wait":"pointer", minHeight:45 }}>{busy ? "Analysiert…" : "Website analysieren"}</button>
        </form>
        {message && <div style={{ marginTop:12, padding:"10px 12px", border:"1px solid #223449", borderRadius:11, background:"#0d1824", color:"#9eb0c7", fontSize:12 }}>{message}</div>}

        {audit && <div style={{ marginTop:20 }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(6,minmax(0,1fr))", gap:9 }}>
            {([ ["Gesamt", audit.scores.overall], ["Conversion", audit.scores.conversion], ["Trust", audit.scores.trust], ["SEO", audit.scores.seo], ["Technik", audit.scores.technical], ["Content", audit.scores.content] ] as Array<[string, number]>).map(([label, value]) => {
              const tone = scoreTone(value);
              return <div key={label} style={{ border:`1px solid ${tone.border}`, background:tone.bg, borderRadius:14, padding:14 }}><span style={{ display:"block", color:"#8695a8", fontSize:9, fontWeight:850, textTransform:"uppercase", letterSpacing:".08em" }}>{label}</span><strong style={{ display:"block", marginTop:6, color:tone.color, fontSize:26 }}>{value}</strong><small style={{ color:"#667487" }}>/100</small></div>;
            })}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1.2fr .8fr", gap:12, marginTop:12 }}>
            <div style={{ border:"1px solid #243142", borderRadius:16, padding:18, background:"#0d151f" }}>
              <span style={{ color:"#64eaaa", fontSize:9, fontWeight:900, letterSpacing:".13em" }}>EXECUTIVE OPPORTUNITY</span>
              <h3 style={{ margin:"8px 0", fontSize:18 }}>{audit.company}</h3>
              <p style={{ margin:0, color:"#a9b6c8", lineHeight:1.6, fontSize:13 }}>{audit.sales.opportunitySummary}</p>
            </div>
            <div style={{ border:"1px solid #243142", borderRadius:16, padding:18, background:"#0d151f" }}>
              <span style={{ color:"#89a8cd", fontSize:9, fontWeight:900, letterSpacing:".13em" }}>LIVE METRICS</span>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 14px", marginTop:11, fontSize:11, color:"#8e9caf" }}>
                <div>Antwortzeit<strong style={{ display:"block", color:"#fff", fontSize:15 }}>{audit.responseMs} ms</strong></div>
                <div>Wörter<strong style={{ display:"block", color:"#fff", fontSize:15 }}>{audit.metrics.wordCount}</strong></div>
                <div>CTAs<strong style={{ display:"block", color:"#fff", fontSize:15 }}>{audit.metrics.ctaCount}</strong></div>
                <div>Formulare<strong style={{ display:"block", color:"#fff", fontSize:15 }}>{audit.metrics.formCount}</strong></div>
                <div>H1 / H2<strong style={{ display:"block", color:"#fff", fontSize:15 }}>{audit.metrics.h1Count} / {audit.metrics.h2Count}</strong></div>
                <div>Kontaktwege<strong style={{ display:"block", color:"#fff", fontSize:15 }}>{audit.metrics.contactMethods}</strong></div>
              </div>
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginTop:12 }}>
            <div style={{ border:"1px solid #243142", borderRadius:16, padding:18 }}>
              <div style={{ fontSize:10, color:"#f2cb6d", fontWeight:900, letterSpacing:".12em" }}>TOP PRIORITÄTEN</div>
              <div style={{ display:"grid", gap:9, marginTop:12 }}>
                {audit.priorities.slice(0,5).map((priority) => <div key={priority.rank} style={{ border:"1px solid #212e3d", borderRadius:12, padding:12, background:"#0b131c" }}><div style={{ display:"flex", gap:9, alignItems:"start" }}><span style={{ display:"grid", placeItems:"center", minWidth:25, height:25, borderRadius:8, background:"#2b210d", color:"#f0ca67", fontWeight:900, fontSize:11 }}>{priority.rank}</span><div><strong style={{ fontSize:12 }}>{priority.title}</strong><small style={{ display:"block", marginTop:5, color:"#7f8da1", lineHeight:1.45 }}>{priority.action}</small></div></div></div>)}
                {!audit.priorities.length && <div style={{ color:"#65eab0", fontSize:12 }}>Keine kritischen Hebel erkannt. Fokus auf A/B-Tests.</div>}
              </div>
            </div>

            <div style={{ border:"1px solid #243142", borderRadius:16, padding:18 }}>
              <div style={{ display:"flex", justifyContent:"space-between", gap:10, alignItems:"center" }}><div style={{ fontSize:10, color:"#77b5ff", fontWeight:900, letterSpacing:".12em" }}>OUTBOUND ANGLE</div><button type="button" onClick={() => void copySales()} style={{ border:"1px solid #315173", background:"#0e1d2d", color:"#8bc2ff", borderRadius:9, padding:"7px 10px", fontWeight:850, cursor:"pointer", fontSize:10 }}>Text kopieren</button></div>
              <strong style={{ display:"block", marginTop:13, fontSize:11, color:"#8fa1b8" }}>Cold-Call / Loom Opener</strong>
              <p style={{ color:"#d7e0ec", fontSize:12, lineHeight:1.55 }}>{audit.sales.opener}</p>
              <strong style={{ display:"block", marginTop:12, fontSize:11, color:"#8fa1b8" }}>E-Mail Hook</strong>
              <p style={{ color:"#d7e0ec", fontSize:12, lineHeight:1.55 }}>{audit.sales.emailHook}</p>
              <strong style={{ display:"block", marginTop:12, fontSize:11, color:"#8fa1b8" }}>Fake-Loom Punkte</strong>
              <ol style={{ color:"#d7e0ec", fontSize:11, lineHeight:1.55, paddingLeft:18 }}>{audit.sales.loomTalkingPoints.map((point) => <li key={point} style={{ marginBottom:5 }}>{point}</li>)}</ol>
            </div>
          </div>

          <div style={{ border:"1px solid #243142", borderRadius:16, padding:18, marginTop:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center" }}><div><div style={{ fontSize:10, color:"#c4a1ef", fontWeight:900, letterSpacing:".12em" }}>DETAIL FINDINGS</div><small style={{ color:"#6f7d90" }}>{actionable.length} konkrete Hebel · {audit.findings.filter((finding) => finding.severity === "strength").length} Stärken</small></div></div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:9, marginTop:12 }}>
              {audit.findings.map((finding, index) => {
                const critical = finding.severity === "critical";
                const strength = finding.severity === "strength";
                return <div key={`${finding.title}-${index}`} style={{ border:`1px solid ${critical?"#593038":strength?"#28533f":"#263444"}`, borderRadius:12, padding:13, background:critical?"#211014":strength?"#0d1c16":"#0b131c" }}><div style={{ display:"flex", justifyContent:"space-between", gap:10 }}><strong style={{ fontSize:12 }}>{finding.title}</strong><span style={{ color:critical?"#ff8f94":strength?"#63e8ad":"#96a7bd", fontSize:8, fontWeight:900, textTransform:"uppercase" }}>{finding.severity}</span></div><small style={{ display:"block", marginTop:6, color:"#7f8da1", lineHeight:1.45 }}>{finding.detail}</small><small style={{ display:"block", marginTop:7, color:"#c3cfde", lineHeight:1.45 }}>→ {finding.recommendation}</small></div>;
              })}
            </div>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginTop:14 }}>
            <button disabled={busy} type="button" onClick={() => void downloadPdf()} style={{ border:0, borderRadius:12, padding:13, background:"#f0cb6c", color:"#211903", fontWeight:900, cursor:"pointer" }}>PDF Report herunterladen</button>
            <button disabled={busy} type="button" onClick={() => void saveToRadar()} style={{ border:0, borderRadius:12, padding:13, background:"#61e9a8", color:"#062117", fontWeight:900, cursor:"pointer" }}>Im Lead Radar speichern</button>
            <a href={audit.finalUrl} target="_blank" rel="noreferrer" style={{ display:"grid", placeItems:"center", border:"1px solid #314157", borderRadius:12, padding:13, color:"#b8c7da", fontWeight:850, textDecoration:"none", fontSize:12 }}>Website öffnen ↗</a>
          </div>
        </div>}
      </div>
    </div>}
  </>;
}
