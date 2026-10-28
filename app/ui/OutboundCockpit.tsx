"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./OutboundCockpit.module.css";

type Segment = "all"|"pflege"|"pv";
type Totals = {sent_today:number;sent7:number;queued:number;failed:number;opened:number;clicked:number;page_viewed:number;started:number;quarter:number;half:number;three_quarters:number;completed:number;booking:number;replied:number;meetings:number};
type Hot = {lead_id:string;segment:"pflege"|"pv";company:string;city:string|null;phone:string|null;score:number;plays:number;progress:number;booking:boolean;replied:boolean;last_signal:string};
type ResponseData={segment:Segment;goal:number;totals:Totals;segments:Array<Totals&{segment:"pflege"|"pv";next_at:string|null}>;hot:Hot[];as_of:string};
const number = (value:number)=>new Intl.NumberFormat("de-DE").format(value||0);
const rate=(count:number,denominator:number)=>denominator>0?((count/denominator)*100).toLocaleString("de-DE",{maximumFractionDigits:1})+" %":"–";

export default function OutboundCockpit(){
  const [segment,setSegment]=useState<Segment>("all");
  const [data,setData]=useState<ResponseData|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    let alive=true;
    async function load(){
      try{
        const res=await fetch("/api/dashboard/outbound?segment="+segment,{cache:"no-store"});
        const payload=await res.json();
        if(!res.ok)throw new Error(payload.error||"Cockpit nicht verfügbar");
        if(alive){setData(payload);setError("");setLoading(false);}
      }catch(e){if(alive){setError(e instanceof Error?e.message:"Datenfehler");setLoading(false);}}
    }
    setLoading(true);void load();
    const timer=setInterval(()=>{void load();},45000);
    return ()=>{alive=false;clearInterval(timer);};
  },[segment]);
  const t=data?.totals;
  const stages=t?[
    {name:"Versendet (7 Tage)",value:t.sent7},
    {name:"Link geklickt",value:t.clicked},
    {name:"Videoseite besucht",value:t.page_viewed},
    {name:"Video gestartet",value:t.started},
    {name:"25 % angesehen",value:t.quarter},
    {name:"50 % angesehen",value:t.half},
    {name:"75 % angesehen",value:t.three_quarters},
    {name:"Video beendet",value:t.completed},
    {name:"Termininteresse",value:t.booking}
  ]:[];
  return <section className={styles.root} aria-label="DG Outbound Performance Cockpit">
    <div className={styles.head}>
      <div><span className={styles.eyebrow}>LIVE PERFORMANCE · LOOM OUTBOUND</span><h2>Vertriebs-Cockpit</h2><p>Von der personalisierten E-Mail zum konkreten Gespräch. Automatisch alle 45 Sekunden aktualisiert.</p></div>
      <div className={styles.filters} role="group" aria-label="Geschäftsfeld wählen">
        {([["all","Gesamt"],["pflege","Pflege"],["pv","PV-Trust"]] as const).map(([value,label])=><button key={value} type="button" onClick={()=>setSegment(value)} className={segment===value?styles.active:""} aria-pressed={segment===value}>{label}</button>)}
      </div>
    </div>
    {error&&<p className={styles.error} role="alert">{error}</p>}
    {!data&&loading?<p className={styles.loading}>Live-Daten werden geladen …</p>:data&&t&&<>
      <div className={styles.kpis}>
        {[
          {label:"Heute versendet",value:number(t.sent_today),detail:"Ziel "+number(data.goal)+" / Tag",ratio:t.sent_today/data.goal},
          {label:"In Warteschlange",value:number(t.queued),detail:"Automatisch geplant"},
          {label:"Echte Videostarts",value:number(t.started),detail:rate(t.started,t.sent7)+" der gesendeten Leads"},
          {label:"Termininteresse",value:number(t.booking),detail:"Kalender, Termin- oder WhatsApp-Klick"},
          {label:"Antworten",value:number(t.replied),detail:rate(t.replied,t.sent7)+" Antwortquote"},
          {label:"Gebuchte Termine",value:number(t.meetings),detail:"Aus Tracking- und CRM-Ereignissen"}
        ].map(k=><div className={styles.kpi} key={k.label}>
          <span>{k.label}</span><strong>{k.value}</strong><small>{k.detail}</small>
          {"ratio" in k&&<div className={styles.meter}><i style={{width:Math.min(100,Math.max(0,(k.ratio||0)*100))+"%"}}/></div>}
        </div>)}
      </div>
      {segment==="all"&&<div className={styles.segments}>
        {data.segments.map(s=><div key={s.segment} className={styles.segmentRow}>
          <strong>{s.segment==="pflege"?"Pflege-Recruiting":"PV-Trust"}</strong>
          <span>{number(s.sent_today)} / 150 heute</span>
          <span>{number(s.queued)} wartend</span>
          <span>{number(s.started)} Videostarts</span>
          <div className={styles.meter}><i style={{width:Math.min(100,s.sent_today/150*100)+"%"}}/></div>
        </div>)}
      </div>}
      <div className={styles.columns}>
        <div className={styles.panel}>
          <div className={styles.panelHead}><h3>Video-Conversion-Funnel</h3><span>Eindeutige Leads</span></div>
          <div className={styles.funnel}>
            {stages.map((s,index)=><div className={styles.funnelRow} key={s.name}>
              <div><span>{s.name}</span><strong>{number(s.value)}</strong><small>{index===0?"Basis":rate(s.value,t.sent7)}</small></div>
              <div className={styles.bar}><i style={{width:(t.sent7>0?Math.max(s.value?2:0,s.value/t.sent7*100):0)+"%"}}/></div>
            </div>)}
          </div>
          <p className={styles.note}>Scannergekennzeichnete Aktivitäten zählen nicht als Videointeresse. Video-Starts und Sehdauer sind aussagekräftiger als E-Mail-Öffnungen.</p>
        </div>
        <div className={styles.panel}>
          <div className={styles.panelHead}><h3>Tracking & Versand</h3><span>{loading?"Aktualisiere …":"Live"}</span></div>
          <div className={styles.statusList}>
            <div><span>E-Mail geöffnet</span><strong>{number(t.opened)}</strong></div>
            <div><span>Link geklickt</span><strong>{number(t.clicked)}</strong></div>
            <div><span>Video gestartet</span><strong>{number(t.started)}</strong></div>
            <div><span>50 % angesehen</span><strong>{number(t.half)}</strong></div>
            <div><span>Terminsignal</span><strong>{number(t.booking)}</strong></div>
            <div><span>Versandfehler</span><strong className={t.failed?styles.danger:""}>{number(t.failed)}</strong></div>
          </div>
          <p className={styles.note}>Das Dashboard zeigt gespeicherte Ereignisse. Ein fehlendes Ereignis bedeutet nicht zwangsläufig, dass die Person die Aktion nicht ausgeführt hat.</p>
          <Link className={styles.link} href="/mail">Postfächer und Versand überprüfen →</Link>
        </div>
      </div>
      <div className={styles.panel}>
        <div className={styles.panelHead}><div><h3>Jetzt anrufen</h3><p>Nach nachvollziehbaren Kaufsignalen sortiert. Nur gesendete, nicht gesperrte Leads.</p></div><Link className={styles.link} href="/crm">CRM öffnen →</Link></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>Betrieb</th><th>Bereich</th><th>Signal</th><th>Score</th><th>Aktion</th></tr></thead>
            <tbody>
              {data.hot.length===0&&<tr><td colSpan={5} className={styles.empty}>Noch keine bestätigten starken Kaufsignale. Die Liste füllt sich mit echten Videoaufrufen und Antworten.</td></tr>}
              {data.hot.map(h=><tr key={h.segment+"-"+h.lead_id}>
                <td><strong>{h.company}</strong><small>{h.city||"Ort unbekannt"} · {h.last_signal?new Date(h.last_signal).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"Signalzeit unbekannt"}</small></td>
                <td>{h.segment==="pflege"?"Pflege":"PV-Trust"}</td>
                <td>{h.replied?"Antwort erhalten · ":""}{h.booking?"Termininteresse · ":""}{h.progress? h.progress+" % angesehen · ":""}{h.plays? h.plays+" Videostart"+(h.plays===1?"":"s"):""}</td>
                <td><span className={styles.score}>{h.score}</span></td>
                <td>{h.phone?<a href={"tel:"+h.phone.replace(/[^+0-9]/g,"")} className={styles.call}>Anrufen</a>:<Link className={styles.link} href="/crm">CRM ansehen</Link>}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <p className={styles.footnote}>Stand: {new Date(data.as_of).toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})} · Die Scores sind eine transparente Priorisierung, keine Vorhersage über Abschlüsse.</p>
    </>}
  </section>;
}
